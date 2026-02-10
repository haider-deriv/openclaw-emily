/**
 * ElevenLabs Conversational AI - HTTP Client
 *
 * HTTP client for ElevenLabs Agents API (Conversational AI).
 */

import type { ResolvedElevenLabsAgentsConfig } from "./config.js";
import type {
  ConversationDetails,
  ConversationListItem,
  ListConversationsResponse,
  OutboundCallRequest,
  OutboundCallResponse,
} from "./types.js";
import { resolveFetch } from "../infra/fetch.js";

// =============================================================================
// Error Classification
// =============================================================================

export type ElevenLabsErrorType =
  | "network" // Transient network error
  | "timeout" // Request timed out
  | "auth" // Authentication/authorization error
  | "rate_limit" // Rate limited
  | "not_found" // Resource not found
  | "validation" // Invalid request
  | "api" // API error
  | "unknown"; // Unknown error

export interface ClassifiedError {
  type: ElevenLabsErrorType;
  message: string;
  userFriendlyMessage: string;
  isTransient: boolean;
  originalError: unknown;
}

/**
 * Classify an error for better handling and user-friendly messages.
 */
export function classifyElevenLabsError(err: unknown): ClassifiedError {
  const errorString = err instanceof Error ? err.message : String(err);
  const lowerError = errorString.toLowerCase();

  // Network errors (transient)
  if (
    lowerError.includes("fetch failed") ||
    lowerError.includes("enotfound") ||
    lowerError.includes("econnrefused") ||
    lowerError.includes("econnreset") ||
    lowerError.includes("network") ||
    lowerError.includes("dns") ||
    lowerError.includes("socket")
  ) {
    return {
      type: "network",
      message: errorString,
      userFriendlyMessage:
        "ElevenLabs API is temporarily unreachable. Please try again in a moment.",
      isTransient: true,
      originalError: err,
    };
  }

  // Timeout errors (transient)
  if (
    lowerError.includes("timeout") ||
    lowerError.includes("aborted") ||
    lowerError.includes("timed out")
  ) {
    return {
      type: "timeout",
      message: errorString,
      userFriendlyMessage: "The ElevenLabs request took too long. Please try again.",
      isTransient: true,
      originalError: err,
    };
  }

  // Rate limiting
  if (
    lowerError.includes("rate") ||
    lowerError.includes("429") ||
    lowerError.includes("too many")
  ) {
    return {
      type: "rate_limit",
      message: errorString,
      userFriendlyMessage: "ElevenLabs rate limit reached. Please wait before trying again.",
      isTransient: true,
      originalError: err,
    };
  }

  // Auth errors
  if (
    lowerError.includes("401") ||
    lowerError.includes("403") ||
    lowerError.includes("unauthorized") ||
    lowerError.includes("forbidden") ||
    lowerError.includes("invalid api key")
  ) {
    return {
      type: "auth",
      message: errorString,
      userFriendlyMessage: "ElevenLabs authentication failed. Check your API key configuration.",
      isTransient: false,
      originalError: err,
    };
  }

  // Validation errors
  if (
    lowerError.includes("400") ||
    lowerError.includes("422") ||
    lowerError.includes("validation") ||
    lowerError.includes("invalid")
  ) {
    return {
      type: "validation",
      message: errorString,
      userFriendlyMessage: `Invalid request: ${errorString}`,
      isTransient: false,
      originalError: err,
    };
  }

  // Not found
  if (lowerError.includes("404") || lowerError.includes("not found")) {
    return {
      type: "not_found",
      message: errorString,
      userFriendlyMessage: "The requested resource was not found.",
      isTransient: false,
      originalError: err,
    };
  }

  // Unknown
  return {
    type: "unknown",
    message: errorString,
    userFriendlyMessage: `ElevenLabs API error: ${errorString}`,
    isTransient: false,
    originalError: err,
  };
}

// =============================================================================
// HTTP Client
// =============================================================================

export type ElevenLabsClientOptions = {
  apiKey: string;
  baseUrl: string;
  timeoutSeconds: number;
};

/**
 * Build client options from resolved config.
 * Returns undefined if required credentials are missing.
 */
export function buildClientOptions(
  config: ResolvedElevenLabsAgentsConfig,
): ElevenLabsClientOptions | undefined {
  if (!config.apiKey) {
    return undefined;
  }
  return {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    timeoutSeconds: config.timeoutSeconds,
  };
}

