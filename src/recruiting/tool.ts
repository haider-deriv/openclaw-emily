import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../agents/tools/common.js";
import type { OpenClawConfig } from "../config/config.js";
import { optionalStringEnum, stringEnum } from "../agents/schema/typebox.js";
import {
  jsonResult,
  readNumberParam,
  readStringArrayParam,
  readStringParam,
} from "../agents/tools/common.js";
import { resolveRecruitingConfig } from "./config.js";
import { CandidatePipelineService } from "./pipeline.js";

const CANDIDATE_PIPELINE_ACTIONS = [
  "run",
  "status",
  "results",
  "candidate",
  "promote_candidate",
  "update_review_status",
  "verification_queue",
  "verification_submit",
  "daily_report",
] as const;
const LINKEDIN_API_VALUES = ["classic", "recruiter", "sales_navigator"] as const;
const SOURCE_QUERY_MODE_VALUES = ["default", "broad"] as const;
const EVIDENCE_QUERY_MODE_VALUES = ["default", "strict"] as const;
const REVIEW_STATUS_VALUES = [
  "new_review",
  "under_verification",
  "promoted_shortlist",
  "rejected",
  "deferred",
] as const;
const VERIFICATION_OUTCOME_VALUES = ["confirmed", "rejected", "inconclusive"] as const;
const PRIORITY_FILTER_VALUES = ["high", "all"] as const;

const CandidatePipelineSchema = Type.Object({
  action: stringEnum(CANDIDATE_PIPELINE_ACTIONS, {
    description:
      "Action to execute: run, status, results, candidate, promote_candidate, update_review_status, verification_queue, verification_submit, daily_report.",
  }),
  run_id: Type.Optional(Type.String({ description: "Run id for status/results queries." })),
  candidate_id: Type.Optional(Type.String({ description: "Candidate id for candidate details." })),

  role_key: Type.Optional(Type.String({ description: "Stable role key (e.g. backend-ai-us)." })),
  role_title: Type.Optional(Type.String({ description: "Human-readable role title." })),
  api: optionalStringEnum(LINKEDIN_API_VALUES, {
    description: "LinkedIn search API mode.",
  }),
  keywords: Type.Optional(Type.String({ description: "Base search keywords." })),
  role_keywords: Type.Optional(Type.Array(Type.String(), { description: "Role keyword filters." })),
  skills: Type.Optional(Type.Array(Type.String(), { description: "Skill keyword filters." })),
  company_keywords: Type.Optional(
    Type.Array(Type.String(), { description: "Company keyword filters." }),
  ),
  location: Type.Optional(Type.String({ description: "Location filter." })),
  industry: Type.Optional(Type.String({ description: "Industry filter." })),
  network_distance: Type.Optional(
    Type.Array(Type.Number(), { description: "Network distance: 1,2,3." }),
  ),
  target_candidates: Type.Optional(
    Type.Number({
      description: "Target candidates per run (default from config).",
      minimum: 1,
      maximum: 2000,
    }),
  ),
  account_id: Type.Optional(Type.String({ description: "LinkedIn account id." })),
  browser_verification_enabled: Type.Optional(
    Type.Boolean({ description: "Override browser verification flag for this run." }),
  ),
  source_query_mode: optionalStringEnum(SOURCE_QUERY_MODE_VALUES, {
    description:
      "LinkedIn sourcing mode: default keeps query as-is, broad strips niche AI terms from source query.",
  }),
  evidence_query_mode: optionalStringEnum(EVIDENCE_QUERY_MODE_VALUES, {
    description:
      "External evidence mode: default uses normal footprint enrichment, strict adds AI-native proof queries.",
  }),

  limit: Type.Optional(
    Type.Number({ description: "Results limit for results action.", minimum: 1, maximum: 500 }),
  ),

  // Hybrid workflow: promote_candidate
  promotion_reason: Type.Optional(
    Type.String({ description: "Reason for manual promotion (required for promote_candidate)." }),
  ),
  evidence_links: Type.Optional(
    Type.Array(Type.String(), { description: "Proof links for promotion (min 2 required)." }),
  ),
  confidence_override: Type.Optional(
    Type.Number({
      description: "Override identity confidence for promotion (0-1).",
      minimum: 0,
      maximum: 1,
    }),
  ),
  outreach_angle: Type.Optional(
    Type.String({ description: "Suggested outreach angle for the candidate." }),
  ),

  // Hybrid workflow: update_review_status
  review_status: optionalStringEnum(REVIEW_STATUS_VALUES, {
    description: "Review status to set for the candidate.",
  }),
  notes: Type.Optional(Type.String({ description: "Notes for review status or verification." })),

  // Hybrid workflow: verification_submit
  verification_outcome: optionalStringEnum(VERIFICATION_OUTCOME_VALUES, {
    description: "Verification outcome (confirmed, rejected, inconclusive).",
  }),
  proof_links: Type.Optional(
    Type.Array(Type.String(), { description: "Proof links from verification." }),
  ),
  identity_confidence_after: Type.Optional(
    Type.Number({
      description: "Updated identity confidence after verification (0-1).",
      minimum: 0,
      maximum: 1,
    }),
  ),

  // Hybrid workflow: verification_queue
  priority_filter: optionalStringEnum(PRIORITY_FILTER_VALUES, {
    description: "Filter verification queue by priority (high or all).",
  }),

  // Hybrid workflow: daily_report
  date: Type.Optional(
    Type.String({ description: "Date for daily report (YYYY-MM-DD, defaults to today)." }),
  ),
});

