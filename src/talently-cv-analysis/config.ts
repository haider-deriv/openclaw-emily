/**
 * Talently CV Analysis Tool - Configuration
 *
 * Config resolution from openclaw.json with env var fallback.
 */

import type { OpenClawConfig } from "../config/config.js";
import type { TalentlyCVAnalysisConfig } from "./types.js";

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes for file uploads

export type ResolvedTalentlyCVAnalysisConfig = {
  enabled: boolean;
  apiUrl?: string;
  authToken?: string;
  timeoutMs: number;
};

/**
 * Get Talently CV Analysis config from tools.talentlyCvAnalysis.
 */
function getTalentlyCVAnalysisConfig(cfg: OpenClawConfig): TalentlyCVAnalysisConfig | undefined {
  const tools = cfg.tools as Record<string, unknown> | undefined;
  return tools?.talentlyCvAnalysis as TalentlyCVAnalysisConfig | undefined;
}

/**
 * Resolve full Talently CV Analysis configuration.
 */
export function resolveTalentlyCVAnalysisConfig(
  cfg: OpenClawConfig,
): ResolvedTalentlyCVAnalysisConfig {
  const config = getTalentlyCVAnalysisConfig(cfg);
  const enabled = config?.enabled !== false;

  // Resolve API URL from config or env
  let apiUrl = config?.apiUrl?.trim();
  if (!apiUrl) {
    apiUrl = process.env.TALENTLY_CV_ANALYSIS_API_URL?.trim();
  }

  // Resolve auth token from config or env
  let authToken = config?.authToken?.trim();
  if (!authToken) {
    authToken = process.env.TALENTLY_CV_ANALYSIS_AUTH_TOKEN?.trim();
  }

  // Resolve timeout
  const timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    enabled,
    apiUrl,
    authToken,
    timeoutMs,
  };
}

/**
 * Check if Talently CV Analysis is configured and ready to use.
 */
export function isTalentlyCVAnalysisConfigured(config: ResolvedTalentlyCVAnalysisConfig): boolean {
  return Boolean(config.enabled && config.apiUrl);
}

/**
 * Get missing credential fields for error messaging.
 */
export function getMissingCredentials(config: ResolvedTalentlyCVAnalysisConfig): string[] {
  const missing: string[] = [];
  if (!config.apiUrl) {
    missing.push("apiUrl (or TALENTLY_CV_ANALYSIS_API_URL env var)");
  }
  if (!config.authToken) {
    missing.push("authToken (or TALENTLY_CV_ANALYSIS_AUTH_TOKEN env var)");
  }
  return missing;
}
