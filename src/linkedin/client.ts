/**
 * LinkedIn HTTP Client
 *
 * Core HTTP client functions for Unipile LinkedIn API integration.
 */

import type {
  LinkedInApiError,
  LinkedInClientOptions,
  LinkedInSearchParametersResponse,
  LinkedInSearchRequestBody,
  LinkedInSearchResponse,
} from "./types.js";
import { resolveFetch } from "../infra/fetch.js";

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Normalize the Unipile base URL to ensure proper protocol and formatting.
 */
export function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("LinkedIn base URL is required");
  }
  // If already has protocol, just strip trailing slashes
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, "");
  }
  // Default to HTTPS for Unipile endpoints
  return `https://${trimmed}`.replace(/\/+$/, "");
}

/**
 * Fetch with timeout support.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const fetchImpl = resolveFetch();
  if (!fetchImpl) {
    throw new Error("fetch is not available");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse error response from Unipile API.
 */
async function parseErrorResponse(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) {
      return `HTTP ${res.status} ${res.statusText || "error"}`;
    }
    try {
      const parsed = JSON.parse(text) as LinkedInApiError;
      const detail = parsed.detail ? `: ${parsed.detail}` : "";
      return `${parsed.title || "API Error"}${detail} (${parsed.type || res.status})`;
    } catch {
      return text.slice(0, 200);
    }
  } catch {
    return `HTTP ${res.status} ${res.statusText || "error"}`;
  }
}

/**
 * Generic HTTP request to Unipile LinkedIn API.
 */
export async function linkedInRequest<T>(
  method: "GET" | "POST",
  path: string,
  opts: LinkedInClientOptions,
  body?: Record<string, unknown>,
): Promise<T> {
  const baseUrl = normalizeBaseUrl(opts.baseUrl);
  const url = `${baseUrl}${path}`;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const headers: Record<string, string> = {
    "X-API-KEY": opts.apiKey,
    Accept: "application/json",
  };

  const init: RequestInit = {
    method,
    headers,
  };

  if (body && method === "POST") {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const res = await fetchWithTimeout(url, init, timeoutMs);

  if (!res.ok) {
    const errorMsg = await parseErrorResponse(res);
    throw new Error(`LinkedIn API error (${res.status}): ${errorMsg}`);
  }

  const text = await res.text();
  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

/**
 * Search LinkedIn using the Unipile API.
 * POST /api/v1/linkedin/search
 */
export async function searchLinkedIn(
  params: LinkedInSearchRequestBody,
  opts: LinkedInClientOptions,
  queryParams?: { limit?: number; cursor?: string },
): Promise<LinkedInSearchResponse> {
  let path = `/api/v1/linkedin/search?account_id=${encodeURIComponent(opts.accountId)}`;

  if (queryParams?.limit) {
    path += `&limit=${queryParams.limit}`;
  }
  if (queryParams?.cursor) {
    path += `&cursor=${encodeURIComponent(queryParams.cursor)}`;
  }

  return linkedInRequest<LinkedInSearchResponse>("POST", path, opts, params);
}

/**
 * Get search parameters (skills, locations, industries, etc.) from LinkedIn.
 * GET /api/v1/linkedin/search/parameters
 */
export async function getSearchParameters(
  opts: LinkedInClientOptions,
  params: {
    type:
      | "LOCATION"
      | "PEOPLE"
      | "CONNECTIONS"
      | "COMPANY"
      | "SCHOOL"
      | "INDUSTRY"
      | "SERVICE"
      | "JOB_FUNCTION"
      | "JOB_TITLE"
      | "EMPLOYMENT_TYPE"
      | "SKILL";
    keywords?: string;
    service?: "CLASSIC" | "RECRUITER" | "SALES_NAVIGATOR";
    limit?: number;
  },
): Promise<LinkedInSearchParametersResponse> {
  const queryParams = new URLSearchParams();
  queryParams.set("account_id", opts.accountId);
  queryParams.set("type", params.type);

  if (params.keywords) {
    queryParams.set("keywords", params.keywords);
  }
  if (params.service) {
    queryParams.set("service", params.service);
  }
  if (params.limit) {
    queryParams.set("limit", String(params.limit));
  }

  const path = `/api/v1/linkedin/search/parameters?${queryParams.toString()}`;
  return linkedInRequest<LinkedInSearchParametersResponse>("GET", path, opts);
}

/**
 * Check if the LinkedIn API connection is working.
 */
export async function checkLinkedInConnection(
  opts: LinkedInClientOptions,
): Promise<{ ok: boolean; error?: string }> {
  try {
    // Try to get a single parameter to verify connection
    await getSearchParameters(opts, { type: "SKILL", keywords: "test", limit: 1 });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
