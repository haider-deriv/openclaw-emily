/**
 * LinkedIn Talent Search Module Types
 *
 * Types for the Unipile-based LinkedIn search integration.
 */

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