function parseNetworkDistance(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const values = raw
    .map((value) => (typeof value === "number" ? value : Number.parseInt(String(value), 10)))
    .filter((value) => Number.isFinite(value) && value >= 1 && value <= 3)
    .map((value) => Math.trunc(value));
  return values.length > 0 ? values : undefined;
}

export function createCandidatePipelineTool(options?: {
  config?: OpenClawConfig;
}): AnyAgentTool | null {
  const cfg = options?.config ?? ({} as OpenClawConfig);
  const recruiting = resolveRecruitingConfig(cfg);
  if (!recruiting.enabled) {
    return null;
  }

  return {
    label: "Candidate Pipeline",
    name: "candidate_pipeline",
    description:
      "Run and inspect the production recruiting pipeline: LinkedIn search, enrichment, identity resolution, scoring, and ranked shortlist output.",
    parameters: CandidatePipelineSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      const service = new CandidatePipelineService(cfg);
      try {
        if (action === "run") {
          const roleKey = readStringParam(params, "role_key", { required: true });
          const roleTitle = readStringParam(params, "role_title", { required: true });
          const keywords = readStringParam(params, "keywords");
          const roleKeywords = readStringArrayParam(params, "role_keywords");
          const skills = readStringArrayParam(params, "skills");
          const companyKeywords = readStringArrayParam(params, "company_keywords");
          const location = readStringParam(params, "location");
          const industry = readStringParam(params, "industry");
          const api = readStringParam(params, "api") as
            | "classic"
            | "recruiter"
            | "sales_navigator"
            | undefined;
          const accountId = readStringParam(params, "account_id");
          const targetCandidates = readNumberParam(params, "target_candidates", { integer: true });
          const networkDistance = parseNetworkDistance(params.network_distance);
          const sourceQueryMode =
            (readStringParam(params, "source_query_mode") as "default" | "broad" | undefined) ??
            undefined;
          const evidenceQueryMode =
            (readStringParam(params, "evidence_query_mode") as "default" | "strict" | undefined) ??
            undefined;

          const roleFilters = roleKeywords?.map((value) => ({ keywords: value })) ?? [];
          const skillFilters = skills?.map((value) => ({ keywords: value })) ?? [];
          const companyFilters = companyKeywords?.map((value) => ({ keywords: value })) ?? [];

          if (!keywords && roleFilters.length === 0 && skillFilters.length === 0) {
            return jsonResult({
              success: false,
              error: "run action requires at least one of keywords, role_keywords, or skills.",
            });
          }

          const result = await service.run({
            role: {
              roleKey,
              roleTitle,
              targetCandidates: targetCandidates ?? undefined,
              search: {
                api,
                keywords,
                role: roleFilters,
                skills: skillFilters,
                company: companyFilters,
                location,
                industry,
                network_distance: networkDistance,
                accountId,
              },
            },
            browserVerificationEnabled:
              typeof params.browser_verification_enabled === "boolean"
                ? params.browser_verification_enabled
                : undefined,
            sourceQueryMode,
            evidenceQueryMode,
          });

          return jsonResult({
            success: true,
            action,
            ...result,
          });
        }

        if (action === "status") {
          const runId = readStringParam(params, "run_id");
          const status = service.status(runId);
          return jsonResult({
            success: true,
            action,
            status,
          });
        }

        if (action === "results") {
          const runId = readStringParam(params, "run_id", { required: true });
          const limit = readNumberParam(params, "limit", { integer: true }) ?? 100;
          const results = service.results(runId, limit);
          return jsonResult({
            success: true,
            action,
            results,
          });
        }

        if (action === "candidate") {
          const candidateId = readStringParam(params, "candidate_id", { required: true });
          const candidate = service.candidate(candidateId);
          return jsonResult({
            success: true,
            action,
            candidate,
          });
        }

        if (action === "promote_candidate") {
          const runId = readStringParam(params, "run_id", { required: true });
          const candidateId = readStringParam(params, "candidate_id", { required: true });
          const promotionReason = readStringParam(params, "promotion_reason", { required: true });
          const evidenceLinks = readStringArrayParam(params, "evidence_links") ?? [];
          const confidenceOverride = readNumberParam(params, "confidence_override");
          const outreachAngle = readStringParam(params, "outreach_angle");

          const result = service.promoteCandidate({
            runId,
            candidateId,
            promotionReason,
            evidenceLinks,
            confidenceOverride: confidenceOverride ?? undefined,
            outreachAngle: outreachAngle ?? undefined,
          });

          return jsonResult({
            success: result.success,
            action,
            error: result.error,
            candidateId,
            runId,
          });
        }

        if (action === "update_review_status") {
          const runId = readStringParam(params, "run_id", { required: true });
          const candidateId = readStringParam(params, "candidate_id", { required: true });
          const reviewStatus = readStringParam(params, "review_status", { required: true }) as
            | "new_review"
            | "under_verification"
            | "promoted_shortlist"
            | "rejected"
            | "deferred";
          const notes = readStringParam(params, "notes");

          service.updateReviewStatus({
            runId,
            candidateId,
            status: reviewStatus,
            notes: notes ?? undefined,
          });

          return jsonResult({
            success: true,
            action,
            candidateId,
            runId,
            status: reviewStatus,
          });
        }

        if (action === "verification_queue") {
          const runId = readStringParam(params, "run_id", { required: true });
          const limit = readNumberParam(params, "limit", { integer: true }) ?? 20;
          const priorityFilter = readStringParam(params, "priority_filter") as
            | "high"
            | "all"
            | undefined;

          const queue = service.getVerificationQueue({
            runId,
            limit,
            priority: priorityFilter,
          });

          return jsonResult({
            success: true,
            action,
            runId,
            count: queue.length,
            candidates: queue,
          });
        }

        if (action === "verification_submit") {
          const runId = readStringParam(params, "run_id", { required: true });
          const candidateId = readStringParam(params, "candidate_id", { required: true });
          const verificationOutcome = readStringParam(params, "verification_outcome", {
            required: true,
          }) as "confirmed" | "rejected" | "inconclusive";
          const proofLinks = readStringArrayParam(params, "proof_links") ?? [];
          const identityConfidenceAfter = readNumberParam(params, "identity_confidence_after");
          const notes = readStringParam(params, "notes");

          service.submitVerification({
            runId,
            candidateId,
            outcome: verificationOutcome,
            proofLinks,
            identityConfidenceAfter: identityConfidenceAfter ?? undefined,
            notes: notes ?? undefined,
          });

          return jsonResult({
            success: true,
            action,
            candidateId,
            runId,
            outcome: verificationOutcome,
          });
        }

        if (action === "daily_report") {
          const runId = readStringParam(params, "run_id");
          const roleKey = readStringParam(params, "role_key", { required: true });
          const date = readStringParam(params, "date");

          const report = service.getDailyReport({
            runId: runId ?? undefined,
            roleKey,
            date: date ?? undefined,
          });

          if (!report) {
            return jsonResult({
              success: false,
              action,
              error: `No runs found for role: ${roleKey}`,
            });
          }

          return jsonResult({
            success: true,
            action,
            roleKey,
            date: date ?? new Date().toISOString().slice(0, 10),
            ...report,
          });
        }

        return jsonResult({
          success: false,
          error: `Unknown action: ${action}`,
        });
      } finally {
        service.close();
      }
    },
  };
}
