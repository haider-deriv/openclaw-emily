/**
 * ElevenLabs Agents - Configuration
 *
 * Config resolution from openclaw.json with env var fallback.
 */

import type { OpenClawConfig } from "../config/config.js";
import type { ElevenLabsAgentsConfig } from "./types.js";

const DEFAULT_BASE_URL = "https://api.elevenlabs.io";
const DEFAULT_TIMEOUT_SECONDS = 60;

export type ResolvedElevenLabsAgentsConfig = {
  enabled: boolean;
  apiKey?: string;
  agentId?: string;
  phoneNumberId?: string;
  defaultDynamicVariables: Record<string, string>;
  baseUrl: string;
  timeoutSeconds: number;
  apiKeySource: "config" | "env" | "none";
};

/**
 * Get ElevenLabs Agents config from tools.elevenlabsAgents.
 */
function getElevenLabsAgentsConfig(cfg: OpenClawConfig): ElevenLabsAgentsConfig | undefined {
  const tools = cfg.tools as Record<string, unknown> | undefined;
  return tools?.elevenlabsAgents as ElevenLabsAgentsConfig | undefined;
}

/**
 * Resolve API key from config or environment variable.
 */
function resolveApiKey(configApiKey?: string): {
  apiKey?: string;
  source: "config" | "env" | "none";
} {
  const configKey = configApiKey?.trim();
  if (configKey) {
    return { apiKey: configKey, source: "config" };
  }

  const envKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (envKey) {
    return { apiKey: envKey, source: "env" };
  }

  return { apiKey: undefined, source: "none" };
}

/**
 * Resolve full ElevenLabs Agents configuration.
 */
export function resolveElevenLabsAgentsConfig(cfg: OpenClawConfig): ResolvedElevenLabsAgentsConfig {
  const config = getElevenLabsAgentsConfig(cfg);
  const enabled = config?.enabled !== false;
  const { apiKey, source: apiKeySource } = resolveApiKey(config?.apiKey);

  // Resolve agent ID from config or env
  let agentId = config?.agentId?.trim();
  if (!agentId) {
    agentId = process.env.ELEVENLABS_AGENT_ID?.trim();
  }

  // Resolve phone number ID from config or env
  let phoneNumberId = config?.phoneNumberId?.trim();
  if (!phoneNumberId) {
    phoneNumberId = process.env.ELEVENLABS_PHONE_NUMBER_ID?.trim();
  }

  // Resolve base URL
  let baseUrl = config?.baseUrl?.trim();
  if (!baseUrl) {
    baseUrl = process.env.ELEVENLABS_BASE_URL?.trim() || DEFAULT_BASE_URL;
  }

  // Resolve timeout
  const timeoutSeconds = config?.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;

  // Resolve default dynamic variables
  const defaultDynamicVariables = config?.defaultDynamicVariables ?? {};

  return {
    enabled,
    apiKey,
    agentId,
    phoneNumberId,
    defaultDynamicVariables,
    baseUrl,
    timeoutSeconds,
    apiKeySource,
  };
}

/**
 * Check if ElevenLabs Agents is configured and ready to use.
 */
export function isElevenLabsAgentsConfigured(config: ResolvedElevenLabsAgentsConfig): boolean {
  return Boolean(config.enabled && config.apiKey && config.agentId && config.phoneNumberId);
}

/**
 * Get missing credential fields for error messaging.
 */
export function getMissingCredentials(config: ResolvedElevenLabsAgentsConfig): string[] {
  const missing: string[] = [];
  if (!config.apiKey) {
    missing.push("apiKey (or ELEVENLABS_API_KEY env var)");
  }
  if (!config.agentId) {
    missing.push("agentId (or ELEVENLABS_AGENT_ID env var)");
  }
  if (!config.phoneNumberId) {
    missing.push("phoneNumberId (or ELEVENLABS_PHONE_NUMBER_ID env var)");
  }
  return missing;
}
