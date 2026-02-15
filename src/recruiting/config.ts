import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";

export type RecruitingConfig = {
  enabled: boolean;
  store: {
    path: string;
  };
  identity: {
    minConfidenceForShortlist: number;
  };
  run: {
    targetCandidatesPerRole: number;
    defaultCadence: string;
  };
  browserVerification: {
    enabled: boolean;
    mode: "high_only" | "always";
  };
  dailyQuotas?: {
    promotedTarget: number;
    reviewedTarget: number;
    verificationBudget: number;
  };
  promotion?: {
    minProofLinks: number;
    allowUnverifiedPromotion: boolean;
  };
  laneTargeting?: {
    g1Percentage: number;
    g2Percentage: number;
  };
};

function clampNumber(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

export function resolveRecruitingConfig(cfg?: OpenClawConfig): RecruitingConfig {
  const recruiting = (cfg?.tools as { recruiting?: Record<string, unknown> } | undefined)
    ?.recruiting;
  const store = (recruiting?.store as Record<string, unknown> | undefined) ?? {};
  const identity = (recruiting?.identity as Record<string, unknown> | undefined) ?? {};
  const run = (recruiting?.run as Record<string, unknown> | undefined) ?? {};
  const browserVerification =
    (recruiting?.browserVerification as Record<string, unknown> | undefined) ?? {};
  const dailyQuotas = (recruiting?.dailyQuotas as Record<string, unknown> | undefined) ?? {};
  const promotion = (recruiting?.promotion as Record<string, unknown> | undefined) ?? {};
  const laneTargeting = (recruiting?.laneTargeting as Record<string, unknown> | undefined) ?? {};

  const stateDir = resolveStateDir();

  const configuredPath = typeof store.path === "string" ? store.path.trim() : "";
  const storePath = configuredPath || path.join(stateDir, "recruiting", "candidates.sqlite");

  const minConfidenceRaw =
    typeof identity.minConfidenceForShortlist === "number"
      ? identity.minConfidenceForShortlist
      : undefined;
  const targetCandidatesRaw =
    typeof run.targetCandidatesPerRole === "number" ? run.targetCandidatesPerRole : undefined;
  const cadenceRaw = typeof run.defaultCadence === "string" ? run.defaultCadence.trim() : "";

  const modeRaw =
    typeof browserVerification.mode === "string"
      ? browserVerification.mode.trim().toLowerCase()
      : "";
  const mode: "high_only" | "always" = modeRaw === "always" ? "always" : "high_only";

  // Parse dailyQuotas
  const promotedTargetRaw =
    typeof dailyQuotas.promotedTarget === "number" ? dailyQuotas.promotedTarget : undefined;
  const reviewedTargetRaw =
    typeof dailyQuotas.reviewedTarget === "number" ? dailyQuotas.reviewedTarget : undefined;
  const verificationBudgetRaw =
    typeof dailyQuotas.verificationBudget === "number" ? dailyQuotas.verificationBudget : undefined;

  // Parse promotion
  const minProofLinksRaw =
    typeof promotion.minProofLinks === "number" ? promotion.minProofLinks : undefined;
  const allowUnverifiedPromotionRaw = promotion.allowUnverifiedPromotion === true;

  // Parse laneTargeting
  const g1PercentageRaw =
    typeof laneTargeting.g1Percentage === "number" ? laneTargeting.g1Percentage : undefined;
  const g2PercentageRaw =
    typeof laneTargeting.g2Percentage === "number" ? laneTargeting.g2Percentage : undefined;

  return {
    enabled: recruiting?.enabled === true,
    store: {
      path: storePath,
    },
    identity: {
      minConfidenceForShortlist: clampNumber(minConfidenceRaw, 0, 1, 0.8),
    },
    run: {
      targetCandidatesPerRole: Math.trunc(clampNumber(targetCandidatesRaw, 1, 2000, 300)),
      defaultCadence: cadenceRaw || "0 6 * * *",
    },
    browserVerification: {
      enabled: browserVerification.enabled === true,
      mode,
    },
    dailyQuotas: {
      promotedTarget: Math.trunc(clampNumber(promotedTargetRaw, 1, 100, 10)),
      reviewedTarget: Math.trunc(clampNumber(reviewedTargetRaw, 1, 200, 30)),
      verificationBudget: Math.trunc(clampNumber(verificationBudgetRaw, 1, 100, 20)),
    },
    promotion: {
      minProofLinks: Math.trunc(clampNumber(minProofLinksRaw, 1, 10, 2)),
      allowUnverifiedPromotion: allowUnverifiedPromotionRaw,
    },
    laneTargeting: {
      g1Percentage: clampNumber(g1PercentageRaw, 0, 1, 0.6),
      g2Percentage: clampNumber(g2PercentageRaw, 0, 1, 0.4),
    },
  };
}
