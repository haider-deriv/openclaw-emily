import type {
  CandidateEvidenceLink,
  CandidateScore,
  CandidateScoreBreakdown,
  CandidateSignal,
  IdentityResolution,
} from "./types.js";

const WEIGHTS = {
  builder_activity: 0.25,
  ai_native_evidence: 0.25,
  technical_depth: 0.2,
  role_fit: 0.2,
  identity_confidence: 0.1,
} as const;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function scoreFromSignals(signals: CandidateSignal[], key: string): number {
  const values = signals
    .filter((signal) => signal.key === key && typeof signal.numericValue === "number")
    .map((signal) => signal.numericValue as number)
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    return 0;
  }
  return clamp01(Math.max(...values));
}

function hasAiEvidence(evidence: CandidateEvidenceLink[]): boolean {
  const keywords = ["codex", "claude code", "mcp", "agent", "agents", "automation"];
  return evidence.some((item) => {
    const haystack = `${item.title || ""} ${item.url}`.toLowerCase();
    return keywords.some((keyword) => haystack.includes(keyword));
  });
}

export function computeCandidateScore(params: {
  signals: CandidateSignal[];
  identity: IdentityResolution;
  evidence: CandidateEvidenceLink[];
  openToWork?: boolean;
}): CandidateScore {
  const builderActivity = scoreFromSignals(params.signals, "builder_activity");
  const aiNative = Math.max(
    scoreFromSignals(params.signals, "ai_native_evidence"),
    hasAiEvidence(params.evidence) ? 0.7 : 0,
  );
  const technicalDepth = scoreFromSignals(params.signals, "technical_depth");
  const roleFit = scoreFromSignals(params.signals, "role_fit");
  const identityConfidence = clamp01(params.identity.confidence);

  const breakdown: CandidateScoreBreakdown = {
    builder_activity: round3(builderActivity),
    ai_native_evidence: round3(aiNative),
    technical_depth: round3(technicalDepth),
    role_fit: round3(roleFit),
    identity_confidence: round3(identityConfidence),
  };

  const total = round3(
    breakdown.builder_activity * WEIGHTS.builder_activity +
      breakdown.ai_native_evidence * WEIGHTS.ai_native_evidence +
      breakdown.technical_depth * WEIGHTS.technical_depth +
      breakdown.role_fit * WEIGHTS.role_fit +
      breakdown.identity_confidence * WEIGHTS.identity_confidence,
  );

  const concerns: string[] = [];
  if (!params.identity.shortlistEligible) {
    concerns.push("identity_unconfirmed");
  }
  if (breakdown.builder_activity < 0.3) {
    concerns.push("low_recent_builder_activity");
  }
  if (breakdown.ai_native_evidence < 0.3) {
    concerns.push("limited_ai_native_evidence");
  }
  if (breakdown.role_fit < 0.3) {
    concerns.push("weak_role_fit");
  }

  if (params.openToWork === true) {
    // Policy decision: recorded, not penalized
    concerns.push("open_to_work_signal_recorded_no_penalty");
  }

  const outreachAngle =
    breakdown.ai_native_evidence >= 0.6
      ? "Lead with AI-native shipping evidence and ask about current build velocity."
      : breakdown.builder_activity >= 0.6
        ? "Lead with recent shipped work and invite a builder-focused conversation."
        : "Lead with role fit and verify current hands-on project scope.";

  return {
    total,
    shortlistEligible: params.identity.shortlistEligible,
    breakdown,
    concerns,
    outreachAngle,
  };
}
