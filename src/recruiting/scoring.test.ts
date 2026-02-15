import { describe, expect, it } from "vitest";
import { computeCandidateScore } from "./scoring.js";

describe("computeCandidateScore", () => {
  it("is deterministic for same inputs", () => {
    const input = {
      signals: [
        { key: "builder_activity", numericValue: 0.8, source: "test" },
        { key: "ai_native_evidence", numericValue: 0.7, source: "test" },
        { key: "technical_depth", numericValue: 0.6, source: "test" },
        { key: "role_fit", numericValue: 0.9, source: "test" },
      ],
      identity: {
        confidence: 0.91,
        band: "CONFIRMED" as const,
        shortlistEligible: true,
        reasons: ["direct_profile_link"],
      },
      evidence: [
        {
          url: "https://github.com/alice",
          title: "Codex agent repo",
          source: "exa.search",
          relevance: 0.7,
        },
      ],
      openToWork: true,
    };

    const first = computeCandidateScore(input);
    const second = computeCandidateScore(input);

    expect(first).toEqual(second);
    expect(first.shortlistEligible).toBe(true);
    expect(first.concerns).toContain("open_to_work_signal_recorded_no_penalty");
  });

  it("flags low-confidence identities out of shortlist", () => {
    const score = computeCandidateScore({
      signals: [{ key: "builder_activity", numericValue: 0.4, source: "test" }],
      identity: {
        confidence: 0.55,
        band: "LOW",
        shortlistEligible: false,
        reasons: ["unconfirmed_no_strong_match"],
      },
      evidence: [],
    });

    expect(score.shortlistEligible).toBe(false);
    expect(score.concerns).toContain("identity_unconfirmed");
  });
});
