import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CandidateStore } from "./store.js";

const tempDirs: string[] = [];

function makeStore(): { store: CandidateStore; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-recruiting-"));
  tempDirs.push(dir);
  const store = new CandidateStore(path.join(dir, "candidates.sqlite"));
  return { store, dir };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("CandidateStore", () => {
  it("dedupes candidates by provider id across upserts", () => {
    const { store } = makeStore();
    try {
      const first = store.upsertCandidate({
        providerId: "abc",
        publicIdentifier: "alice",
        profileUrl: "https://linkedin.com/in/alice",
        name: "Alice",
      });
      const second = store.upsertCandidate({
        providerId: "abc",
        publicIdentifier: "alice-renamed",
        profileUrl: "https://linkedin.com/in/alice",
        name: "Alice 2",
      });

      expect(second.candidateId).toBe(first.candidateId);
    } finally {
      store.close();
    }
  });

  it("resumes runs by idempotency key", () => {
    const { store } = makeStore();
    try {
      const run1 = store.beginRun({
        idempotencyKey: "role:2026-01-01",
        roleKey: "backend",
        roleTitle: "Backend Engineer",
        targetCandidates: 300,
      });
      const run2 = store.beginRun({
        idempotencyKey: "role:2026-01-01",
        roleKey: "backend",
        roleTitle: "Backend Engineer",
        targetCandidates: 300,
      });

      expect(run1.resumed).toBe(false);
      expect(run2.resumed).toBe(true);
      expect(run2.runId).toBe(run1.runId);
    } finally {
      store.close();
    }
  });

  it("exposes run diagnostics on status and results metadata", () => {
    const { store } = makeStore();
    try {
      const run = store.beginRun({
        roleKey: "ai-native",
        roleTitle: "AI Native Builder",
        targetCandidates: 50,
      });

      const candidate = store.upsertCandidate({
        providerId: "user-1",
        publicIdentifier: "alice-dev",
        profileUrl: "https://www.linkedin.com/in/alice-dev",
        name: "Alice Dev",
      });

      store.upsertScore({
        candidateId: candidate.candidateId,
        runId: run.runId,
        score: {
          total: 0.78,
          shortlistEligible: true,
          breakdown: {
            builder_activity: 0.8,
            ai_native_evidence: 0.7,
            technical_depth: 0.6,
            role_fit: 0.7,
            identity_confidence: 0.9,
          },
          concerns: [],
          outreachAngle: "Builder-first outreach",
        },
      });

      store.markRunCompleted(run.runId, {
        counts: {
          sourced: 12,
          enriched: 10,
          enrichFailed: 2,
          externalDiscovered: 7,
          identityConfirmedHigh: 5,
          identityMediumLow: 5,
          shortlistEligible: 3,
        },
        errorsByStage: [
          {
            stage: "candidate_enrich_score",
            count: 2,
            topMessages: [
              {
                message: "LinkedIn API error (429)",
                errorType: "rate_limit",
                count: 2,
              },
            ],
          },
        ],
        searchQueryUsed: {
          api: "classic",
          roleKeywords: ["staff engineer"],
          skills: ["typescript"],
          companyKeywords: [],
          networkDistance: [2],
          pageSize: 50,
          maxPages: 3,
        },
        modes: {
          sourceQueryMode: "broad",
          evidenceQueryMode: "strict",
        },
        accountHealth: {
          resolvedAccountId: "default",
          enabled: true,
          apiKeySource: "env",
          missingCredentials: [],
          recruiterReady: true,
        },
      });

      const status = store.getRunStatus(run.runId);
      const results = store.getResults(run.runId, 10);

      expect(status?.diagnostics?.counts.sourced).toBe(12);
      expect(results.meta.counts?.enriched).toBe(10);
      expect(results.meta.errorsByStage?.[0]?.stage).toBe("candidate_enrich_score");
      expect(results.meta.modes?.sourceQueryMode).toBe("broad");
      expect(results.meta.accountHealth?.resolvedAccountId).toBe("default");
    } finally {
      store.close();
    }
  });
});
