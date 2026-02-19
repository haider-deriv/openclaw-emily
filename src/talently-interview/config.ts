/**
 * Talently Interview Tool - Configuration
 *
 * Config resolution from openclaw.json with env var fallback.
 */

import type { OpenClawConfig } from "../config/config.js";
import type { TalentlyInterviewConfig } from "./types.js";

const DEFAULT_TIMEOUT_MS = 60_000;

export type ResolvedTalentlyInterviewConfig = {
  enabled: boolean;
  apiUrl?: string;
  apiKey?: string;
  timeoutMs: number;
  interviewerEmails: string[];
};

/**
 * Get Talently Interview config from tools.talentlyInterview.
 */
function getTalentlyInterviewConfig(cfg: OpenClawConfig): TalentlyInterviewConfig | undefined {
  const tools = cfg.tools as Record<string, unknown> | undefined;
  return tools?.talentlyInterview as TalentlyInterviewConfig | undefined;
}

/**
 * Resolve full Talently Interview configuration.
 */
export function resolveTalentlyInterviewConfig(
  cfg: OpenClawConfig,
): ResolvedTalentlyInterviewConfig {
  const config = getTalentlyInterviewConfig(cfg);
  const enabled = config?.enabled !== false;

  // Resolve API URL from config or env (falls back to CV analysis URL since it's the same API)
  let apiUrl = config?.apiUrl?.trim();
  if (!apiUrl) {
    apiUrl = process.env.TALENTLY_INTERVIEW_API_URL?.trim();
  }
  if (!apiUrl) {
    apiUrl = process.env.TALENTLY_CV_ANALYSIS_API_URL?.trim();
  }

  // Resolve auth token from config or env
  let apiKey = config?.apiKey?.trim();
  if (!apiKey) {
    apiKey = process.env.TALENTLY_INTERVIEW_API_KEY?.trim();
  }
  if (!apiKey) {
    apiKey = process.env.TALENTLY_CV_ANALYSIS_API_KEY?.trim();
  }

  const timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const interviewerEmails = config?.interviewerEmails ?? [];

  return {
    enabled,
    apiUrl,
    apiKey,
    timeoutMs,
    interviewerEmails,
  };
}

/**
 * Check if Talently Interview is configured and ready to use.
 */
export function isTalentlyInterviewConfigured(config: ResolvedTalentlyInterviewConfig): boolean {
  return Boolean(config.enabled && config.apiUrl);
}

/**
 * Get missing credential fields for error messaging.
 */
export function getMissingCredentials(config: ResolvedTalentlyInterviewConfig): string[] {
  const missing: string[] = [];
  if (!config.apiUrl) {
    missing.push("apiUrl (or TALENTLY_INTERVIEW_API_URL / TALENTLY_CV_ANALYSIS_API_URL env var)");
  }
  return missing;
}
