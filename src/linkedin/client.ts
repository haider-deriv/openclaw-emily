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
  // Messaging types
  LinkedInChatListResponse,
  LinkedInMessageListResponse,
  LinkedInChatAttendeesResponse,
  LinkedInStartChatRequest,
  LinkedInStartChatResponse,
  LinkedInSendMessageRequest,
  LinkedInSendMessageResponse,
  LinkedInCreateWebhookRequest,
  LinkedInCreateWebhookResponse,
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

// ============================================================================
// LinkedIn Messaging Functions (Unipile Messaging API)
// ============================================================================

/**
 * List chats (conversations) for a LinkedIn account.
 * GET /api/v1/chats
 */
export async function listChats(
  opts: LinkedInClientOptions,
  params?: {
    limit?: number;
    cursor?: string;
    unread?: boolean;
    account_type?: "LINKEDIN";
    before?: string;
    after?: string;
  },
): Promise<LinkedInChatListResponse> {
  const queryParams = new URLSearchParams();
  queryParams.set("account_id", opts.accountId);
  queryParams.set("account_type", "LINKEDIN");

  if (params?.limit) {
    queryParams.set("limit", String(params.limit));
  }
  if (params?.cursor) {
    queryParams.set("cursor", params.cursor);
  }
  if (params?.unread !== undefined) {
    queryParams.set("unread", String(params.unread));
  }
  if (params?.before) {
    queryParams.set("before", params.before);
  }
  if (params?.after) {
    queryParams.set("after", params.after);
  }

  const path = `/api/v1/chats?${queryParams.toString()}`;
  return linkedInRequest<LinkedInChatListResponse>("GET", path, opts);
}

/**
 * Get messages from a specific chat.
 * GET /api/v1/chats/{chat_id}/messages
 */
export async function getMessages(
  opts: LinkedInClientOptions,
  chatId: string,
  params?: {
    limit?: number;
    cursor?: string;
    before?: string;
    after?: string;
  },
): Promise<LinkedInMessageListResponse> {
  const queryParams = new URLSearchParams();

  if (params?.limit) {
    queryParams.set("limit", String(params.limit));
  }
  if (params?.cursor) {
    queryParams.set("cursor", params.cursor);
  }
  if (params?.before) {
    queryParams.set("before", params.before);
  }
  if (params?.after) {
    queryParams.set("after", params.after);
  }

  const qs = queryParams.toString();
  const path = `/api/v1/chats/${encodeURIComponent(chatId)}/messages${qs ? `?${qs}` : ""}`;
  return linkedInRequest<LinkedInMessageListResponse>("GET", path, opts);
}

/**
 * Get chat attendees (participants in a conversation).
 * GET /api/v1/chats/{chat_id}/attendees
 */
export async function getChatAttendees(
  opts: LinkedInClientOptions,
  chatId: string,
  params?: {
    limit?: number;
    cursor?: string;
  },
): Promise<LinkedInChatAttendeesResponse> {
  const queryParams = new URLSearchParams();

  if (params?.limit) {
    queryParams.set("limit", String(params.limit));
  }
  if (params?.cursor) {
    queryParams.set("cursor", params.cursor);
  }

  const qs = queryParams.toString();
  const path = `/api/v1/chats/${encodeURIComponent(chatId)}/attendees${qs ? `?${qs}` : ""}`;
  return linkedInRequest<LinkedInChatAttendeesResponse>("GET", path, opts);
}

/**
 * Send a message in an existing chat.
 * POST /api/v1/chats/{chat_id}/messages
 */
export async function sendMessage(
  opts: LinkedInClientOptions,
  chatId: string,
  request: LinkedInSendMessageRequest,
): Promise<LinkedInSendMessageResponse> {
  const path = `/api/v1/chats/${encodeURIComponent(chatId)}/messages`;
  return linkedInRequest<LinkedInSendMessageResponse>("POST", path, opts, {
    ...request,
    account_id: request.account_id ?? opts.accountId,
  });
}

/**
 * Start a new chat (conversation) with LinkedIn users.
 * POST /api/v1/chats
 */
export async function startChat(
  opts: LinkedInClientOptions,
  request: Omit<LinkedInStartChatRequest, "account_id">,
): Promise<LinkedInStartChatResponse> {
  const path = `/api/v1/chats`;
  return linkedInRequest<LinkedInStartChatResponse>("POST", path, opts, {
    ...request,
    account_id: opts.accountId,
  });
}

