/**
 * LinkedIn Talent Search Module Types
 *
 * Types for the Unipile-based LinkedIn search integration.
 */

// Forward declare messaging config (defined below)
export type LinkedInMessagingConfig = {
  /** Enable LinkedIn messaging channel. Default: false. */
  enabled?: boolean;
  /** DM policy: "open", "pairing", or "allowlist". Default: "pairing". */
  dmPolicy?: "open" | "pairing" | "allowlist";
  /** List of allowed sender IDs (LinkedIn provider IDs). */
  allowFrom?: string[];
  /** Optional webhook secret for verifying incoming webhooks. */
  webhookSecret?: string;
};

// LinkedIn account configuration for openclaw.yml
export type LinkedInAccountConfig = {
  /** If false, do not start this LinkedIn account. Default: true. */
  enabled?: boolean;
  /** Unipile DSN base URL (e.g., "api1.unipile.com:13111"). */
  baseUrl?: string;
  /** Unipile API key for authentication. */
  apiKey?: string;
  /** LinkedIn account ID on Unipile platform. */
  accountId?: string;
  /** Request timeout in milliseconds. Default: 30000. */
  timeoutMs?: number;
  /** Messaging channel configuration (nested). */
  messaging?: LinkedInMessagingConfig;
};

export type LinkedInConfig = {
  /** Optional per-account LinkedIn configuration (multi-account). */
  accounts?: Record<string, LinkedInAccountConfig>;
} & LinkedInAccountConfig;

// Client options for HTTP requests
export type LinkedInClientOptions = {
  baseUrl: string;
  apiKey: string;
  accountId: string;
  timeoutMs?: number;
};

// Priority for recruiter search filters
export type LinkedInPriority = "MUST_HAVE" | "CAN_HAVE" | "DOESNT_HAVE";

// Scope for role/company time filters
export type LinkedInRoleScope =
  | "CURRENT_OR_PAST"
  | "CURRENT"
  | "PAST"
  | "PAST_NOT_CURRENT"
  | "OPEN_TO_WORK";

export type LinkedInCompanyScope = "CURRENT_OR_PAST" | "CURRENT" | "PAST" | "PAST_NOT_CURRENT";

// Network distance enum
export type LinkedInNetworkDistance =
  | "SELF"
  | "DISTANCE_1"
  | "DISTANCE_2"
  | "DISTANCE_3"
  | "OUT_OF_NETWORK";

// Search parameter from the parameters endpoint
export type LinkedInSearchParameter = {
  object: "LinkedinSearchParameter";
  id: string;
  title: string;
  picture_url?: string;
  additional_data?: Record<string, string | number | boolean>;
};

export type LinkedInSearchParametersResponse = {
  object: "LinkedinSearchParametersList";
  items: LinkedInSearchParameter[];
  paging: {
    page_count: number;
  };
};

// Skill info in search results
export type LinkedInSkill = {
  name: string;
  endorsement_count: number;
};

// Position info in search results
export type LinkedInPosition = {
  company: string;
  company_id: string | null;
  company_url: string | null;
  company_description: string | null;
  company_headcount: { min: number; max: number } | null;
  logo: string | null;
  description: string | null;
  role: string;
  location: string | null;
  industry: string[];
  tenure_at_role?: { years: number; months: number };
  tenure_at_company?: { years: number; months: number };
  start?: { year: number; month: number };
  end?: { year: number; month: number };
  skills: LinkedInSkill[] | null;
};

// Education info in search results
export type LinkedInEducation = {
  degree: string | null;
  field_of_study: string | null;
  school: string;
  school_id: string | null;
  start?: { year: number; month?: number };
  end?: { year: number; month?: number };
};

