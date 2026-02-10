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
 */
export type OutboundCallResponse = {
  conversation_id: string;
  status?: string;
};

/**
 * Single transcript entry from a conversation.
 */
export type TranscriptEntry = {
  role: "agent" | "user";
  message: string;
  time_in_call_secs: number;
};

/**
 * Conversation metadata from ElevenLabs.
 */
export type ConversationMetadata = {
  call_duration_secs?: number;
  start_time_unix_secs?: number;
  end_time_unix_secs?: number;
  [key: string]: unknown;
};

/**
 * Analysis/extraction results from the conversation.
 * Configured in ElevenLabs Agent settings.
 */
export type ConversationAnalysis = {
  interested?: boolean;
  availability?: string;
  salary_expectation?: string;
  visa_status?: string;
  preferred_interview_times?: string[];
  concerns?: string[];
  overall_sentiment?: string;
  call_summary?: string;
  [key: string]: unknown;
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
 * Stored conversation with local metadata.
 */
export type StoredConversation = {
  conversation_id: string;
  initiated_at: string;
  to_number: string;
  dynamic_variables?: Record<string, string>;
  status: ConversationStatus;
  transcript?: TranscriptEntry[];
  analysis?: ConversationAnalysis;
  metadata?: ConversationMetadata;
  last_polled?: string;
  error?: string;
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

export type PollUntilDoneResult = {
  success: true;
  conversation: StoredConversation;
  poll_count: number;
  elapsed_seconds: number;
};

export type ToolErrorResult = {
  success: false;
  error: string;
};

export type ToolResult =
  | InitiateCallResult
  | GetConversationResult
  | ListConversationsResult
  | PollUntilDoneResult
  | ToolErrorResult;