/**
 * Create a webhook for messaging events.
 * POST /api/v1/webhooks
 */
export async function createWebhook(
  opts: LinkedInClientOptions,
  request: Omit<LinkedInCreateWebhookRequest, "source" | "account_ids" | "enabled" | "events">,
): Promise<LinkedInCreateWebhookResponse> {
  const path = `/api/v1/webhooks`;
  return linkedInRequest<LinkedInCreateWebhookResponse>("POST", path, opts, {
    ...request,
    source: "messaging",
    account_ids: [opts.accountId],
    enabled: true,
    events: ["message_received"],
  });
}

/**
 * Delete a webhook.
 * DELETE /api/v1/webhooks/{webhook_id}
 */
export async function deleteWebhook(opts: LinkedInClientOptions, webhookId: string): Promise<void> {
  const baseUrl = normalizeBaseUrl(opts.baseUrl);
  const url = `${baseUrl}/api/v1/webhooks/${encodeURIComponent(webhookId)}`;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const res = await fetchWithTimeout(
    url,
    {
      method: "DELETE",
      headers: {
        "X-API-KEY": opts.apiKey,
        Accept: "application/json",
      },
    },
    timeoutMs,
  );

  if (!res.ok) {
    const errorMsg = await parseErrorResponse(res);
    throw new Error(`LinkedIn API error (${res.status}): ${errorMsg}`);
  }
}

/**
 * List all webhooks for the account.
 * GET /api/v1/webhooks
 */
export async function listWebhooks(opts: LinkedInClientOptions): Promise<{
  object: "WebhookList";
  items: Array<{ id: string; name?: string; request_url: string; enabled: boolean }>;
}> {
  const path = `/api/v1/webhooks`;
  return linkedInRequest<{
    object: "WebhookList";
    items: Array<{ id: string; name?: string; request_url: string; enabled: boolean }>;
  }>("GET", path, opts);
}

/**
 * Send a message with attachment(s) using multipart/form-data.
 * POST /api/v1/chats/{chat_id}/messages
 */
export async function sendMessageWithAttachment(
  opts: LinkedInClientOptions,
  chatId: string,
  request: {
    text?: string;
    attachments?: Array<{ filename: string; content: ArrayBuffer; contentType: string }>;
  },
): Promise<LinkedInSendMessageResponse> {
  const baseUrl = normalizeBaseUrl(opts.baseUrl);
  const url = `${baseUrl}/api/v1/chats/${encodeURIComponent(chatId)}/messages`;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = resolveFetch();

  if (!fetchImpl) {
    throw new Error("fetch is not available");
  }

  // Build FormData
  const formData = new FormData();

  if (request.text) {
    formData.append("text", request.text);
  }

  formData.append("account_id", opts.accountId);

  if (request.attachments) {
    for (const attachment of request.attachments) {
      const blob = new Blob([new Uint8Array(attachment.content)], { type: attachment.contentType });
      formData.append("attachments", blob, attachment.filename);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "X-API-KEY": opts.apiKey,
        Accept: "application/json",
      },
      body: formData,
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorMsg = await parseErrorResponse(res);
      throw new Error(`LinkedIn API error (${res.status}): ${errorMsg}`);
    }

    const text = await res.text();
    if (!text) {
      return {} as LinkedInSendMessageResponse;
    }

    return JSON.parse(text) as LinkedInSendMessageResponse;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Download an attachment from a message.
 * GET /api/v1/messages/{message_id}/attachments/{attachment_id}
 */
export async function downloadAttachment(
  opts: LinkedInClientOptions,
  messageId: string,
  attachmentId: string,
): Promise<{ content: ArrayBuffer; contentType: string }> {
  const baseUrl = normalizeBaseUrl(opts.baseUrl);
  const url = `${baseUrl}/api/v1/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = resolveFetch();

  if (!fetchImpl) {
    throw new Error("fetch is not available");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: {
        "X-API-KEY": opts.apiKey,
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorMsg = await parseErrorResponse(res);
      throw new Error(`LinkedIn API error (${res.status}): ${errorMsg}`);
    }

    const contentType = res.headers.get("content-type") || "application/octet-stream";
    const content = await res.arrayBuffer();

    return { content, contentType };
  } finally {
    clearTimeout(timer);
  }
}