// People search result
export type LinkedInPeopleResult = {
  object: "SearchResult";
  type: "PEOPLE";
  id: string;
  public_identifier: string | null;
  public_profile_url: string | null;
  profile_url: string | null;
  profile_picture_url: string | null;
  profile_picture_url_large: string | null;
  member_urn: string | null;
  name: string | null;
  first_name?: string;
  last_name?: string;
  network_distance: LinkedInNetworkDistance;
  location: string | null;
  industry: string | null;
  keywords_match?: string;
  headline: string;
  connections_count?: number;
  followers_count?: number;
  pending_invitation?: boolean;
  can_send_inmail?: boolean;
  premium?: boolean;
  verified?: boolean;
  open_profile?: boolean;
  shared_connections_count?: number;
  skills?: LinkedInSkill[];
  current_positions?: LinkedInPosition[];
  education?: LinkedInEducation[];
  work_experience?: LinkedInPosition[];
};

// Company search result
export type LinkedInCompanyResult = {
  object: "SearchResult";
  type: "COMPANY";
  id: string;
  name: string;
  location: string | null;
  profile_url: string;
  industry: string;
  summary: string | null;
  followers_count?: number;
  job_offers_count?: number;
  headcount?: string;
};

// Union type for search results
export type LinkedInSearchResult = LinkedInPeopleResult | LinkedInCompanyResult;

// Search response from POST /api/v1/linkedin/search
export type LinkedInSearchResponse = {
  object: "LinkedinSearch";
  items: LinkedInSearchResult[];
  paging: {
    start: number | null;
    page_count: number;
    total_count: number;
  };
  cursor: string | null;
  config?: {
    params?: Record<string, unknown>;
  };
  metadata?: {
    search_history_id?: string;
    search_context_id?: string;
    search_request_id?: string;
  };
};

// Classic people search params
export type LinkedInClassicPeopleSearchParams = {
  api: "classic";
  category: "people";
  keywords?: string;
  industry?: string[];
  location?: string[];
  profile_language?: string[];
  network_distance?: Array<1 | 2 | 3>;
  company?: string[];
  past_company?: string[];
  school?: string[];
  service?: string[];
  connections_of?: string[];
  followers_of?: string[];
  open_to?: Array<"proBono" | "boardMember">;
  advanced_keywords?: {
    first_name?: string;
    last_name?: string;
    title?: string;
    company?: string;
    school?: string;
  };
};

// Recruiter people search params (simplified for tool usage)
export type LinkedInRecruiterSearchParams = {
  api: "recruiter";
  category: "people";
  keywords?: string;
  locale?: string;
  location?: Array<{
    id: string;
    priority?: LinkedInPriority;
    scope?: "CURRENT" | "OPEN_TO_RELOCATE_ONLY" | "CURRENT_OR_OPEN_TO_RELOCATE";
    title?: string;
  }>;
  location_within_area?: number;
  industry?: {
    include?: string[];
    exclude?: string[];
  };
  role?: Array<{
    keywords?: string;
    id?: string;
    is_selection?: boolean;
    priority?: LinkedInPriority;
    scope?: LinkedInRoleScope;
  }>;
  skills?: Array<{
    keywords?: string;
    id?: string;
    priority?: LinkedInPriority;
  }>;
  company?: Array<{
    keywords?: string;
    id?: string;
    name?: string;
    priority?: LinkedInPriority;
    scope?: LinkedInCompanyScope;
  }>;
  company_headcount?: Array<{
    min?: number;
    max?: number;
  }>;
  school?: Array<{
    id: string;
    priority?: LinkedInPriority;
  }>;
  tenure?: {
    min?: number;
    max?: number;
  };
  seniority?: {
    include?: Array<
      | "owner"
      | "partner"
      | "cxo"
      | "vp"
      | "director"
      | "manager"
      | "senior"
      | "entry"
      | "training"
      | "unpaid"
    >;
    exclude?: Array<
      | "owner"
      | "partner"
      | "cxo"
      | "vp"
      | "director"
      | "manager"
      | "senior"
      | "entry"
      | "training"
      | "unpaid"
    >;
  };
  network_distance?: Array<1 | 2 | 3 | "GROUP">;
  profile_language?: string[];
  spotlights?: Array<
    | "OPEN_TO_WORK"
    | "ACTIVE_TALENT"
    | "REDISCOVERED_CANDIDATES"
    | "INTERNAL_CANDIDATES"
    | "INTERESTED_IN_YOUR_COMPANY"
    | "HAVE_COMPANY_CONNECTIONS"
  >;
};

