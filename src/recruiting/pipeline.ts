import type { OpenClawConfig } from "../config/config.js";
import type { TalentSearchParams, TalentSearchApi } from "../linkedin/search.js";
import type {
  CandidateEvidenceLink,
  CandidatePipelineCounts,
  CandidatePipelineDiagnostics,
  CandidatePipelineResultRow,
  CandidatePipelineResults,
  CandidatePipelineRunInput,
  CandidatePipelineSearchQueryUsed,
  CandidatePipelineStatus,
  CandidateReviewStatus,
  CandidateSignal,
  DailyOutputContract,
  QuotaStatus,
  VerificationOutcome,
  VerificationStats,
  WorkflowStats,
} from "./types.js";
import {
  buildClientOptions,
  getMissingCredentials,
  resolveLinkedInAccount,
} from "../linkedin/accounts.js";
import {
  classifyLinkedInError,
  getUserComments,
  getUserPosts,
  getUserProfile,
  getUserReactions,
} from "../linkedin/client.js";
import { searchTalent } from "../linkedin/search.js";
import { resolveRecruitingConfig } from "./config.js";
import { enrichExternalFootprint } from "./external.js";
import { resolveIdentity } from "./identity.js";
import { computeCandidateScore } from "./scoring.js";
import { CandidateStore } from "./store.js";

const DEFAULT_PAGE_SIZE = 50;

const AI_NATIVE_SOURCE_TERMS = [
  "claude code",
  "codex",
  "mcp",
  "model context protocol",
  "agentic",
  "ai-native",
  "autogen",
  "langgraph",
  "cursor",
  "windsurf",
  "agents",
  "agent",
] as const;

class PipelineStageError extends Error {
  constructor(
    readonly stage: string,
    message: string,
    readonly errorType: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "PipelineStageError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(baseMs: number): number {
  return baseMs + Math.floor(Math.random() * Math.max(200, Math.floor(baseMs * 0.4)));
}

function isRetryableExternalError(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    message.includes("429") ||
    message.includes("503") ||
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("econn")
  );
}

