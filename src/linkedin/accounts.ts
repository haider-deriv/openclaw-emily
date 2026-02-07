/**
 * LinkedIn Account Management
 *
 * Account/credential resolution from configuration.
 */

import type { OpenClawConfig } from "../config/config.js";
import type { LinkedInAccountConfig, LinkedInClientOptions } from "./types.js";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../routing/session-key.js";

export type LinkedInTokenSource = "env" | "config" | "none";

export type ResolvedLinkedInAccount = {
  accountId: string;
  enabled: boolean;
  baseUrl?: string;
  apiKey?: string;
  unipileAccountId?: string;
  timeoutMs?: number;
  apiKeySource: LinkedInTokenSource;
  config: LinkedInAccountConfig;
};

/**
 * Get LinkedIn config from either tools.linkedin (preferred) or channels.linkedin (fallback).
 */
function getLinkedInConfig(cfg: OpenClawConfig): LinkedInAccountConfig | undefined {
  // Check tools.linkedin first (preferred location for tool config)
  const toolsLinkedin = (cfg.tools as Record<string, unknown> | undefined)?.linkedin as
    | LinkedInAccountConfig
    | undefined;
  if (toolsLinkedin) {
    return toolsLinkedin;
  }
  // Fall back to channels.linkedin for backwards compatibility
  return (cfg.channels as Record<string, unknown> | undefined)?.linkedin as
    | LinkedInAccountConfig
    | undefined;
}

/**
 * Get LinkedIn config with accounts from either tools.linkedin or channels.linkedin.
 */
function getLinkedInConfigWithAccounts(
  cfg: OpenClawConfig,
): (LinkedInAccountConfig & { accounts?: Record<string, LinkedInAccountConfig> }) | undefined {
  // Check tools.linkedin first
  const toolsLinkedin = (cfg.tools as Record<string, unknown> | undefined)?.linkedin as
    | (LinkedInAccountConfig & { accounts?: Record<string, LinkedInAccountConfig> })
    | undefined;
  if (toolsLinkedin) {
    return toolsLinkedin;
  }
  // Fall back to channels.linkedin
  return (cfg.channels as Record<string, unknown> | undefined)?.linkedin as
    | (LinkedInAccountConfig & { accounts?: Record<string, LinkedInAccountConfig> })
    | undefined;
}

function listConfiguredAccountIds(cfg: OpenClawConfig): string[] {
  const linkedin = getLinkedInConfigWithAccounts(cfg);
  if (!linkedin?.accounts || typeof linkedin.accounts !== "object") {
    return [];
  }
  return Object.keys(linkedin.accounts).filter(Boolean);
}

export function listLinkedInAccountIds(cfg: OpenClawConfig): string[] {
  const ids = listConfiguredAccountIds(cfg);
  if (ids.length === 0) {
    return [DEFAULT_ACCOUNT_ID];
  }
  return ids.toSorted((a, b) => a.localeCompare(b));
}

export function resolveDefaultLinkedInAccountId(cfg: OpenClawConfig): string {
  const ids = listLinkedInAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

function resolveAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
): LinkedInAccountConfig | undefined {
  const linkedin = getLinkedInConfigWithAccounts(cfg);
  if (!linkedin?.accounts || typeof linkedin.accounts !== "object") {
    return undefined;
  }
  return linkedin.accounts[accountId];
}

function mergeLinkedInAccountConfig(cfg: OpenClawConfig, accountId: string): LinkedInAccountConfig {
  const linkedin = getLinkedInConfigWithAccounts(cfg);
  const { accounts: _ignored, ...base } = linkedin ?? {};
  const account = resolveAccountConfig(cfg, accountId) ?? {};
  return { ...base, ...account };
}

function resolveApiKey(
  merged: LinkedInAccountConfig,
  allowEnv: boolean,
): { apiKey?: string; source: LinkedInTokenSource } {
  const configKey = merged.apiKey?.trim();
  if (configKey) {
    return { apiKey: configKey, source: "config" };
  }

  if (allowEnv) {
    const envKey = process.env.UNIPILE_API_KEY?.trim() || process.env.LINKEDIN_API_KEY?.trim();
    if (envKey) {
      return { apiKey: envKey, source: "env" };
    }
  }

  return { apiKey: undefined, source: "none" };
}

export function resolveLinkedInAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedLinkedInAccount {
  const accountId = normalizeAccountId(params.accountId);
  const linkedin = getLinkedInConfig(params.cfg);
  const baseEnabled = linkedin?.enabled !== false;
  const merged = mergeLinkedInAccountConfig(params.cfg, accountId);
  const accountEnabled = merged.enabled !== false;
  const enabled = baseEnabled && accountEnabled;
  const allowEnv = accountId === DEFAULT_ACCOUNT_ID;
  const { apiKey, source: apiKeySource } = resolveApiKey(merged, allowEnv);

  // Resolve baseUrl from config or env
  let baseUrl = merged.baseUrl?.trim();
  if (!baseUrl && allowEnv) {
    baseUrl = process.env.UNIPILE_BASE_URL?.trim() || process.env.LINKEDIN_BASE_URL?.trim();
  }

  // Resolve Unipile account ID from config or env
  let unipileAccountId = merged.accountId?.trim();
  if (!unipileAccountId && allowEnv) {
    unipileAccountId =
      process.env.UNIPILE_ACCOUNT_ID?.trim() || process.env.LINKEDIN_ACCOUNT_ID?.trim();
  }

  return {
    accountId,
    enabled,
    baseUrl,
    apiKey,
    unipileAccountId,
    timeoutMs: merged.timeoutMs,
    apiKeySource,
    config: merged,
  };
}

export function listEnabledLinkedInAccounts(cfg: OpenClawConfig): ResolvedLinkedInAccount[] {
  return listLinkedInAccountIds(cfg)
    .map((accountId) => resolveLinkedInAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}

/**
 * Build LinkedInClientOptions from a resolved account.
 * Returns undefined if required credentials are missing.
 */
export function buildClientOptions(
  account: ResolvedLinkedInAccount,
): LinkedInClientOptions | undefined {
  if (!account.baseUrl || !account.apiKey || !account.unipileAccountId) {
    return undefined;
  }

  return {
    baseUrl: account.baseUrl,
    apiKey: account.apiKey,
    accountId: account.unipileAccountId,
    timeoutMs: account.timeoutMs,
  };
}

/**
 * Get missing credential fields for error messaging.
 */
export function getMissingCredentials(account: ResolvedLinkedInAccount): string[] {
  const missing: string[] = [];
  if (!account.baseUrl) {
    missing.push("baseUrl");
  }
  if (!account.apiKey) {
    missing.push("apiKey");
  }
  if (!account.unipileAccountId) {
    missing.push("accountId");
  }
  return missing;
}
