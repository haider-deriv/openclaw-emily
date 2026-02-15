import type { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  CandidateEvidenceLink,
  CandidatePipelineDiagnostics,
  CandidatePipelineResultRow,
  CandidatePipelineResults,
  CandidatePipelineStatus,
  CandidatePromotionRecord,
  CandidateRecord,
  CandidateReviewRecord,
  CandidateReviewStatus,
  CandidateScore,
  CandidateSignal,
  CandidateVerificationRecord,
  DailyOutputContract,
  IdentityBand,
  IdentityResolution,
  QuotaStatus,
  VerificationOutcome,
  VerificationStats,
  WorkflowStats,
} from "./types.js";
import { requireNodeSqlite } from "../memory/sqlite.js";

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function normalizeProfileUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  const withoutQuery = trimmed.split("?")[0] ?? trimmed;
  return withoutQuery.endsWith("/") ? withoutQuery.slice(0, -1) : withoutQuery;
}

function hashUrl(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function buildCandidateId(input: {
  providerId?: string | null;
  publicIdentifier?: string | null;
  normalizedProfileUrlHash?: string | null;
}): string {
  if (input.providerId) {
    return `li:${input.providerId}`;
  }
  if (input.publicIdentifier) {
    return `li_pub:${input.publicIdentifier}`;
  }
  if (input.normalizedProfileUrlHash) {
    return `li_url:${input.normalizedProfileUrlHash.slice(0, 24)}`;
  }
  return `li_rand:${crypto.randomUUID()}`;
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw.trim()) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export class CandidateStore {
  private readonly db: DatabaseSync;

  constructor(private readonly dbPath: string) {
    const { DatabaseSync } = requireNodeSqlite();
    ensureDir(path.dirname(this.dbPath));
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA journal_mode=WAL;");
    this.db.exec("PRAGMA foreign_keys=ON;");
    this.ensureSchema();
  }

  close(): void {
    this.db.close();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pipeline_runs (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT UNIQUE,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        target_candidates INTEGER NOT NULL,
        role_key TEXT NOT NULL,
        role_title TEXT NOT NULL,
        config_json TEXT,
        summary_json TEXT
      );

      CREATE TABLE IF NOT EXISTS run_roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        role_key TEXT NOT NULL,
        role_title TEXT NOT NULL,
        criteria_json TEXT,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        UNIQUE(run_id, role_key),
        FOREIGN KEY (run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS candidates (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        provider_id TEXT,
        public_identifier TEXT,
        normalized_profile_url_hash TEXT,
        full_name TEXT,
        headline TEXT,
        location TEXT,
        current_company TEXT,
        current_role TEXT,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        UNIQUE(provider, provider_id),
        UNIQUE(provider, public_identifier),
        UNIQUE(provider, normalized_profile_url_hash)
      );

      CREATE TABLE IF NOT EXISTS candidate_source_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        source TEXT NOT NULL,
        source_rank INTEGER,
        raw_json TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(candidate_id, run_id, source, source_rank),
        FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
        FOREIGN KEY (run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS candidate_identities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        handle TEXT,
        url TEXT,
        confidence REAL NOT NULL,
        band TEXT NOT NULL,
        reasons_json TEXT,
        confirmed INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(candidate_id, platform),
        FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS candidate_signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id TEXT NOT NULL,
        signal_key TEXT NOT NULL,
        signal_value TEXT,
        numeric_value REAL,
        observed_at INTEGER NOT NULL,
        source TEXT NOT NULL,
        details_json TEXT,
        FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS candidate_scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        total_score REAL NOT NULL,
        breakdown_json TEXT,
        concerns_json TEXT,
        shortlist_eligible INTEGER NOT NULL,
        outreach_angle TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(candidate_id, run_id),
        FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
        FOREIGN KEY (run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS candidate_evidence_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        url TEXT NOT NULL,
        title TEXT,
        source TEXT NOT NULL,
        relevance REAL,
        created_at INTEGER NOT NULL,
        UNIQUE(candidate_id, run_id, url),
        FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
        FOREIGN KEY (run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS run_failures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        step TEXT NOT NULL,
        candidate_ref TEXT,
        error_type TEXT NOT NULL,
        message TEXT NOT NULL,
        retryable INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        payload_json TEXT,
        FOREIGN KEY (run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS candidate_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER DEFAULT 0,
        notes TEXT,
        updated_by TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(candidate_id, run_id),
        FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
        FOREIGN KEY (run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS candidate_verifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        method TEXT NOT NULL,
        outcome TEXT NOT NULL,
        identity_confidence_before REAL,
        identity_confidence_after REAL,
        proof_json TEXT,
        notes TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
        FOREIGN KEY (run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS candidate_promotions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        promotion_reason TEXT NOT NULL,
        confidence_override REAL,
        outreach_angle TEXT,
        proof_json TEXT,
        promoted_at INTEGER NOT NULL,
        promoted_by TEXT,
        FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
        FOREIGN KEY (run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS daily_run_outputs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        role_key TEXT NOT NULL,
        date TEXT NOT NULL,
        promoted_count INTEGER DEFAULT 0,
        reviewed_count INTEGER DEFAULT 0,
        verified_count INTEGER DEFAULT 0,
        rejected_count INTEGER DEFAULT 0,
        deferred_count INTEGER DEFAULT 0,
        summary_json TEXT,
        generated_at INTEGER NOT NULL,
        UNIQUE(run_id, role_key, date),
        FOREIGN KEY (run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);
      CREATE INDEX IF NOT EXISTS idx_candidates_provider_id ON candidates(provider, provider_id);
      CREATE INDEX IF NOT EXISTS idx_candidates_public_identifier ON candidates(provider, public_identifier);
      CREATE INDEX IF NOT EXISTS idx_candidate_scores_run ON candidate_scores(run_id, total_score DESC);
      CREATE INDEX IF NOT EXISTS idx_candidate_identities_candidate ON candidate_identities(candidate_id);
      CREATE INDEX IF NOT EXISTS idx_run_failures_run ON run_failures(run_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_candidate_reviews_run ON candidate_reviews(run_id, status);
      CREATE INDEX IF NOT EXISTS idx_candidate_reviews_candidate ON candidate_reviews(candidate_id);
      CREATE INDEX IF NOT EXISTS idx_candidate_verifications_run ON candidate_verifications(run_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_candidate_promotions_run ON candidate_promotions(run_id, promoted_at DESC);
      CREATE INDEX IF NOT EXISTS idx_daily_run_outputs_run ON daily_run_outputs(run_id, date);
    `);
  }

  beginRun(params: {
    runId?: string;
    idempotencyKey?: string;
    roleKey: string;
    roleTitle: string;
    targetCandidates: number;
    config?: Record<string, unknown>;
    criteria?: Record<string, unknown>;
  }): { runId: string; resumed: boolean } {
    const now = Date.now();

    if (params.idempotencyKey) {
      const existing = this.db
        .prepare(
          "SELECT id, status FROM pipeline_runs WHERE idempotency_key = ? ORDER BY started_at DESC LIMIT 1",
        )
        .get(params.idempotencyKey) as { id: string; status: string } | undefined;
      if (existing && (existing.status === "running" || existing.status === "completed")) {
        return { runId: existing.id, resumed: true };
      }
    }

    const runId = params.runId || crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO pipeline_runs
         (id, idempotency_key, status, started_at, target_candidates, role_key, role_title, config_json)
         VALUES (?, ?, 'running', ?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        params.idempotencyKey ?? null,
        now,
        params.targetCandidates,
        params.roleKey,
        params.roleTitle,
        params.config ? JSON.stringify(params.config) : null,
      );

    this.db
      .prepare(
        `INSERT INTO run_roles
         (run_id, role_key, role_title, criteria_json, status, started_at)
         VALUES (?, ?, ?, ?, 'running', ?)`,
      )
      .run(runId, params.roleKey, params.roleTitle, JSON.stringify(params.criteria ?? {}), now);

    return { runId, resumed: false };
  }

  markRunCompleted(runId: string, summary?: Record<string, unknown>): void {
    const now = Date.now();
    this.db
      .prepare(
        "UPDATE pipeline_runs SET status='completed', finished_at=?, summary_json=? WHERE id=?",
      )
      .run(now, summary ? JSON.stringify(summary) : null, runId);
    this.db
      .prepare("UPDATE run_roles SET status='completed', finished_at=? WHERE run_id=?")
      .run(now, runId);
  }

  markRunFailed(runId: string, summary?: Record<string, unknown>): void {
    const now = Date.now();
    this.db
      .prepare("UPDATE pipeline_runs SET status='failed', finished_at=?, summary_json=? WHERE id=?")
      .run(now, summary ? JSON.stringify(summary) : null, runId);
    this.db
      .prepare("UPDATE run_roles SET status='failed', finished_at=? WHERE run_id=?")
      .run(now, runId);
  }

  recordFailure(params: {
    runId: string;
    step: string;
    candidateRef?: string;
    errorType: string;
    message: string;
    retryable: boolean;
    payload?: Record<string, unknown>;
  }): void {
    this.db
      .prepare(
        `INSERT INTO run_failures
         (run_id, step, candidate_ref, error_type, message, retryable, created_at, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.runId,
        params.step,
        params.candidateRef ?? null,
        params.errorType,
        params.message,
        params.retryable ? 1 : 0,
        Date.now(),
        params.payload ? JSON.stringify(params.payload) : null,
      );
  }

  upsertCandidate(input: CandidateRecord): {
    candidateId: string;
    normalizedProfileUrlHash: string | null;
  } {
    const now = Date.now();
    const normalizedProfileUrl = normalizeProfileUrl(input.profileUrl ?? null);
    const normalizedProfileUrlHash = normalizedProfileUrl ? hashUrl(normalizedProfileUrl) : null;

    const existing = this.db
      .prepare(
        `SELECT id FROM candidates
         WHERE (provider = 'linkedin' AND provider_id = ?)
            OR (provider = 'linkedin' AND public_identifier = ?)
            OR (provider = 'linkedin' AND normalized_profile_url_hash = ?)
         LIMIT 1`,
      )
      .get(input.providerId ?? null, input.publicIdentifier ?? null, normalizedProfileUrlHash) as
      | { id: string }
      | undefined;

    const candidateId =
      existing?.id ??
      buildCandidateId({
        providerId: input.providerId,
        publicIdentifier: input.publicIdentifier,
        normalizedProfileUrlHash,
      });

    this.db
      .prepare(
        `INSERT INTO candidates
         (id, provider, provider_id, public_identifier, normalized_profile_url_hash, full_name, headline, location, current_company, current_role, first_seen_at, last_seen_at)
         VALUES (?, 'linkedin', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           provider_id=excluded.provider_id,
           public_identifier=excluded.public_identifier,
           normalized_profile_url_hash=excluded.normalized_profile_url_hash,
           full_name=excluded.full_name,
           headline=excluded.headline,
           location=excluded.location,
           current_company=excluded.current_company,
           current_role=excluded.current_role,
           last_seen_at=excluded.last_seen_at`,
      )
      .run(
        candidateId,
        input.providerId ?? null,
        input.publicIdentifier ?? null,
        normalizedProfileUrlHash,
        input.name ?? null,
        input.headline ?? null,
        input.location ?? null,
        input.currentCompany ?? null,
        input.currentRole ?? null,
        now,
        now,
      );

    return { candidateId, normalizedProfileUrlHash };
  }

  addSourceRecord(params: {
    candidateId: string;
    runId: string;
    source: string;
    sourceRank: number;
    raw: Record<string, unknown>;
  }): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO candidate_source_records
         (candidate_id, run_id, source, source_rank, raw_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.candidateId,
        params.runId,
        params.source,
        params.sourceRank,
        JSON.stringify(params.raw),
        Date.now(),
      );
  }

  upsertIdentity(params: {
    candidateId: string;
    platform: string;
    handle?: string;
    url?: string;
    resolution: IdentityResolution;
  }): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO candidate_identities
         (candidate_id, platform, handle, url, confidence, band, reasons_json, confirmed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(candidate_id, platform) DO UPDATE SET
           handle=excluded.handle,
           url=excluded.url,
           confidence=excluded.confidence,
           band=excluded.band,
           reasons_json=excluded.reasons_json,
           confirmed=excluded.confirmed,
           updated_at=excluded.updated_at`,
      )
      .run(
        params.candidateId,
        params.platform,
        params.handle ?? null,
        params.url ?? null,
        params.resolution.confidence,
        params.resolution.band,
        JSON.stringify(params.resolution.reasons),
        params.resolution.shortlistEligible ? 1 : 0,
        now,
        now,
      );
  }

  addSignals(candidateId: string, signals: CandidateSignal[]): void {
    if (signals.length === 0) {
      return;
    }
    const stmt = this.db.prepare(
      `INSERT INTO candidate_signals
       (candidate_id, signal_key, signal_value, numeric_value, observed_at, source, details_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = Date.now();
    this.db.exec("BEGIN");
    try {
      for (const signal of signals) {
        stmt.run(
          candidateId,
          signal.key,
          signal.value ?? null,
          signal.numericValue ?? null,
          now,
          signal.source,
          signal.details ? JSON.stringify(signal.details) : null,
        );
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  upsertScore(params: { candidateId: string; runId: string; score: CandidateScore }): void {
    this.db
      .prepare(
        `INSERT INTO candidate_scores
         (candidate_id, run_id, total_score, breakdown_json, concerns_json, shortlist_eligible, outreach_angle, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(candidate_id, run_id) DO UPDATE SET
           total_score=excluded.total_score,
           breakdown_json=excluded.breakdown_json,
           concerns_json=excluded.concerns_json,
           shortlist_eligible=excluded.shortlist_eligible,
           outreach_angle=excluded.outreach_angle,
           created_at=excluded.created_at`,
      )
      .run(
        params.candidateId,
        params.runId,
        params.score.total,
        JSON.stringify(params.score.breakdown),
        JSON.stringify(params.score.concerns),
        params.score.shortlistEligible ? 1 : 0,
        params.score.outreachAngle,
        Date.now(),
      );
  }

  addEvidenceLinks(params: {
    candidateId: string;
    runId: string;
    links: CandidateEvidenceLink[];
  }): void {
    if (params.links.length === 0) {
      return;
    }
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO candidate_evidence_links
       (candidate_id, run_id, url, title, source, relevance, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = Date.now();
    this.db.exec("BEGIN");
    try {
      for (const link of params.links) {
        stmt.run(
          params.candidateId,
          params.runId,
          link.url,
          link.title ?? null,
          link.source,
          link.relevance ?? null,
          now,
        );
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  getRunStatus(runId: string): CandidatePipelineStatus | null {
    const row = this.db
      .prepare(
        `SELECT id, status, started_at, finished_at, target_candidates, role_key, role_title, summary_json
         FROM pipeline_runs
         WHERE id = ?`,
      )
      .get(runId) as
      | {
          id: string;
          status: "running" | "completed" | "failed";
          started_at: number;
          finished_at: number | null;
          target_candidates: number;
          role_key: string;
          role_title: string;
          summary_json: string | null;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      runId: row.id,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at ?? undefined,
      targetCandidates: row.target_candidates,
      roleKey: row.role_key,
      roleTitle: row.role_title,
      diagnostics: parseJson<CandidatePipelineDiagnostics | undefined>(row.summary_json, undefined),
    };
  }

  listRecentRuns(limit = 20): CandidatePipelineStatus[] {
    const rows = this.db
      .prepare(
        `SELECT id, status, started_at, finished_at, target_candidates, role_key, role_title, summary_json
         FROM pipeline_runs
         ORDER BY started_at DESC
         LIMIT ?`,
      )
      .all(Math.max(1, Math.trunc(limit))) as Array<{
      id: string;
      status: "running" | "completed" | "failed";
      started_at: number;
      finished_at: number | null;
      target_candidates: number;
      role_key: string;
      role_title: string;
      summary_json: string | null;
    }>;

    return rows.map((row) => ({
      runId: row.id,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at ?? undefined,
      targetCandidates: row.target_candidates,
      roleKey: row.role_key,
      roleTitle: row.role_title,
      diagnostics: parseJson<CandidatePipelineDiagnostics | undefined>(row.summary_json, undefined),
    }));
  }

  getCandidate(candidateId: string): Record<string, unknown> | null {
    const candidate = this.db
      .prepare(
        `SELECT id, provider, provider_id, public_identifier, full_name, headline, location, current_company, current_role,
                first_seen_at, last_seen_at
         FROM candidates
         WHERE id = ?`,
      )
      .get(candidateId) as
      | {
          id: string;
          provider: string;
          provider_id: string | null;
          public_identifier: string | null;
          full_name: string | null;
          headline: string | null;
          location: string | null;
          current_company: string | null;
          current_role: string | null;
          first_seen_at: number;
          last_seen_at: number;
        }
      | undefined;

    if (!candidate) {
      return null;
    }

    const identities = this.db
      .prepare(
        `SELECT platform, handle, url, confidence, band, reasons_json, confirmed, updated_at
         FROM candidate_identities
         WHERE candidate_id = ?
         ORDER BY confidence DESC`,
      )
      .all(candidateId) as Array<{
      platform: string;
      handle: string | null;
      url: string | null;
      confidence: number;
      band: IdentityBand;
      reasons_json: string | null;
      confirmed: number;
      updated_at: number;
    }>;

    const evidence = this.db
      .prepare(
        `SELECT run_id, url, title, source, relevance, created_at
         FROM candidate_evidence_links
         WHERE candidate_id = ?
         ORDER BY created_at DESC`,
      )
      .all(candidateId) as Array<{
      run_id: string;
      url: string;
      title: string | null;
      source: string;
      relevance: number | null;
      created_at: number;
    }>;

    const scores = this.db
      .prepare(
        `SELECT run_id, total_score, breakdown_json, concerns_json, shortlist_eligible, outreach_angle, created_at
         FROM candidate_scores
         WHERE candidate_id = ?
         ORDER BY created_at DESC`,
      )
      .all(candidateId) as Array<{
      run_id: string;
      total_score: number;
      breakdown_json: string | null;
      concerns_json: string | null;
      shortlist_eligible: number;
      outreach_angle: string | null;
      created_at: number;
    }>;

    return {
      candidate: candidate,
      identities: identities.map((identity) => ({
        platform: identity.platform,
        handle: identity.handle,
        url: identity.url,
        confidence: identity.confidence,
        band: identity.band,
        reasons: parseJson<string[]>(identity.reasons_json, []),
        confirmed: identity.confirmed === 1,
        updatedAt: identity.updated_at,
      })),
      evidence,
      scores: scores.map((score) => ({
        runId: score.run_id,
        total: score.total_score,
        breakdown: parseJson<Record<string, number>>(score.breakdown_json, {}),
        concerns: parseJson<string[]>(score.concerns_json, []),
        shortlistEligible: score.shortlist_eligible === 1,
        outreachAngle: score.outreach_angle,
        createdAt: score.created_at,
      })),
    };
  }

  getResults(runId: string, limit = 50): CandidatePipelineResults {
    const runMeta = this.db
      .prepare("SELECT summary_json FROM pipeline_runs WHERE id = ?")
      .get(runId) as { summary_json: string | null } | undefined;
    const diagnostics = parseJson<CandidatePipelineDiagnostics | undefined>(
      runMeta?.summary_json ?? null,
      undefined,
    );

    const rows = this.db
      .prepare(
        `SELECT c.id AS candidate_id,
                c.full_name,
                c.headline,
                c.location,
                s.total_score,
                s.shortlist_eligible,
                s.outreach_angle,
                s.concerns_json,
                i.band,
                i.confidence
         FROM candidate_scores s
         JOIN candidates c ON c.id = s.candidate_id
         LEFT JOIN candidate_identities i ON i.candidate_id = c.id AND i.platform = 'cross_platform'
         WHERE s.run_id = ?
         ORDER BY s.total_score DESC
         LIMIT ?`,
      )
      .all(runId, Math.max(1, Math.trunc(limit))) as Array<{
      candidate_id: string;
      full_name: string | null;
      headline: string | null;
      location: string | null;
      total_score: number;
      shortlist_eligible: number;
      outreach_angle: string | null;
      concerns_json: string | null;
      band: IdentityBand | null;
      confidence: number | null;
    }>;

    const shortlist: CandidatePipelineResultRow[] = [];
    const reviewQueue: CandidatePipelineResultRow[] = [];

    for (const row of rows) {
      const evidence = this.db
        .prepare(
          `SELECT url, title, source, relevance
           FROM candidate_evidence_links
           WHERE candidate_id = ? AND run_id = ?
           ORDER BY relevance DESC, created_at DESC
           LIMIT 3`,
        )
        .all(row.candidate_id, runId) as Array<{
        url: string;
        title: string | null;
        source: string;
        relevance: number | null;
      }>;

      const item: CandidatePipelineResultRow = {
        candidateId: row.candidate_id,
        name: row.full_name ?? "Unknown",
        headline: row.headline ?? undefined,
        location: row.location ?? undefined,
        totalScore: row.total_score,
        shortlistEligible: row.shortlist_eligible === 1,
        identityBand: row.band ?? "LOW",
        identityConfidence: row.confidence ?? 0,
        outreachAngle: row.outreach_angle ?? "",
        topEvidence: evidence.map((entry) => ({
          url: entry.url,
          title: entry.title ?? undefined,
          source: entry.source,
          relevance: entry.relevance ?? undefined,
        })),
        concerns: parseJson<string[]>(row.concerns_json, []),
      };

      if (item.shortlistEligible) {
        shortlist.push(item);
      } else {
        reviewQueue.push(item);
      }
    }

    return {
      runId,
      shortlist,
      reviewQueue,
      meta: {
        generatedAt: Date.now(),
        totalCandidates: rows.length,
        shortlistCount: shortlist.length,
        reviewCount: reviewQueue.length,
        counts: diagnostics?.counts,
        errorsByStage: diagnostics?.errorsByStage,
        searchQueryUsed: diagnostics?.searchQueryUsed,
        modes: diagnostics?.modes,
        accountHealth: diagnostics?.accountHealth,
        failure: diagnostics?.failure,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Hybrid workflow: Review status management
  // ─────────────────────────────────────────────────────────────────────────────

  upsertReviewStatus(params: {
    candidateId: string;
    runId: string;
    status: CandidateReviewStatus;
    priority?: number;
    notes?: string;
    updatedBy?: string;
  }): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO candidate_reviews
         (candidate_id, run_id, status, priority, notes, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(candidate_id, run_id) DO UPDATE SET
           status=excluded.status,
           priority=excluded.priority,
           notes=excluded.notes,
           updated_by=excluded.updated_by,
           updated_at=excluded.updated_at`,
      )
      .run(
        params.candidateId,
        params.runId,
        params.status,
        params.priority ?? 0,
        params.notes ?? null,
        params.updatedBy ?? null,
        now,
        now,
      );
  }

  getReviewStatus(candidateId: string, runId: string): CandidateReviewRecord | null {
    const row = this.db
      .prepare(
        `SELECT candidate_id, run_id, status, priority, notes, updated_by, created_at, updated_at
         FROM candidate_reviews
         WHERE candidate_id = ? AND run_id = ?`,
      )
      .get(candidateId, runId) as
      | {
          candidate_id: string;
          run_id: string;
          status: CandidateReviewStatus;
          priority: number;
          notes: string | null;
          updated_by: string | null;
          created_at: number;
          updated_at: number;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      candidateId: row.candidate_id,
      runId: row.run_id,
      status: row.status,
      priority: row.priority,
      notes: row.notes ?? undefined,
      updatedBy: row.updated_by ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Hybrid workflow: Verification queue management
  // ─────────────────────────────────────────────────────────────────────────────

  getVerificationQueue(params: {
    runId: string;
    limit: number;
    priority?: "high" | "all";
  }): CandidatePipelineResultRow[] {
    const priorityFilter = params.priority === "high" ? "AND r.priority >= 50" : "";
    const rows = this.db
      .prepare(
        `SELECT c.id AS candidate_id,
                c.full_name,
                c.headline,
                c.location,
                s.total_score,
                s.shortlist_eligible,
                s.outreach_angle,
                s.concerns_json,
                i.band,
                i.confidence,
                r.priority,
                r.status AS review_status
         FROM candidate_reviews r
         JOIN candidates c ON c.id = r.candidate_id
         JOIN candidate_scores s ON s.candidate_id = c.id AND s.run_id = r.run_id
         LEFT JOIN candidate_identities i ON i.candidate_id = c.id AND i.platform = 'cross_platform'
         WHERE r.run_id = ? AND r.status = 'under_verification' ${priorityFilter}
         ORDER BY r.priority DESC, s.total_score DESC
         LIMIT ?`,
      )
      .all(params.runId, Math.max(1, Math.trunc(params.limit))) as Array<{
      candidate_id: string;
      full_name: string | null;
      headline: string | null;
      location: string | null;
      total_score: number;
      shortlist_eligible: number;
      outreach_angle: string | null;
      concerns_json: string | null;
      band: IdentityBand | null;
      confidence: number | null;
      priority: number;
      review_status: CandidateReviewStatus;
    }>;

    return rows.map((row) => {
      const evidence = this.db
        .prepare(
          `SELECT url, title, source, relevance
           FROM candidate_evidence_links
           WHERE candidate_id = ? AND run_id = ?
           ORDER BY relevance DESC, created_at DESC
           LIMIT 3`,
        )
        .all(row.candidate_id, params.runId) as Array<{
        url: string;
        title: string | null;
        source: string;
        relevance: number | null;
      }>;

      return {
        candidateId: row.candidate_id,
        name: row.full_name ?? "Unknown",
        headline: row.headline ?? undefined,
        location: row.location ?? undefined,
        totalScore: row.total_score,
        shortlistEligible: row.shortlist_eligible === 1,
        identityBand: row.band ?? "LOW",
        identityConfidence: row.confidence ?? 0,
        outreachAngle: row.outreach_angle ?? "",
        topEvidence: evidence.map((entry) => ({
          url: entry.url,
          title: entry.title ?? undefined,
          source: entry.source,
          relevance: entry.relevance ?? undefined,
        })),
        concerns: parseJson<string[]>(row.concerns_json, []),
      };
    });
  }

  submitVerification(params: {
    candidateId: string;
    runId: string;
    method: "browser" | "api";
    outcome: VerificationOutcome;
    identityConfidenceBefore?: number;
    identityConfidenceAfter?: number;
    proofLinks: string[];
    notes?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO candidate_verifications
         (candidate_id, run_id, method, outcome, identity_confidence_before, identity_confidence_after, proof_json, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.candidateId,
        params.runId,
        params.method,
        params.outcome,
        params.identityConfidenceBefore ?? null,
        params.identityConfidenceAfter ?? null,
        JSON.stringify(params.proofLinks),
        params.notes ?? null,
        Date.now(),
      );
  }

  getVerification(candidateId: string, runId: string): CandidateVerificationRecord | null {
    const row = this.db
      .prepare(
        `SELECT candidate_id, run_id, method, outcome, identity_confidence_before, identity_confidence_after, proof_json, notes, created_at
         FROM candidate_verifications
         WHERE candidate_id = ? AND run_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(candidateId, runId) as
      | {
          candidate_id: string;
          run_id: string;
          method: "browser" | "api";
          outcome: VerificationOutcome;
          identity_confidence_before: number | null;
          identity_confidence_after: number | null;
          proof_json: string | null;
          notes: string | null;
          created_at: number;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      candidateId: row.candidate_id,
      runId: row.run_id,
      method: row.method,
      outcome: row.outcome,
      identityConfidenceBefore: row.identity_confidence_before ?? undefined,
      identityConfidenceAfter: row.identity_confidence_after ?? undefined,
      proofLinks: parseJson<string[]>(row.proof_json, []),
      notes: row.notes ?? undefined,
      createdAt: row.created_at,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Hybrid workflow: Promotion management
  // ─────────────────────────────────────────────────────────────────────────────

  promoteCandidate(params: {
    candidateId: string;
    runId: string;
    promotionReason: string;
    confidenceOverride?: number;
    outreachAngle?: string;
    proofLinks: string[];
    promotedBy?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO candidate_promotions
         (candidate_id, run_id, promotion_reason, confidence_override, outreach_angle, proof_json, promoted_at, promoted_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.candidateId,
        params.runId,
        params.promotionReason,
        params.confidenceOverride ?? null,
        params.outreachAngle ?? null,
        JSON.stringify(params.proofLinks),
        Date.now(),
        params.promotedBy ?? null,
      );

    // Update review status to promoted_shortlist
    this.upsertReviewStatus({
      candidateId: params.candidateId,
      runId: params.runId,
      status: "promoted_shortlist",
      updatedBy: params.promotedBy,
    });
  }

  getPromotion(candidateId: string, runId: string): CandidatePromotionRecord | null {
    const row = this.db
      .prepare(
        `SELECT candidate_id, run_id, promotion_reason, confidence_override, outreach_angle, proof_json, promoted_at, promoted_by
         FROM candidate_promotions
         WHERE candidate_id = ? AND run_id = ?
         ORDER BY promoted_at DESC
         LIMIT 1`,
      )
      .get(candidateId, runId) as
      | {
          candidate_id: string;
          run_id: string;
          promotion_reason: string;
          confidence_override: number | null;
          outreach_angle: string | null;
          proof_json: string | null;
          promoted_at: number;
          promoted_by: string | null;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      candidateId: row.candidate_id,
      runId: row.run_id,
      promotionReason: row.promotion_reason,
      confidenceOverride: row.confidence_override ?? undefined,
      outreachAngle: row.outreach_angle ?? undefined,
      proofLinks: parseJson<string[]>(row.proof_json, []),
      promotedAt: row.promoted_at,
      promotedBy: row.promoted_by ?? undefined,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Hybrid workflow: Daily output tracking
  // ─────────────────────────────────────────────────────────────────────────────

  getDailyOutputContract(runId: string, roleKey: string, date: string): DailyOutputContract | null {
    const row = this.db
      .prepare(
        `SELECT run_id, role_key, date, promoted_count, reviewed_count, verified_count, rejected_count, deferred_count, generated_at
         FROM daily_run_outputs
         WHERE run_id = ? AND role_key = ? AND date = ?`,
      )
      .get(runId, roleKey, date) as
      | {
          run_id: string;
          role_key: string;
          date: string;
          promoted_count: number;
          reviewed_count: number;
          verified_count: number;
          rejected_count: number;
          deferred_count: number;
          generated_at: number;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      runId: row.run_id,
      roleKey: row.role_key,
      date: row.date,
      promotedCount: row.promoted_count,
      reviewedCount: row.reviewed_count,
      verifiedCount: row.verified_count,
      rejectedCount: row.rejected_count,
      deferredCount: row.deferred_count,
      generatedAt: row.generated_at,
    };
  }

  updateDailyOutputContract(params: {
    runId: string;
    roleKey: string;
    date: string;
    counts: Partial<Omit<DailyOutputContract, "runId" | "roleKey" | "date" | "generatedAt">>;
  }): void {
    const now = Date.now();
    const existing = this.getDailyOutputContract(params.runId, params.roleKey, params.date);

    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO daily_run_outputs
           (run_id, role_key, date, promoted_count, reviewed_count, verified_count, rejected_count, deferred_count, generated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          params.runId,
          params.roleKey,
          params.date,
          params.counts.promotedCount ?? 0,
          params.counts.reviewedCount ?? 0,
          params.counts.verifiedCount ?? 0,
          params.counts.rejectedCount ?? 0,
          params.counts.deferredCount ?? 0,
          now,
        );
      return;
    }

    this.db
      .prepare(
        `UPDATE daily_run_outputs SET
           promoted_count = ?,
           reviewed_count = ?,
           verified_count = ?,
           rejected_count = ?,
           deferred_count = ?,
           generated_at = ?
         WHERE run_id = ? AND role_key = ? AND date = ?`,
      )
      .run(
        params.counts.promotedCount ?? existing.promotedCount,
        params.counts.reviewedCount ?? existing.reviewedCount,
        params.counts.verifiedCount ?? existing.verifiedCount,
        params.counts.rejectedCount ?? existing.rejectedCount,
        params.counts.deferredCount ?? existing.deferredCount,
        now,
        params.runId,
        params.roleKey,
        params.date,
      );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Hybrid workflow: Stats queries
  // ─────────────────────────────────────────────────────────────────────────────

  getWorkflowStats(runId: string): WorkflowStats {
    const row = this.db
      .prepare(
        `SELECT
           SUM(CASE WHEN status IN ('promoted_shortlist', 'rejected', 'deferred') THEN 1 ELSE 0 END) AS reviewed_count,
           SUM(CASE WHEN status = 'promoted_shortlist' THEN 1 ELSE 0 END) AS promoted_count,
           SUM(CASE WHEN status = 'deferred' THEN 1 ELSE 0 END) AS deferred_count,
           SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected_count
         FROM candidate_reviews
         WHERE run_id = ?`,
      )
      .get(runId) as {
      reviewed_count: number | null;
      promoted_count: number | null;
      deferred_count: number | null;
      rejected_count: number | null;
    };

    return {
      reviewedCount: row.reviewed_count ?? 0,
      promotedCount: row.promoted_count ?? 0,
      deferredCount: row.deferred_count ?? 0,
      rejectedCount: row.rejected_count ?? 0,
    };
  }

  getVerificationStats(runId: string): VerificationStats {
    const queuedRow = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM candidate_reviews
         WHERE run_id = ? AND status = 'under_verification'`,
      )
      .get(runId) as { count: number };

    const completedRow = this.db
      .prepare(
        `SELECT
           COUNT(*) AS completed,
           SUM(CASE WHEN method = 'browser' THEN 1 ELSE 0 END) AS browser_verified
         FROM candidate_verifications
         WHERE run_id = ?`,
      )
      .get(runId) as { completed: number; browser_verified: number | null };

    // Count blocked domain hits from run_failures
    const blockedRow = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM run_failures
         WHERE run_id = ? AND error_type = 'blocked_domain'`,
      )
      .get(runId) as { count: number };

    return {
      queued: queuedRow.count,
      completed: completedRow.completed,
      browserVerified: completedRow.browser_verified ?? 0,
      blockedDomainHits: blockedRow.count,
    };
  }

  getQuotaStatus(
    runId: string,
    date: string,
    quotaConfig?: {
      verificationBudgetDaily?: number;
      promotionsTargetDaily?: number;
      reviewedTargetDaily?: number;
    },
  ): QuotaStatus {
    // Get counts for today
    const verifiedToday = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM candidate_verifications
         WHERE run_id = ? AND created_at >= ? AND created_at < ?`,
      )
      .get(runId, new Date(date).getTime(), new Date(date).getTime() + 24 * 60 * 60 * 1000) as {
      count: number;
    };

    const promotedToday = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM candidate_promotions
         WHERE run_id = ? AND promoted_at >= ? AND promoted_at < ?`,
      )
      .get(runId, new Date(date).getTime(), new Date(date).getTime() + 24 * 60 * 60 * 1000) as {
      count: number;
    };

    const reviewedToday = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM candidate_reviews
         WHERE run_id = ? AND status IN ('promoted_shortlist', 'rejected', 'deferred')
               AND updated_at >= ? AND updated_at < ?`,
      )
      .get(runId, new Date(date).getTime(), new Date(date).getTime() + 24 * 60 * 60 * 1000) as {
      count: number;
    };

    return {
      verificationBudgetDaily: quotaConfig?.verificationBudgetDaily ?? 20,
      verificationUsedToday: verifiedToday.count,
      promotionsTargetDaily: quotaConfig?.promotionsTargetDaily ?? 10,
      promotionsToday: promotedToday.count,
      reviewedTargetDaily: quotaConfig?.reviewedTargetDaily ?? 30,
      reviewedToday: reviewedToday.count,
    };
  }
}