async function withRetry<T>(params: {
  provider: "unipile" | "exa";
  task: () => Promise<T>;
  maxAttempts?: number;
  baseDelayMs?: number;
}): Promise<T> {
  const maxAttempts = params.maxAttempts ?? 4;
  const baseDelayMs = params.baseDelayMs ?? 600;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await params.task();
    } catch (err) {
      lastError = err;
      const retryable =
        params.provider === "unipile"
          ? classifyLinkedInError(err).isTransient
          : isRetryableExternalError(err);
      if (!retryable || attempt === maxAttempts) {
        throw err;
      }
      await sleep(jitter(baseDelayMs * attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1_000_000_000_000) {
      return value;
    }
    if (value > 1_000_000_000) {
      return value * 1000;
    }
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function calcRecentActivityScore(
  activityItems: Array<Record<string, unknown>>,
  windowMs: number,
): number {
  if (activityItems.length === 0) {
    return 0;
  }
  const cutoff = Date.now() - windowMs;
  const recentCount = activityItems
    .map((item) => toNumber(item.created_at ?? item.published_at ?? item.timestamp))
    .filter((ts): ts is number => ts !== null)
    .filter((ts) => ts >= cutoff).length;
  if (recentCount <= 0) {
    return 0;
  }
  return Math.min(1, recentCount / 12);
}

function buildIdempotencyKey(params: {
  roleKey: string;
  targetCandidates: number;
  date: string;
}): string {
  return `${params.roleKey}:${params.targetCandidates}:${params.date}`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/[\s]+/g, " ").trim();
}

function stripAiNativeTerms(value: string): string {
  let out = value;
  for (const term of AI_NATIVE_SOURCE_TERMS) {
    const pattern = new RegExp(`\\b${escapeRegex(term)}\\b`, "gi");
    out = out.replace(pattern, " ");
  }
  out = out.replace(/[|/]+/g, " ");
  return normalizeWhitespace(out);
}

function normalizeSearchForSourceMode(
  input: TalentSearchParams,
  mode: "default" | "broad",
): TalentSearchParams {
  if (mode !== "broad") {
    return input;
  }

  const normalized: TalentSearchParams = {
    ...input,
    keywords: input.keywords ? stripAiNativeTerms(input.keywords) || undefined : input.keywords,
    role: input.role
      ?.map((role) => ({
        ...role,
        keywords: role.keywords ? stripAiNativeTerms(role.keywords) || undefined : role.keywords,
      }))
      .filter((role) => Boolean(role.keywords || role.id)),
    skills: input.skills
      ?.map((skill) => ({
        ...skill,
        keywords: skill.keywords ? stripAiNativeTerms(skill.keywords) || undefined : skill.keywords,
      }))
      .filter((skill) => Boolean(skill.keywords || skill.id)),
    company: input.company
      ?.map((company) => ({
        ...company,
        keywords: company.keywords
          ? stripAiNativeTerms(company.keywords) || undefined
          : company.keywords,
      }))
      .filter((company) => Boolean(company.keywords || company.id || company.name)),
  };

  return normalized;
}

function buildSearchQueryUsed(params: {
  api: TalentSearchApi;
  search: TalentSearchParams;
  pageSize: number;
  maxPages: number;
}): CandidatePipelineSearchQueryUsed {
  return {
    api: params.api,
    keywords: params.search.keywords,
    roleKeywords: (params.search.role ?? [])
      .map((item) => item.keywords?.trim())
      .filter((item): item is string => Boolean(item)),
    skills: (params.search.skills ?? [])
      .map((item) => item.keywords?.trim())
      .filter((item): item is string => Boolean(item)),
    companyKeywords: (params.search.company ?? [])
      .map((item) => item.keywords?.trim() || item.name?.trim())
      .filter((item): item is string => Boolean(item)),
    location: params.search.location,
    industry: params.search.industry,
    networkDistance: (params.search.network_distance ?? []).filter(
      (value): value is 1 | 2 | 3 => value === 1 || value === 2 || value === 3,
    ),
    pageSize: params.pageSize,
    maxPages: params.maxPages,
  };
}

function emptyCounts(): CandidatePipelineCounts {
  return {
    sourced: 0,
    enriched: 0,
    enrichFailed: 0,
    externalDiscovered: 0,
    identityConfirmedHigh: 0,
    identityMediumLow: 0,
    shortlistEligible: 0,
  };
}

type ErrorAggregate = {
  stage: string;
  count: number;
  topMessages: Array<{ message: string; errorType: string; count: number }>;
};

function upsertStageError(
  map: Map<string, Map<string, { message: string; errorType: string; count: number }>>,
  stage: string,
  message: string,
  errorType: string,
): void {
  const stageMap =
    map.get(stage) ?? new Map<string, { message: string; errorType: string; count: number }>();
  const key = `${errorType}:${message}`;
  const current = stageMap.get(key);
  if (current) {
    current.count += 1;
  } else {
    stageMap.set(key, {
      message,
      errorType,
      count: 1,
    });
  }
  map.set(stage, stageMap);
}

function buildStageErrors(
  map: Map<string, Map<string, { message: string; errorType: string; count: number }>>,
): ErrorAggregate[] {
  const out: ErrorAggregate[] = [];
  for (const [stage, entries] of map.entries()) {
    const messages = [...entries.values()].toSorted((a, b) => b.count - a.count).slice(0, 3);
    const count = messages.reduce((sum, item) => sum + item.count, 0);
    out.push({
      stage,
      count,
      topMessages: messages,
    });
  }
  return out.toSorted((a, b) => b.count - a.count);
}

function classifyRunError(err: unknown): {
  message: string;
  errorType: string;
  retryable: boolean;
} {
  if (err instanceof PipelineStageError) {
    return {
      message: err.message,
      errorType: err.errorType,
      retryable: err.retryable,
    };
  }

  const linkedInError = classifyLinkedInError(err);
  if (linkedInError.type !== "unknown") {
    return {
      message: linkedInError.message,
      errorType: linkedInError.type,
      retryable: linkedInError.isTransient,
    };
  }

  return {
    message: err instanceof Error ? err.message : String(err),
    errorType: err instanceof Error ? err.name || "error" : "error",
    retryable: isRetryableExternalError(err),
  };
}

function resolvedApi(search: TalentSearchParams): TalentSearchApi {
  if (search.api === "recruiter" || search.api === "sales_navigator") {
    return search.api;
  }
  return "classic";
}

export class CandidatePipelineService {
  private readonly recruiting = resolveRecruitingConfig(this.cfg);
  private readonly store: CandidateStore;

  constructor(private readonly cfg: OpenClawConfig) {
    this.store = new CandidateStore(this.recruiting.store.path);
  }

  close(): void {
    this.store.close();
  }

  async run(input: CandidatePipelineRunInput): Promise<{
    runId: string;
    resumed: boolean;
    status: CandidatePipelineStatus | null;
  }> {
    const role = input.role;
    const browserVerificationEnabled =
      input.browserVerificationEnabled ?? this.recruiting.browserVerification.enabled;
    const sourceQueryMode = input.sourceQueryMode ?? "default";
    const evidenceQueryMode = input.evidenceQueryMode ?? "default";
    const targetCandidates = Math.max(
      1,
      Math.trunc(role.targetCandidates ?? this.recruiting.run.targetCandidatesPerRole),
    );

    const dailyKey = buildIdempotencyKey({
      roleKey: role.roleKey,
      targetCandidates,
      date: new Date().toISOString().slice(0, 10),
    });

    const runInfo = this.store.beginRun({
      runId: input.runId,
      idempotencyKey: input.idempotencyKey ?? dailyKey,
      roleKey: role.roleKey,
      roleTitle: role.roleTitle,
      targetCandidates,
      config: {
        recruiting: this.recruiting,
      },
      criteria: {
        ...(role.search as Record<string, unknown>),
        source_query_mode: sourceQueryMode,
        evidence_query_mode: evidenceQueryMode,
      },
    });

    if (runInfo.resumed) {
      return {
        runId: runInfo.runId,
        resumed: true,
        status: this.store.getRunStatus(runInfo.runId),
      };
    }

    const pages = Math.max(1, Math.ceil(targetCandidates / DEFAULT_PAGE_SIZE));
    const maxPages = Math.max(3, pages);
    const api = resolvedApi(role.search);

    const account = resolveLinkedInAccount({
      cfg: this.cfg,
      accountId: role.search.accountId,
    });
    const missingCredentials = getMissingCredentials(account);
    const accountHealth: CandidatePipelineDiagnostics["accountHealth"] = {
      requestedAccountId: role.search.accountId ?? undefined,
      resolvedAccountId: account.accountId,
      unipileAccountId: account.unipileAccountId,
      enabled: account.enabled,
      apiKeySource: account.apiKeySource,
      missingCredentials,
      recruiterReady: account.enabled && missingCredentials.length === 0,
    };

    const normalizedSearch = normalizeSearchForSourceMode(role.search, sourceQueryMode);
    const searchQueryUsed = buildSearchQueryUsed({
      api,
      search: normalizedSearch,
      pageSize: DEFAULT_PAGE_SIZE,
      maxPages,
    });

    const counts = emptyCounts();
    const stageErrors = new Map<
      string,
      Map<string, { message: string; errorType: string; count: number }>
    >();

    const buildDiagnostics = (
      params?: Partial<Pick<CandidatePipelineDiagnostics, "failure">>,
    ): CandidatePipelineDiagnostics => ({
      counts: { ...counts },
      errorsByStage: buildStageErrors(stageErrors),
      searchQueryUsed,
      modes: {
        sourceQueryMode,
        evidenceQueryMode,
      },
      accountHealth,
      failure: params?.failure,
    });

    const persistFailure = (params: {
      stage: string;
      candidateRef?: string;
      message: string;
      errorType: string;
      retryable: boolean;
      payload?: Record<string, unknown>;
    }): void => {
      upsertStageError(stageErrors, params.stage, params.message, params.errorType);
      this.store.recordFailure({
        runId: runInfo.runId,
        step: params.stage,
        candidateRef: params.candidateRef,
        errorType: params.errorType,
        message: params.message,
        retryable: params.retryable,
        payload: params.payload,
      });
    };

    try {
      if (!account.enabled) {
        throw new PipelineStageError(
          "linkedin_preflight",
          "LinkedIn integration is disabled for the resolved account.",
          "auth",
          false,
        );
      }

      const clientOpts = buildClientOptions(account);
      if (!clientOpts) {
        const missing = missingCredentials.join(", ");
        throw new PipelineStageError(
          "linkedin_preflight",
          `LinkedIn credentials missing: ${missing}.`,
          "auth",
          false,
        );
      }

      const searchResult = await withRetry({
        provider: "unipile",
        task: async () =>
          await searchTalent(
            {
              ...normalizedSearch,
              api,
              limit: targetCandidates,
              page_size: DEFAULT_PAGE_SIZE,
              max_pages: maxPages,
            },
            this.cfg,
          ),
      });

      if (!searchResult.success) {
        const classified = classifyLinkedInError(searchResult.error ?? "LinkedIn search failed");
        throw new PipelineStageError(
          "linkedin_search",
          searchResult.error || "LinkedIn search failed",
          classified.type,
          classified.isTransient,
        );
      }

      counts.sourced = searchResult.candidates.length;

      for (const [index, candidate] of searchResult.candidates.entries()) {
        try {
          const candidateRecord = this.store.upsertCandidate({
            candidateId: candidate.provider_id,
            providerId: candidate.provider_id,
            publicIdentifier: candidate.public_identifier,
            profileUrl: candidate.public_profile_url ?? candidate.profile_url,
            name: candidate.name,
            headline: candidate.headline,
            location: candidate.location,
            currentCompany: candidate.current_company,
            currentRole: candidate.current_role,
          });

          this.store.addSourceRecord({
            candidateId: candidateRecord.candidateId,
            runId: runInfo.runId,
            source: "linkedin.search",
            sourceRank: index + 1,
            raw: candidate as unknown as Record<string, unknown>,
          });

          const profile = await withRetry({
            provider: "unipile",
            task: async () =>
              (await getUserProfile(clientOpts, candidate.provider_id, {
                linkedinSections: ["*_preview", "skills", "experience", "projects"],
              })) as Record<string, unknown>,
          });

          const [postsRes, commentsRes, reactionsRes] = await Promise.all([
            withRetry({
              provider: "unipile",
              task: async () =>
                (await getUserPosts(clientOpts, candidate.provider_id, { limit: 40 })) as Record<
                  string,
                  unknown
                >,
            }),
            withRetry({
              provider: "unipile",
              task: async () =>
                (await getUserComments(clientOpts, candidate.provider_id, { limit: 40 })) as Record<
                  string,
                  unknown
                >,
            }),
            withRetry({
              provider: "unipile",
              task: async () =>
                (await getUserReactions(clientOpts, candidate.provider_id, {
                  limit: 40,
                })) as Record<string, unknown>,
            }),
          ]);

          const posts = Array.isArray(postsRes.items)
            ? (postsRes.items as Array<Record<string, unknown>>)
            : [];
          const comments = Array.isArray(commentsRes.items)
            ? (commentsRes.items as Array<Record<string, unknown>>)
            : [];
          const reactions = Array.isArray(reactionsRes.items)
            ? (reactionsRes.items as Array<Record<string, unknown>>)
            : [];

          const windowMs = 90 * 24 * 60 * 60 * 1000;
          const signals: CandidateSignal[] = [
            {
              key: "builder_activity",
              numericValue: calcRecentActivityScore(posts, windowMs),
              source: "linkedin.posts",
            },
            {
              key: "builder_activity",
              numericValue: calcRecentActivityScore(comments, windowMs),
              source: "linkedin.comments",
            },
            {
              key: "builder_activity",
              numericValue: calcRecentActivityScore(reactions, windowMs),
              source: "linkedin.reactions",
            },
            {
              key: "technical_depth",
              numericValue:
                candidate.skills.length > 0 ? Math.min(1, candidate.skills.length / 12) : 0,
              source: "linkedin.profile",
              details: { skills: candidate.skills.slice(0, 20) },
            },
            {
              key: "role_fit",
              numericValue: candidate.headline ? 0.6 : 0.3,
              source: "linkedin.profile",
            },
          ];

          const external = await withRetry({
            provider: "exa",
            task: async () =>
              await enrichExternalFootprint({
                cfg: this.cfg,
                evidenceQueryMode,
                candidate: {
                  name: candidate.name,
                  headline: candidate.headline,
                  currentCompany: candidate.current_company,
                  publicIdentifier: candidate.public_identifier,
                },
              }),
          });

          if (external.evidenceLinks.length > 0) {
            counts.externalDiscovered += 1;
          }

          signals.push(...external.signals);

          const rawIdentity = resolveIdentity({
            linkedin: {
              providerId: candidate.provider_id,
              publicIdentifier: candidate.public_identifier,
              profileUrl: candidate.public_profile_url ?? candidate.profile_url,
              name: candidate.name,
              employer: candidate.current_company,
              location: candidate.location,
            },
            github: {
              handle: external.identityHints.github?.handle,
              url: external.identityHints.github?.url,
              profileLinkedinUrl: undefined,
              employer: undefined,
              location: undefined,
            },
            x: {
              handle: external.identityHints.x?.handle,
              url: external.identityHints.x?.url,
              profileLinkedinUrl: undefined,
            },
            personalSite: {
              url: external.identityHints.personalSite?.url,
            },
          });

          const identity = {
            ...rawIdentity,
            shortlistEligible:
              rawIdentity.confidence >= this.recruiting.identity.minConfidenceForShortlist,
          };

          if (identity.band === "CONFIRMED" || identity.band === "HIGH") {
            counts.identityConfirmedHigh += 1;
          } else {
            counts.identityMediumLow += 1;
          }

          const evidenceLinks: CandidateEvidenceLink[] = [
            {
              url: candidate.public_profile_url ?? candidate.profile_url ?? "",
              title: `LinkedIn: ${candidate.name}`,
              source: "linkedin.profile",
              relevance: 1,
            },
            ...external.evidenceLinks,
          ].filter((item) => Boolean(item.url));

          if (
            browserVerificationEnabled &&
            this.recruiting.browserVerification.mode === "high_only" &&
            identity.band === "HIGH"
          ) {
            signals.push({
              key: "browser_verification_needed",
              value: "true",
              numericValue: 1,
              source: "pipeline",
            });
          }

          const openToWork = profile.is_open_to_work === true;

          const score = computeCandidateScore({
            signals,
            identity,
            evidence: evidenceLinks,
            openToWork,
          });

          this.store.upsertIdentity({
            candidateId: candidateRecord.candidateId,
            platform: "cross_platform",
            resolution: identity,
          });
          if (external.identityHints.github?.handle || external.identityHints.github?.url) {
            this.store.upsertIdentity({
              candidateId: candidateRecord.candidateId,
              platform: "github",
              handle: external.identityHints.github?.handle,
              url: external.identityHints.github?.url,
              resolution: identity,
            });
          }
          if (external.identityHints.x?.handle || external.identityHints.x?.url) {
            this.store.upsertIdentity({
              candidateId: candidateRecord.candidateId,
              platform: "x",
              handle: external.identityHints.x?.handle,
              url: external.identityHints.x?.url,
              resolution: identity,
            });
          }

          this.store.addSignals(candidateRecord.candidateId, signals);
          this.store.upsertScore({
            candidateId: candidateRecord.candidateId,
            runId: runInfo.runId,
            score,
          });
          this.store.addEvidenceLinks({
            candidateId: candidateRecord.candidateId,
            runId: runInfo.runId,
            links: evidenceLinks,
          });

          if (score.shortlistEligible) {
            counts.shortlistEligible += 1;
          }
          counts.enriched += 1;
        } catch (err) {
          counts.enrichFailed += 1;
          const info = classifyRunError(err);
          persistFailure({
            stage: "candidate_enrich_score",
            candidateRef: candidate.provider_id,
            message: info.message,
            errorType: info.errorType,
            retryable: info.retryable,
          });
        }
      }

      this.store.markRunCompleted(runInfo.runId, buildDiagnostics());

      return {
        runId: runInfo.runId,
        resumed: false,
        status: this.store.getRunStatus(runInfo.runId),
      };
    } catch (err) {
      const info = classifyRunError(err);
      const stage = err instanceof PipelineStageError ? err.stage : "pipeline_run";

      persistFailure({
        stage,
        message: info.message,
        errorType: info.errorType,
        retryable: info.retryable,
      });

      this.store.markRunFailed(
        runInfo.runId,
        buildDiagnostics({
          failure: {
            stage,
            message: info.message,
            errorType: info.errorType,
          },
        }),
      );

      return {
        runId: runInfo.runId,
        resumed: false,
        status: this.store.getRunStatus(runInfo.runId),
      };
    }
  }

  status(runId?: string): CandidatePipelineStatus | CandidatePipelineStatus[] | null {
    if (runId) {
      return this.store.getRunStatus(runId);
    }
    return this.store.listRecentRuns(20);
  }

  results(runId: string, limit = 50): CandidatePipelineResults {
    return this.store.getResults(runId, limit);
  }

  candidate(candidateId: string): Record<string, unknown> | null {
    return this.store.getCandidate(candidateId);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Hybrid workflow: Review & Verification
  // ─────────────────────────────────────────────────────────────────────────────

  updateReviewStatus(params: {
    runId: string;
    candidateId: string;
    status: CandidateReviewStatus;
    notes?: string;
  }): void {
    this.store.upsertReviewStatus({
      candidateId: params.candidateId,
      runId: params.runId,
      status: params.status,
      notes: params.notes,
    });
  }

  getVerificationQueue(params: {
    runId: string;
    limit: number;
    priority?: "high" | "all";
  }): CandidatePipelineResultRow[] {
    return this.store.getVerificationQueue(params);
  }

  submitVerification(params: {
    runId: string;
    candidateId: string;
    outcome: VerificationOutcome;
    identityConfidenceAfter?: number;
    proofLinks: string[];
    notes?: string;
  }): void {
    // Get current identity confidence before verification
    const candidateData = this.store.getCandidate(params.candidateId);
    const identities = candidateData?.identities as
      | Array<{ platform: string; confidence: number }>
      | undefined;
    const crossPlatform = identities?.find((i) => i.platform === "cross_platform");
    const identityConfidenceBefore = crossPlatform?.confidence;

    this.store.submitVerification({
      candidateId: params.candidateId,
      runId: params.runId,
      method: "browser",
      outcome: params.outcome,
      identityConfidenceBefore,
      identityConfidenceAfter: params.identityConfidenceAfter,
      proofLinks: params.proofLinks,
      notes: params.notes,
    });

    // Update review status based on verification outcome
    if (params.outcome === "confirmed") {
      this.store.upsertReviewStatus({
        candidateId: params.candidateId,
        runId: params.runId,
        status: "promoted_shortlist",
        notes: `Verified via browser. ${params.notes ?? ""}`.trim(),
      });
    } else if (params.outcome === "rejected") {
      this.store.upsertReviewStatus({
        candidateId: params.candidateId,
        runId: params.runId,
        status: "rejected",
        notes: `Verification rejected. ${params.notes ?? ""}`.trim(),
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Hybrid workflow: Promotion
  // ─────────────────────────────────────────────────────────────────────────────

  promoteCandidate(params: {
    runId: string;
    candidateId: string;
    promotionReason: string;
    evidenceLinks: string[];
    confidenceOverride?: number;
    outreachAngle?: string;
  }): { success: boolean; error?: string } {
    const minProofLinks = this.recruiting.promotion?.minProofLinks ?? 2;

    if (params.evidenceLinks.length < minProofLinks) {
      return {
        success: false,
        error: `Promotion requires at least ${minProofLinks} evidence links. Provided: ${params.evidenceLinks.length}.`,
      };
    }

    // Check if already promoted
    const existing = this.store.getPromotion(params.candidateId, params.runId);
    if (existing) {
      return {
        success: false,
        error: "Candidate has already been promoted for this run.",
      };
    }

    this.store.promoteCandidate({
      candidateId: params.candidateId,
      runId: params.runId,
      promotionReason: params.promotionReason,
      confidenceOverride: params.confidenceOverride,
      outreachAngle: params.outreachAngle,
      proofLinks: params.evidenceLinks,
    });

    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Hybrid workflow: Daily Report
  // ─────────────────────────────────────────────────────────────────────────────

  getDailyReport(params: { runId?: string; date?: string; roleKey: string }): {
    contract: DailyOutputContract | null;
    workflow: WorkflowStats;
    verification: VerificationStats;
    quota: QuotaStatus;
  } | null {
    // If no runId provided, find the most recent run for this role
    let runId = params.runId;
    if (!runId) {
      const recentRuns = this.store.listRecentRuns(20);
      const matchingRun = recentRuns.find((r) => r.roleKey === params.roleKey);
      if (!matchingRun) {
        return null;
      }
      runId = matchingRun.runId;
    }

    const date = params.date ?? new Date().toISOString().slice(0, 10);
    const contract = this.store.getDailyOutputContract(runId, params.roleKey, date);
    const workflow = this.store.getWorkflowStats(runId);
    const verification = this.store.getVerificationStats(runId);
    const quota = this.store.getQuotaStatus(runId, date, {
      verificationBudgetDaily: this.recruiting.dailyQuotas?.verificationBudget ?? 20,
      promotionsTargetDaily: this.recruiting.dailyQuotas?.promotedTarget ?? 10,
      reviewedTargetDaily: this.recruiting.dailyQuotas?.reviewedTarget ?? 30,
    });

    return {
      contract,
      workflow,
      verification,
      quota,
    };
  }
}
