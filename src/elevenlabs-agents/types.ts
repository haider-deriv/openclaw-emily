/**
 * ElevenLabs Conversational AI - Types
 *
 * TypeScript interfaces for the ElevenLabs Agents API.
 */

// =============================================================================
// Configuration Types
// =============================================================================

export type ElevenLabsAgentsConfig = {
  enabled: boolean;
  apiKey?: string;
  agentId?: string;
  phoneNumberId?: string;
  defaultDynamicVariables?: Record<string, string>;
  baseUrl?: string;
  timeoutSeconds?: number;
  /** Webhook secret from ElevenLabs dashboard for HMAC verification */
  webhookSecret?: string;
  /** Webhook endpoint path (default: /elevenlabs/webhook) */
  webhookPath?: string;
};

// =============================================================================
// API Request/Response Types
// =============================================================================

/**
 * Request body for initiating an outbound call.
 * POST /v1/convai/twilio/outbound-call
 */
export type OutboundCallRequest = {
  agent_id: string;
  agent_phone_number_id: string;
  to_number: string;
  conversation_initiation_client_data?: {
    dynamic_variables?: Record<string, string>;
  };
};

/**
 * Response from initiating an outbound call.
 * Note: ElevenLabs returns HTTP 200 even on failures, with success=false.
 */
export type OutboundCallResponse = {
  conversation_id: string | null;
  status?: string;
  success?: boolean;
  message?: string;
  callSid?: string | null;
};

/**
 * Single transcript entry from a conversation (simplified).
 */
export type TranscriptEntry = {
  role: "agent" | "user";
  message: string;
  time_in_call_secs?: number; // Optional, from API but not stored
};

/**
 * Simplified transcript entry for storage.
 */
export type StoredTranscriptEntry = {
  role: "agent" | "user";
  message: string;
};

/**
 * Phone call metadata.
 */
export type PhoneCallMetadata = {
  direction?: string;
  phone_number_id?: string;
  agent_number?: string;
  external_number?: string;
  type?: string;
  stream_sid?: string;
  call_sid?: string;
};

/**
 * Conversation metadata from ElevenLabs (simplified for storage).
 */
export type ConversationMetadata = {
  call_duration_secs?: number;
  phone_call?: PhoneCallMetadata;
  conversation_initiation_source?: string;
  timezone?: string;
  whatsapp?: unknown;
  // API fields not stored
  start_time_unix_secs?: number;
  end_time_unix_secs?: number;
  [key: string]: unknown;
};

/**
 * Simplified metadata for storage.
 */
export type StoredMetadata = {
  call_duration_secs?: number;
  phone_call?: PhoneCallMetadata;
  conversation_initiation_source?: string;
  timezone?: string;
  whatsapp?: unknown;
};

/**
 * Data collection result from analysis.
 */
export type DataCollectionResult = {
  data_collection_id: string;
  value: unknown;
  json_schema?: {
    type?: string;
    description?: string;
    enum?: unknown;
    is_system_provided?: boolean;
    dynamic_variable?: string;
    constant_value?: string;
  };
  rationale?: string;
};

/**
 * Analysis/extraction results from the conversation (simplified for storage).
 */
export type ConversationAnalysis = {
  evaluation_criteria_results_list?: unknown[];
  data_collection_results_list?: DataCollectionResult[];
  call_successful?: string;
  transcript_summary?: string;
  call_summary_title?: string;
  [key: string]: unknown;
};

/**
 * Simplified analysis for storage.
 */
export type StoredAnalysis = {
  evaluation_criteria_results_list?: unknown[];
  data_collection_results_list?: DataCollectionResult[];
  call_successful?: string;
  transcript_summary?: string;
  call_summary_title?: string;
};

/**
 * Full conversation details from ElevenLabs.
 * GET /v1/convai/conversations/{id}
 */
export type ConversationDetails = {
  agent_id: string;
  conversation_id: string;
  status: ConversationStatus;
  transcript?: TranscriptEntry[];
  metadata?: ConversationMetadata;
  analysis?: ConversationAnalysis;
};

/**
 * Conversation status values.
 */
export type ConversationStatus = "pending" | "in-progress" | "done" | "failed" | "timeout" | string;

/**
 * List conversations response.
 * GET /v1/convai/conversations
 */
export type ListConversationsResponse = {
  conversations: ConversationListItem[];
  has_more?: boolean;
  next_cursor?: string;
};

/**
 * Summary item in conversation list.
 */
export type ConversationListItem = {
  conversation_id: string;
  agent_id: string;
  status: ConversationStatus;
  start_time_unix_secs?: number;
  end_time_unix_secs?: number;
  call_duration_secs?: number;
};

// =============================================================================
// Storage Types
// =============================================================================

/**
 * Stored conversation with local metadata (simplified structure).
 */
export type StoredConversation = {
  initiated_at: string;
  to_number: string;
  dynamic_variables?: Record<string, string>;
  status: ConversationStatus;
  transcript?: StoredTranscriptEntry[];
  analysis?: StoredAnalysis;
  metadata?: StoredMetadata;
};

/**
 * Conversation store file format.
 */
export type ConversationStore = {
  conversations: Record<string, StoredConversation>;
};

// =============================================================================
// Tool Result Types
// =============================================================================

export type InitiateCallResult = {
  success: true;
  conversation_id: string;
  status: string;
  to_number: string;
};

export type GetConversationResult = {
  success: true;
  conversation: StoredConversation;
};

export type ListConversationsResult = {
  success: true;
  conversations: StoredConversation[];
  count: number;
};

export type ToolErrorResult = {
  success: false;
  error: string;
};

export type ToolResult =
  | InitiateCallResult
  | GetConversationResult
  | ListConversationsResult
  | ToolErrorResult;