// Search request body (union of supported types)
export type LinkedInSearchRequestBody =
  | LinkedInClassicPeopleSearchParams
  | LinkedInRecruiterSearchParams
  | { cursor: string }
  | { url: string };

// Error response format
export type LinkedInApiError = {
  title: string;
  detail?: string;
  instance?: string;
  type: string;
  status: number;
};

// ============================================================================
// LinkedIn Messaging Types (Unipile Messaging API)
// ============================================================================

// Note: LinkedInMessagingConfig is defined at the top of this file

// Chat (conversation) from GET /api/v1/chats
export type LinkedInChat = {
  object: "Chat";
  id: string;
  account_id: string;
  account_type: "LINKEDIN";
  provider_id: string;
  attendee_provider_id?: string;
  name: string | null;
  type: 0 | 1 | 2; // 0=direct, 1=group, 2=channel
  timestamp: string | null;
  unread_count: number;
  archived: 0 | 1;
  muted_until: -1 | string | null;
  read_only: 0 | 1 | 2;
  pinned: 0 | 1;
  subject?: string;
  organization_id?: string;
  mailbox_id?: string;
  content_type?: "inmail" | "sponsored" | "linkedin_offer";
  folder?: Array<
    | "INBOX"
    | "INBOX_LINKEDIN_CLASSIC"
    | "INBOX_LINKEDIN_RECRUITER"
    | "INBOX_LINKEDIN_SALES_NAVIGATOR"
    | "INBOX_LINKEDIN_ORGANIZATION"
  >;
};

// Chat list response
export type LinkedInChatListResponse = {
  object: "ChatList";
  items: LinkedInChat[];
  cursor: string | null;
};

// Attachment types
export type LinkedInMessageAttachment =
  | {
      id: string;
      type: "img";
      unavailable: boolean;
      mimetype?: string;
      url?: string;
      url_expires_at?: number;
      file_size?: number;
      size: { width: number; height: number };
      sticker: boolean;
    }
  | {
      id: string;
      type: "video";
      unavailable: boolean;
      mimetype?: string;
      url?: string;
      url_expires_at?: number;
      file_size?: number;
      size: { width: number; height: number };
      gif: boolean;
    }
  | {
      id: string;
      type: "audio";
      unavailable: boolean;
      mimetype?: string;
      url?: string;
      url_expires_at?: number;
      file_size?: number;
      duration?: number;
      voice_note: boolean;
    }
  | {
      id: string;
      type: "file";
      unavailable: boolean;
      mimetype?: string;
      url?: string;
      url_expires_at?: number;
      file_size?: number;
      file_name: string;
    }
  | {
      id: string;
      type: "linkedin_post";
      unavailable: boolean;
      mimetype?: string;
      url?: string;
    }
  | {
      id: string;
      type: "video_meeting";
      unavailable: boolean;
      starts_at: number | null;
      expires_at: number | null;
      time_range: number | null;
    };

// Message from GET /api/v1/chats/{chat_id}/messages
export type LinkedInMessage = {
  object: "Message";
  id: string;
  account_id: string;
  chat_id: string;
  chat_provider_id: string;
  provider_id: string;
  sender_id: string;
  sender_attendee_id: string;
  text: string | null;
  timestamp: string;
  is_sender: 0 | 1;
  attachments: LinkedInMessageAttachment[];
  reactions: Array<{ value: string; sender_id: string; is_sender: boolean }>;
  seen: 0 | 1;
  seen_by: Record<string, string | boolean>;
  hidden: 0 | 1;
  deleted: 0 | 1;
  edited: 0 | 1;
  is_event: 0 | 1;
  delivered: 0 | 1;
  behavior: 0 | null;
  original: string;
  message_type?:
    | "MESSAGE"
    | "INVITATION"
    | "INMAIL"
    | "INMAIL_DECLINE"
    | "INMAIL_REPLY"
    | "INMAIL_ACCEPT";
  attendee_type?: "MEMBER" | "ORGANIZATION" | "OTHER";
  attendee_distance?: 1 | 2 | 3 | 4 | -1;
  subject?: string | null;
  quoted?: {
    provider_id: string;
    sender_id: string;
    text: string | null;
    attachments: LinkedInMessageAttachment[];
  };
};

