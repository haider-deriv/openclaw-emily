/**
 * LinkedIn Configuration Types
 *
 * Configuration types for LinkedIn integration via Unipile API.
 * - Tool config: tools.linkedin.* (talent search)
 * - Channel config: channels.linkedin.* (messaging)
 */

import type { DmPolicy } from "./types.js";

// ============================================================================
// LinkedIn Tool Configuration (tools.linkedin.*)
// ============================================================================

export type LinkedInAccountConfig = {
  /** If false, do not use this LinkedIn account. Default: true. */
  enabled?: boolean;
  /** Unipile DSN base URL (e.g., "api1.unipile.com:13111"). */
  baseUrl?: string;
  /** Unipile API key for authentication. */
  apiKey?: string;
  /** LinkedIn account ID on Unipile platform. */
  accountId?: string;
  /** Request timeout in milliseconds. Default: 30000. */
  timeoutMs?: number;
};

export type LinkedInConfig = {
  /** Optional per-account LinkedIn configuration (multi-account). */
  accounts?: Record<string, LinkedInAccountConfig>;
} & LinkedInAccountConfig;

// ============================================================================
// LinkedIn Channel Configuration (channels.linkedin.*)
// ============================================================================

/**
 * LinkedIn DM configuration.
 */
export type LinkedInDmConfig = {
  /** If false, ignore all incoming LinkedIn DMs. Default: true. */
  enabled?: boolean;
  /** Direct message access policy (default: pairing). */
  policy?: DmPolicy;
  /** Allowlist for DM senders (provider IDs). */
  allowFrom?: Array<string | number>;
};

/**
 * LinkedIn channel account configuration.
 */
export type LinkedInChannelAccountConfig = {
  /** If false, do not start this LinkedIn account. Default: true. */
  enabled?: boolean;
  /** Display name for this account. */
  name?: string;
  /** DM configuration (policy and allowFrom). */
  dm?: LinkedInDmConfig;
  /** Unipile DSN base URL. Falls back to tools.linkedin.baseUrl or UNIPILE_BASE_URL. */
  baseUrl?: string;
  /** Unipile API key. Falls back to tools.linkedin.apiKey or UNIPILE_API_KEY. */
  apiKey?: string;
  /** LinkedIn account ID on Unipile. Falls back to tools.linkedin.accountId or UNIPILE_ACCOUNT_ID. */
  accountId?: string;
  /** Request timeout in milliseconds. Default: 30000. */
  timeoutMs?: number;
  /** Optional webhook secret for verifying incoming webhooks. */
  webhookSecret?: string;
  /** Custom webhook path (default: /linkedin/webhook). */
  webhookPath?: string;
};

/**
 * LinkedIn channel configuration (with multi-account support).
 */
export type LinkedInChannelConfig = LinkedInChannelAccountConfig & {
  /** Per-account LinkedIn configuration (multi-account support). */
  accounts?: Record<string, LinkedInChannelAccountConfig>;
};

/**
 * Resolved LinkedIn channel account (with all values populated).
 */
export type ResolvedLinkedInChannelAccount = {
  /** Account identifier. */
  accountId: string;
  /** Display name. */
  name?: string;
  /** Whether this account is enabled. */
  enabled: boolean;
  /** Unipile base URL. */
  baseUrl: string;
  /** Unipile API key. */
  apiKey: string;
  /** LinkedIn account ID on Unipile. */
  unipileAccountId: string;
  /** Request timeout in milliseconds. */
  timeoutMs: number;
  /** DM policy. */
  dmPolicy: "open" | "pairing" | "allowlist";
  /** Allowed sender IDs. */
  allowFrom: string[];
  /** Webhook secret. */
  webhookSecret?: string;
  /** Webhook path. */
  webhookPath?: string;
};