async function makeRequest<T>(
  opts: ElevenLabsClientOptions,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const fetchImpl = resolveFetch();
  if (!fetchImpl) {
    throw new Error("fetch is not available");
  }
  const url = `${opts.baseUrl}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), opts.timeoutSeconds * 1000);

  try {
    const response = await fetchImpl(url, {
      method,
      headers: {
        "xi-api-key": opts.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const responseText = await response.text();

    if (!response.ok) {
      let errorMessage = `ElevenLabs API error (${response.status})`;
      try {
        const errorJson = JSON.parse(responseText) as { detail?: string; message?: string };
        const detail = errorJson.detail ?? errorJson.message;
        if (detail) {
          errorMessage = `${errorMessage}: ${detail}`;
        }
      } catch {
        if (responseText) {
          errorMessage = `${errorMessage}: ${responseText.slice(0, 200)}`;
        }
      }
      throw new Error(errorMessage);
    }

    if (!responseText) {
      return {} as T;
    }

    return JSON.parse(responseText) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

// =============================================================================
// API Functions
// =============================================================================

/**
 * Initiate an outbound call via ElevenLabs Conversational AI.
 *
 * POST /v1/convai/twilio/outbound-call
 */
export async function initiateOutboundCall(
  opts: ElevenLabsClientOptions,
  params: {
    agentId: string;
    phoneNumberId: string;
    toNumber: string;
    dynamicVariables?: Record<string, string>;
  },
): Promise<OutboundCallResponse> {
  const body: OutboundCallRequest = {
    agent_id: params.agentId,
    agent_phone_number_id: params.phoneNumberId,
    to_number: params.toNumber,
  };

  if (params.dynamicVariables && Object.keys(params.dynamicVariables).length > 0) {
    body.conversation_initiation_client_data = {
      dynamic_variables: params.dynamicVariables,
    };
  }

  return makeRequest<OutboundCallResponse>(opts, "POST", "/v1/convai/twilio/outbound-call", body);
}

/**
 * Get conversation details by ID.
 *
 * GET /v1/convai/conversations/{conversation_id}
 */
export async function getConversation(
  opts: ElevenLabsClientOptions,
  conversationId: string,
): Promise<ConversationDetails> {
  return makeRequest<ConversationDetails>(
    opts,
    "GET",
    `/v1/convai/conversations/${encodeURIComponent(conversationId)}`,
  );
}

/**
 * List conversations.
 *
 * GET /v1/convai/conversations
 */
export async function listConversations(
  opts: ElevenLabsClientOptions,
  params?: {
    agentId?: string;
    limit?: number;
    cursor?: string;
  },
): Promise<ListConversationsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.agentId) {
    searchParams.set("agent_id", params.agentId);
  }
  if (params?.limit) {
    searchParams.set("page_size", String(params.limit));
  }
  if (params?.cursor) {
    searchParams.set("cursor", params.cursor);
  }

  const query = searchParams.toString();
  const path = `/v1/convai/conversations${query ? `?${query}` : ""}`;

  return makeRequest<ListConversationsResponse>(opts, "GET", path);
}

/**
 * Poll for conversation completion with exponential backoff.
 */
export async function pollUntilDone(
  opts: ElevenLabsClientOptions,
  conversationId: string,
  params: {
    timeoutSeconds: number;
    pollIntervalSeconds: number;
    onPoll?: (details: ConversationDetails, pollCount: number) => void;
  },
): Promise<{ details: ConversationDetails; pollCount: number; elapsedSeconds: number }> {
  const startTime = Date.now();
  const timeoutMs = params.timeoutSeconds * 1000;
  let pollCount = 0;
  let intervalMs = params.pollIntervalSeconds * 1000;
  const maxIntervalMs = 30_000; // Max 30s between polls

  while (Date.now() - startTime < timeoutMs) {
    pollCount++;
    const details = await getConversation(opts, conversationId);

    if (params.onPoll) {
      params.onPoll(details, pollCount);
    }

    if (details.status === "done" || details.status === "failed" || details.status === "timeout") {
      return {
        details,
        pollCount,
        elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
      };
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, intervalMs));

    // Exponential backoff (increase interval by 20% each poll, max 30s)
    intervalMs = Math.min(intervalMs * 1.2, maxIntervalMs);
  }

  // Timeout - return last known state
  const finalDetails = await getConversation(opts, conversationId);
  return {
    details: finalDetails,
    pollCount,
    elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
  };
}
