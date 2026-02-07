/**
 * LinkedIn Configuration Types
 *
 * Configuration types for LinkedIn integration via Unipile API.
 */

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