// Message list response
export type LinkedInMessageListResponse = {
  object: "MessageList";
  items: LinkedInMessage[];
  cursor: string | null;
};

// Chat attendee (contact)
export type LinkedInChatAttendee = {
  object: "ChatAttendee";
  id: string;
  account_id: string;
  provider_id: string;
  display_name: string | null;
  is_self: 0 | 1;
  is_member: 0 | 1;
  picture_url?: string;
  profile_url?: string;
};

// Chat attendees list response
export type LinkedInChatAttendeesResponse = {
  object: "ChatAttendeeList";
  items: LinkedInChatAttendee[];
  cursor: string | null;
};

// Start chat request body (POST /api/v1/chats)
export type LinkedInStartChatRequest = {
  account_id: string;
  attendees_ids: string[];
  text?: string;
  subject?: string;
  linkedin?: {
    api?: "classic" | "recruiter" | "sales_navigator";
    inmail?: boolean;
    topic?: "service_request" | "request_demo" | "support" | "careers" | "other";
    signature?: string;
    hiring_project_id?: string;
    job_posting_id?: string;
    visibility?: "PUBLIC" | "PRIVATE" | "PROJECT";
  };
};

// Start chat response
export type LinkedInStartChatResponse = {
  object: "ChatStarted";
  chat_id: string | null;
  message_id: string | null;
};

// Send message request (POST /api/v1/chats/{chat_id}/messages)
export type LinkedInSendMessageRequest = {
  text?: string;
  account_id?: string;
  quote_id?: string;
};

// Send message response
export type LinkedInSendMessageResponse = {
  object: "MessageSent";
  message_id: string | null;
};

// Webhook creation request (POST /api/v1/webhooks)
export type LinkedInCreateWebhookRequest = {
  request_url: string;
  source: "messaging";
  name?: string;
  format?: "json" | "form";
  account_ids?: string[];
  enabled?: boolean;
  events?: Array<
    | "message_received"
    | "message_read"
    | "message_reaction"
    | "message_edited"
    | "message_deleted"
    | "message_delivered"
  >;
  headers?: Array<{ key: string; value: string }>;
};

// Webhook creation response
export type LinkedInCreateWebhookResponse = {
  object: "WebhookCreated";
  webhook_id: string;
};

// User profile response (GET /api/v1/users/{identifier})
export type LinkedInUserProfile = {
  object: "UserProfile";
  provider: "LINKEDIN";
  provider_id: string;
  public_identifier: string | null;
  first_name: string | null;
  last_name: string | null;
  headline?: string;
  location?: string;
  profile_picture_url?: string;
  public_profile_url?: string;
};

// Webhook payload (received from Unipile)
export type LinkedInWebhookPayload = {
  account_id: string;
  account_type: "LINKEDIN";
  chat_id: string;
  message_id: string;
  message: string;
  timestamp: string;
  webhook_name?: string;
  sender: {
    id: string;
    name?: string;
  };
  is_sender: boolean;
  attendees?: Array<{
    id: string;
    display_name?: string;
    is_self?: boolean;
  }>;
  attachments?: LinkedInMessageAttachment[];
  subject?: string;
  provider_chat_id?: string;
  provider_message_id?: string;
  is_event?: boolean;
  chat_content_type?: "inmail" | "sponsored";
  message_type?: "MESSAGE" | "INMAIL" | "INVITATION";
  is_group?: boolean;
  folder?: string[];
};
