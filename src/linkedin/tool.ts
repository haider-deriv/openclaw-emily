/**
 * LinkedIn Talent Search Tool
 *
 * Agent tool for searching candidates on LinkedIn.
 */

import { Type } from "@sinclair/typebox";
import { optionalStringEnum, stringEnum } from "../agents/schema/typebox.js";
import type { AnyAgentTool } from "../agents/tools/common.js";
import {
  jsonResult,
  readNumberParam,
  readStringArrayParam,
  readStringParam,
} from "../agents/tools/common.js";
import type { OpenClawConfig } from "../config/config.js";
import { resolveLinkedInAccount, buildClientOptions, getMissingCredentials } from "./accounts.js";
import {
  listConnections,
  startChat,
  classifyLinkedInError,
  getUserProfile,
  getUserPosts,
  getUserComments,
  getUserReactions,
  listChats,
  getChat,
  getMessages,
  getChatAttendees,
  type LinkedInConnection,
} from "./client.js";
import { searchTalent, formatSearchResultsText } from "./search.js";
import type { LinkedInCompanyScope, LinkedInPriority, LinkedInRoleScope } from "./types.js";

const LINKEDIN_API_VALUES = ["classic", "recruiter", "sales_navigator"] as const;
const LINKEDIN_PRIORITY_VALUES = ["MUST_HAVE", "CAN_HAVE", "DOESNT_HAVE"] as const;
const LINKEDIN_ROLE_SCOPE_VALUES = [
  "CURRENT_OR_PAST",
  "CURRENT",
  "PAST",
  "PAST_NOT_CURRENT",
  "OPEN_TO_WORK",
] as const;
const LINKEDIN_COMPANY_SCOPE_VALUES = [
  "CURRENT_OR_PAST",
  "CURRENT",
  "PAST",
  "PAST_NOT_CURRENT",
] as const;
const LINKEDIN_SPOTLIGHT_VALUES = [
  "OPEN_TO_WORK",
  "ACTIVE_TALENT",
  "REDISCOVERED_CANDIDATES",
  "INTERNAL_CANDIDATES",
  "INTERESTED_IN_YOUR_COMPANY",
  "HAVE_COMPANY_CONNECTIONS",
] as const;
const LINKEDIN_SENIORITY_VALUES = [
  "owner",
  "partner",
  "cxo",
  "vp",
  "director",
  "manager",
  "senior",
  "entry",
  "training",
  "unpaid",
] as const;

// Tool input schema
const LinkedInTalentSearchSchema = Type.Object({
  api: optionalStringEnum(LINKEDIN_API_VALUES, {
    description: "LinkedIn API mode to use (classic, recruiter, or sales_navigator).",
  }),
  keywords: Type.Optional(
    Type.String({
      description: "General search keywords (e.g., 'AI Engineer', 'Python developer').",
    }),
  ),
  role: Type.Optional(
    Type.Array(
      Type.Object({
        keywords: Type.Optional(Type.String({ description: "Job title or role keywords." })),
        id: Type.Optional(
          Type.String({ description: "Role parameter ID from LinkedIn search parameters." }),
        ),
        is_selection: Type.Optional(
          Type.Boolean({
            description: "Whether to include related roles/aliases for this role filter.",
          }),
        ),
        priority: optionalStringEnum(LINKEDIN_PRIORITY_VALUES, {
          description: "Priority: MUST_HAVE, CAN_HAVE, or DOESNT_HAVE.",
        }),
        scope: optionalStringEnum(LINKEDIN_ROLE_SCOPE_VALUES, {
          description: "Scope: CURRENT_OR_PAST, CURRENT, PAST, PAST_NOT_CURRENT, or OPEN_TO_WORK.",
        }),
      }),
      { description: "Filter by job roles/titles." },
    ),
  ),
  skills: Type.Optional(
    Type.Array(
      Type.Object({
        keywords: Type.Optional(
          Type.String({
            description: "Skill keywords (e.g., 'Python', 'Machine Learning').",
          }),
        ),
        id: Type.Optional(
          Type.String({ description: "Skill parameter ID from LinkedIn search parameters." }),
        ),
        priority: optionalStringEnum(LINKEDIN_PRIORITY_VALUES, {
          description: "Priority: MUST_HAVE, CAN_HAVE, or DOESNT_HAVE.",
        }),
      }),
      { description: "Filter by skills." },
    ),
  ),
  company: Type.Optional(
    Type.Array(
      Type.Object({
        keywords: Type.Optional(Type.String({ description: "Company keywords." })),
        id: Type.Optional(Type.String({ description: "Company parameter ID." })),
        name: Type.Optional(Type.String({ description: "Company name." })),
        priority: optionalStringEnum(LINKEDIN_PRIORITY_VALUES, {
          description: "Priority: MUST_HAVE, CAN_HAVE, or DOESNT_HAVE.",
        }),
        scope: optionalStringEnum(LINKEDIN_COMPANY_SCOPE_VALUES, {
          description: "Company scope: CURRENT_OR_PAST, CURRENT, PAST, or PAST_NOT_CURRENT.",
        }),
      }),
      { description: "Filter by current/past companies." },
    ),
  ),
  location: Type.Optional(
    Type.String({
      description: "Location filter (e.g., 'San Francisco', 'New York', 'Remote').",
    }),
  ),
  industry: Type.Optional(
    Type.String({
      description: "Industry filter (e.g., 'Technology', 'Finance').",
    }),
  ),
  network_distance: Type.Optional(
    Type.Array(Type.Number(), {
      description: "Network distance filter: 1 (1st connections), 2 (2nd), 3 (3rd+).",
    }),
  ),
  spotlights: Type.Optional(
    Type.Array(stringEnum(LINKEDIN_SPOTLIGHT_VALUES), {
      description: "Recruiter spotlights filter (e.g., OPEN_TO_WORK, ACTIVE_TALENT).",
    }),
  ),
  seniority_include: Type.Optional(
    Type.Array(stringEnum(LINKEDIN_SENIORITY_VALUES), {
      description: "Recruiter seniority include filter.",
    }),
  ),
  seniority_exclude: Type.Optional(
    Type.Array(stringEnum(LINKEDIN_SENIORITY_VALUES), {
      description: "Recruiter seniority exclude filter.",
    }),
  ),
  tenure_min: Type.Optional(
    Type.Number({
      description: "Recruiter tenure minimum in months.",
      minimum: 0,
    }),
  ),
  tenure_max: Type.Optional(
    Type.Number({
      description: "Recruiter tenure maximum in months.",
      minimum: 0,
    }),
  ),
  limit: Type.Optional(
    Type.Number({
      description: "Maximum number of candidates to return. Legacy default: 10.",
      minimum: 1,
      maximum: 1000,
    }),
  ),
  page_size: Type.Optional(
    Type.Number({
      description: "Page size per LinkedIn search request (default: 50, max: 100).",
      minimum: 1,
      maximum: 100,
    }),
  ),
  max_pages: Type.Optional(
    Type.Number({
      description: "Maximum pages to traverse (default: 3).",
      minimum: 1,
      maximum: 20,
    }),
  ),
  cursor: Type.Optional(
    Type.String({
      description: "Pagination cursor to continue a previous LinkedIn search.",
    }),
  ),
  use_recruiter: Type.Optional(
    Type.Boolean({
      description:
        "Legacy switch. Use recruiter API mode when api is omitted (backward compatibility).",
    }),
  ),
  account_id: Type.Optional(
    Type.String({
      description: "Account ID for multi-account setups.",
    }),
  ),
});

const LinkedInCandidateEnrichSchema = Type.Object({
  identifier: Type.String({
    description:
      "LinkedIn identifier: provider_id, public_identifier, or profile identifier from search results.",
  }),
  linkedin_api: optionalStringEnum(LINKEDIN_API_VALUES, {
    description: "LinkedIn API mode for profile enrichment.",
  }),
  sections: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'Profile sections to request. Default: ["*_preview", "skills", "experience", "projects"].',
    }),
  ),
  activity_window_days: Type.Optional(
    Type.Number({
      description: "Activity lookback window in days (default: 90).",
      minimum: 1,
      maximum: 365,
    }),
  ),
  activity_limit: Type.Optional(
    Type.Number({
      description: "Max items per activity source (posts/comments/reactions). Default: 50.",
      minimum: 1,
      maximum: 200,
    }),
  ),
  include_activity: Type.Optional(
    Type.Boolean({
      description: "Whether to fetch posts/comments/reactions (default: true).",
    }),
  ),
  account_id: Type.Optional(
    Type.String({
      description: "Account ID for multi-account setups.",
    }),
  ),
});

function normalizePriority(value: unknown): LinkedInPriority | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const upper = value.toUpperCase();
  if (upper === "MUST_HAVE" || upper === "CAN_HAVE" || upper === "DOESNT_HAVE") {
    return upper as LinkedInPriority;
  }
  return undefined;
}

function normalizeRoleScope(value: unknown): LinkedInRoleScope | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const upper = value.toUpperCase();
  const validScopes = ["CURRENT_OR_PAST", "CURRENT", "PAST", "PAST_NOT_CURRENT", "OPEN_TO_WORK"];
  if (validScopes.includes(upper)) {
    return upper as LinkedInRoleScope;
  }
  return undefined;
}

function normalizeCompanyScope(value: unknown): LinkedInCompanyScope | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const upper = value.toUpperCase();
  const validScopes = ["CURRENT_OR_PAST", "CURRENT", "PAST", "PAST_NOT_CURRENT"];
  if (validScopes.includes(upper)) {
    return upper as LinkedInCompanyScope;
  }
  return undefined;
}

function parseRoleArray(raw: unknown):
  | Array<{
      keywords?: string;
      id?: string;
      is_selection?: boolean;
      priority?: LinkedInPriority;
      scope?: LinkedInRoleScope;
    }>
  | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const result: Array<{
    keywords?: string;
    id?: string;
    is_selection?: boolean;
    priority?: LinkedInPriority;
    scope?: LinkedInRoleScope;
  }> = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const keywords = typeof obj.keywords === "string" ? obj.keywords.trim() : "";
    const id = typeof obj.id === "string" ? obj.id.trim() : "";
    if (!keywords && !id) {
      continue;
    }
    result.push({
      keywords: keywords || undefined,
      id: id || undefined,
      is_selection: typeof obj.is_selection === "boolean" ? obj.is_selection : undefined,
      priority: normalizePriority(obj.priority),
      scope: normalizeRoleScope(obj.scope),
    });
  }
  return result.length > 0 ? result : undefined;
}

function parseSkillsArray(
  raw: unknown,
): Array<{ keywords?: string; id?: string; priority?: LinkedInPriority }> | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const result: Array<{ keywords?: string; id?: string; priority?: LinkedInPriority }> = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const keywords = typeof obj.keywords === "string" ? obj.keywords.trim() : "";
    const id = typeof obj.id === "string" ? obj.id.trim() : "";
    if (!keywords && !id) {
      continue;
    }
    result.push({
      keywords: keywords || undefined,
      id: id || undefined,
      priority: normalizePriority(obj.priority),
    });
  }
  return result.length > 0 ? result : undefined;
}

function parseCompanyArray(raw: unknown):
  | Array<{
      keywords?: string;
      id?: string;
      name?: string;
      priority?: LinkedInPriority;
      scope?: LinkedInCompanyScope;
    }>
  | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const result: Array<{
    keywords?: string;
    id?: string;
    name?: string;
    priority?: LinkedInPriority;
    scope?: LinkedInCompanyScope;
  }> = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const keywords = typeof obj.keywords === "string" ? obj.keywords.trim() : "";
    const id = typeof obj.id === "string" ? obj.id.trim() : "";
    const name = typeof obj.name === "string" ? obj.name.trim() : "";
    if (!keywords && !id && !name) {
      continue;
    }
    result.push({
      keywords: keywords || undefined,
      id: id || undefined,
      name: name || undefined,
      priority: normalizePriority(obj.priority),
      scope: normalizeCompanyScope(obj.scope),
    });
  }
  return result.length > 0 ? result : undefined;
}

function parseNetworkDistance(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const result = raw
    .map((v) => (typeof v === "number" ? v : Number.parseInt(String(v), 10)))
    .filter((v) => Number.isFinite(v) && v >= 1 && v <= 3);
  return result.length > 0 ? result : undefined;
}

function parseNumberArray(raw: unknown, valid: readonly string[]): string[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const validSet = new Set(valid);
  const items = raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item && validSet.has(item));
  return items.length > 0 ? items : undefined;
}

function parseLinkedInApi(raw: unknown): "classic" | "recruiter" | "sales_navigator" | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const value = raw.trim().toLowerCase();
  if (value === "classic" || value === "recruiter" || value === "sales_navigator") {
    return value;
  }
  return undefined;
}

function parseActivityTimestamp(item: Record<string, unknown>): number | null {
  const candidates = [
    item.created_at,
    item.published_at,
    item.timestamp,
    item.createdAt,
    item.publishedAt,
  ];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) {
      if (value > 1_000_000_000_000) {
        return value;
      }
      if (value > 1_000_000_000) {
        return value * 1000;
      }
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        if (numeric > 1_000_000_000_000) {
          return numeric;
        }
        if (numeric > 1_000_000_000) {
          return numeric * 1000;
        }
      }
    }
  }
  return null;
}

function collectEvidenceUrls(input: {
  profile: Record<string, unknown>;
  posts: Array<Record<string, unknown>>;
  comments: Array<Record<string, unknown>>;
  reactions: Array<Record<string, unknown>>;
}): string[] {
  const urls = new Set<string>();

  const addUrl = (value: unknown) => {
    if (typeof value !== "string") {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
      return;
    }
    urls.add(trimmed);
  };

  addUrl(input.profile.public_profile_url);
  addUrl(input.profile.profile_url);

  const websites = Array.isArray(input.profile.websites) ? input.profile.websites : [];
  for (const website of websites) {
    if (typeof website === "object" && website !== null) {
      addUrl((website as Record<string, unknown>).url);
    }
  }

  const socialLinks = Array.isArray(input.profile.social_links) ? input.profile.social_links : [];
  for (const link of socialLinks) {
    if (typeof link === "object" && link !== null) {
      addUrl((link as Record<string, unknown>).url);
    }
  }

  for (const item of [...input.posts, ...input.comments, ...input.reactions]) {
    addUrl(item.url);
    addUrl(item.link);
    addUrl(item.permalink);
  }

  return Array.from(urls);
}

/**
 * Create the LinkedIn talent search tool.
 */
export function createLinkedInTalentSearchTool(options?: {
  config?: OpenClawConfig;
}): AnyAgentTool | null {
  const cfg = options?.config;

  const account = resolveLinkedInAccount({ cfg: cfg ?? ({} as OpenClawConfig) });
  if (!account.enabled) {
    return null;
  }

  return {
    label: "LinkedIn Talent Search",
    name: "linkedin_talent_search",
    description:
      "Search for candidates on LinkedIn with classic/recruiter/sales-navigator modes, " +
      "advanced filters, and cursor pagination. Returns stable identity fields for matching.",
    parameters: LinkedInTalentSearchSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;

      const api = parseLinkedInApi(params.api);
      const keywords = readStringParam(params, "keywords");
      const location = readStringParam(params, "location");
      const industry = readStringParam(params, "industry");
      const limit = readNumberParam(params, "limit", { integer: true });
      const pageSize = readNumberParam(params, "page_size", { integer: true });
      const maxPages = readNumberParam(params, "max_pages", { integer: true });
      const cursor = readStringParam(params, "cursor");
      const useRecruiter = params.use_recruiter === true;
      const accountId = readStringParam(params, "account_id");

      const role = parseRoleArray(params.role);
      const skills = parseSkillsArray(params.skills);
      const company = parseCompanyArray(params.company);
      const network_distance = parseNetworkDistance(params.network_distance);
      const spotlights = parseNumberArray(params.spotlights, LINKEDIN_SPOTLIGHT_VALUES);
      const seniorityInclude = parseNumberArray(
        params.seniority_include,
        LINKEDIN_SENIORITY_VALUES,
      );
      const seniorityExclude = parseNumberArray(
        params.seniority_exclude,
        LINKEDIN_SENIORITY_VALUES,
      );
      const tenureMin = readNumberParam(params, "tenure_min", { integer: true });
      const tenureMax = readNumberParam(params, "tenure_max", { integer: true });

      if (
        !keywords &&
        !role?.length &&
        !skills?.length &&
        !location &&
        !industry &&
        !company?.length
      ) {
        return jsonResult({
          success: false,
          error:
            "At least one search parameter is required (keywords, role, skills, company, location, or industry).",
          candidates: [],
        });
      }

      const result = await searchTalent(
        {
          api,
          keywords,
          role,
          skills,
          company,
          location,
          industry,
          network_distance,
          spotlights: spotlights as
            | Array<
                | "OPEN_TO_WORK"
                | "ACTIVE_TALENT"
                | "REDISCOVERED_CANDIDATES"
                | "INTERNAL_CANDIDATES"
                | "INTERESTED_IN_YOUR_COMPANY"
                | "HAVE_COMPANY_CONNECTIONS"
              >
            | undefined,
          seniority:
            seniorityInclude || seniorityExclude
              ? {
                  include: seniorityInclude as
                    | Array<
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
                      >
                    | undefined,
                  exclude: seniorityExclude as
                    | Array<
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
                      >
                    | undefined,
                }
              : undefined,
          tenure:
            tenureMin !== undefined || tenureMax !== undefined
              ? {
                  min: tenureMin ?? undefined,
                  max: tenureMax ?? undefined,
                }
              : undefined,
          limit,
          page_size: pageSize,
          max_pages: maxPages,
          cursor,
          useRecruiter,
          accountId,
        },
        cfg ?? ({} as OpenClawConfig),
      );

      return jsonResult({
        ...result,
        formatted: formatSearchResultsText(result),
      });
    },
  };
}

/**
 * Create the LinkedIn candidate enrichment tool.
 */
export function createLinkedInCandidateEnrichTool(options?: {
  config?: OpenClawConfig;
}): AnyAgentTool | null {
  const cfg = options?.config;

  const account = resolveLinkedInAccount({ cfg: cfg ?? ({} as OpenClawConfig) });
  if (!account.enabled) {
    return null;
  }

  return {
    label: "LinkedIn Candidate Enrich",
    name: "linkedin_candidate_enrich",
    description:
      "Fetch LinkedIn candidate profile + recent activity (posts/comments/reactions) and return " +
      "a normalized enrichment envelope with summary, evidence links, and throttle indicators.",
    parameters: LinkedInCandidateEnrichSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;

      const identifier = readStringParam(params, "identifier", { required: true });
      const linkedinApi = parseLinkedInApi(params.linkedin_api);
      const sections = readStringArrayParam(params, "sections") ?? [
        "*_preview",
        "skills",
        "experience",
        "projects",
      ];
      const activityWindowDays =
        readNumberParam(params, "activity_window_days", { integer: true }) ?? 90;
      const activityLimit = readNumberParam(params, "activity_limit", { integer: true }) ?? 50;
      const includeActivity = params.include_activity !== false;
      const accountId = readStringParam(params, "account_id");

      const resolvedAccount = accountId
        ? resolveLinkedInAccount({ cfg: cfg ?? ({} as OpenClawConfig), accountId })
        : account;
      const clientOpts = buildClientOptions(resolvedAccount);
      if (!clientOpts) {
        const missing = getMissingCredentials(resolvedAccount);
        return jsonResult({
          success: false,
          error: `LinkedIn is not configured. Missing: ${missing.join(", ")}`,
        });
      }

      try {
        const profile = (await getUserProfile(clientOpts, identifier, {
          linkedinApi,
          linkedinSections: sections,
        })) as Record<string, unknown>;

        const now = Date.now();
        const cutoffMs = now - Math.max(1, activityWindowDays) * 24 * 60 * 60 * 1000;

        let posts: Array<Record<string, unknown>> = [];
        let comments: Array<Record<string, unknown>> = [];
        let reactions: Array<Record<string, unknown>> = [];

        const throttleIndicators: {
          rate_limited: boolean;
          partial: boolean;
          issues: Array<{ source: string; errorType: string; message: string; retryable: boolean }>;
        } = {
          rate_limited: false,
          partial: false,
          issues: [],
        };

        if (includeActivity) {
          const [postsResult, commentsResult, reactionsResult] = await Promise.allSettled([
            getUserPosts(clientOpts, identifier, { limit: activityLimit }),
            getUserComments(clientOpts, identifier, { limit: activityLimit }),
            getUserReactions(clientOpts, identifier, { limit: activityLimit }),
          ]);

          const extractItems = (
            result: PromiseSettledResult<Record<string, unknown>>,
            source: "posts" | "comments" | "reactions",
          ): Array<Record<string, unknown>> => {
            if (result.status === "fulfilled") {
              const items = Array.isArray(result.value.items)
                ? (result.value.items as Array<Record<string, unknown>>)
                : [];
              return items.filter((item) => {
                const ts = parseActivityTimestamp(item);
                return ts === null || ts >= cutoffMs;
              });
            }
            const classified = classifyLinkedInError(result.reason);
            throttleIndicators.partial = true;
            if (classified.type === "rate_limit") {
              throttleIndicators.rate_limited = true;
            }
            throttleIndicators.issues.push({
              source,
              errorType: classified.type,
              message: classified.userFriendlyMessage,
              retryable: classified.isTransient,
            });
            return [];
          };

          posts = extractItems(
            postsResult as PromiseSettledResult<Record<string, unknown>>,
            "posts",
          );
          comments = extractItems(
            commentsResult as PromiseSettledResult<Record<string, unknown>>,
            "comments",
          );
          reactions = extractItems(
            reactionsResult as PromiseSettledResult<Record<string, unknown>>,
            "reactions",
          );
        }

        const allActivity = [...posts, ...comments, ...reactions];
        const timestamps = allActivity
          .map((item) => parseActivityTimestamp(item))
          .filter((ts): ts is number => ts !== null)
          .toSorted((a, b) => b - a);
        const lastActivityAt = timestamps[0] ? new Date(timestamps[0]).toISOString() : null;

        const evidenceLinks = collectEvidenceUrls({
          profile,
          posts,
          comments,
          reactions,
        });

        return jsonResult({
          success: true,
          identifier,
          api: linkedinApi ?? "classic",
          profile,
          activity_window_days: activityWindowDays,
          activity_summary: {
            posts_count: posts.length,
            comments_count: comments.length,
            reactions_count: reactions.length,
            total_count: allActivity.length,
            last_activity_at: lastActivityAt,
          },
          activity: {
            posts,
            comments,
            reactions,
          },
          evidence_links: evidenceLinks,
          throttle: throttleIndicators,
        });
      } catch (err) {
        const classified = classifyLinkedInError(err);
        return jsonResult({
          success: false,
          error: classified.userFriendlyMessage,
          errorType: classified.type,
          canRetry: classified.isTransient,
        });
      }
    },
  };
}

// =============================================================================
// LinkedIn Message Connection Tool
// =============================================================================

const LinkedInMessageConnectionSchema = Type.Object({
  name: Type.String({
    description:
      "Name of the connection to search for (e.g., 'John Smith', 'Haider Sultan'). " +
      "Will search your LinkedIn connections by first and last name.",
  }),
  message: Type.String({
    description: "The message to send to the connection.",
  }),
  confirm_id: Type.Optional(
    Type.String({
      description:
        "If multiple connections match, provide the member_id of the specific person to message. " +
        "This is returned in the search results when there are multiple matches.",
    }),
  ),
  account_id: Type.Optional(
    Type.String({
      description: "Account ID for multi-account setups.",
    }),
  ),
});

/**
 * Format connection for display.
 */
function formatConnection(conn: LinkedInConnection, index: number): string {
  const name = `${conn.first_name} ${conn.last_name}`.trim();
  const headline = conn.headline ? ` - ${conn.headline}` : "";
  const url = conn.public_profile_url ? `\n   URL: ${conn.public_profile_url}` : "";
  return `${index + 1}. ${name}${headline}\n   ID: ${conn.member_id}${url}`;
}

/**
 * Create the LinkedIn message connection tool.
 * This tool searches your connections by name and sends a message.
 * If multiple matches are found, it returns the list for confirmation.
 */
export function createLinkedInMessageConnectionTool(options?: {
  config?: OpenClawConfig;
}): AnyAgentTool | null {
  const cfg = options?.config;

  // Check if LinkedIn is configured
  const account = resolveLinkedInAccount({ cfg: cfg ?? ({} as OpenClawConfig) });
  if (!account.enabled) {
    return null;
  }

  return {
    label: "LinkedIn Message Connection",
    name: "linkedin_message_connection",
    description:
      "Search your LinkedIn connections by name and send them a message. " +
      "If multiple people match the name, returns a list to choose from. " +
      "Use confirm_id to specify which person when there are multiple matches.",
    parameters: LinkedInMessageConnectionSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;

      const name = readStringParam(params, "name");
      const message = readStringParam(params, "message");
      const confirmId = readStringParam(params, "confirm_id");
      const accountId = readStringParam(params, "account_id");

      if (!name) {
        return jsonResult({
          success: false,
          error: "Name is required to search for a connection.",
        });
      }

      if (!message) {
        return jsonResult({
          success: false,
          error: "Message is required.",
        });
      }

      const resolvedAccount = accountId
        ? resolveLinkedInAccount({ cfg: cfg ?? ({} as OpenClawConfig), accountId })
        : account;

      const opts = buildClientOptions(resolvedAccount);
      if (!opts) {
        const missing = getMissingCredentials(resolvedAccount);
        return jsonResult({
          success: false,
          error: `LinkedIn is not configured. Missing: ${missing.join(", ")}`,
        });
      }

      try {
        const response = await listConnections(opts, {
          filter: name,
          limit: 20,
        });

        const matches = response.items;

        if (matches.length === 0) {
          return jsonResult({
            success: false,
            error: `No connections found matching "${name}". Make sure they are in your LinkedIn connections.`,
            suggestion:
              "Try a different spelling or search for their first name or last name only.",
          });
        }

        if (confirmId) {
          const confirmed = matches.find((c) => c.member_id === confirmId);
          if (!confirmed) {
            return jsonResult({
              success: false,
              error: `Connection with ID "${confirmId}" not found in search results.`,
              matches: matches.map((c, i) => formatConnection(c, i)),
            });
          }

          const chatResponse = await startChat(opts, {
            attendees_ids: [confirmed.member_id],
            text: message,
          });

          return jsonResult({
            success: true,
            message_sent: true,
            recipient: {
              name: `${confirmed.first_name} ${confirmed.last_name}`,
              headline: confirmed.headline,
              member_id: confirmed.member_id,
              profile_url: confirmed.public_profile_url,
            },
            chat_id: chatResponse.chat_id,
            message_id: chatResponse.message_id,
          });
        }

        if (matches.length === 1) {
          const recipient = matches[0];

          const chatResponse = await startChat(opts, {
            attendees_ids: [recipient.member_id],
            text: message,
          });

          return jsonResult({
            success: true,
            message_sent: true,
            recipient: {
              name: `${recipient.first_name} ${recipient.last_name}`,
              headline: recipient.headline,
              member_id: recipient.member_id,
              profile_url: recipient.public_profile_url,
            },
            chat_id: chatResponse.chat_id,
            message_id: chatResponse.message_id,
          });
        }

        return jsonResult({
          success: true,
          message_sent: false,
          multiple_matches: true,
          count: matches.length,
          matches: matches.map((c, i) => ({
            index: i + 1,
            name: `${c.first_name} ${c.last_name}`,
            headline: c.headline,
            member_id: c.member_id,
            profile_url: c.public_profile_url,
          })),
          instruction:
            `Found ${matches.length} connections matching "${name}". ` +
            "Please confirm which one to message by calling this tool again with the confirm_id parameter set to their member_id.",
          formatted: matches.map((c, i) => formatConnection(c, i)).join("\n\n"),
        });
      } catch (err) {
        const classified = classifyLinkedInError(err);
        return jsonResult({
          success: false,
          error: classified.userFriendlyMessage,
          errorType: classified.type,
          canRetry: classified.isTransient,
        });
      }
    },
  };
}

/**
 * Check if LinkedIn talent search is available for the given config.
 */
export function isLinkedInTalentSearchAvailable(cfg: OpenClawConfig): boolean {
  const account = resolveLinkedInAccount({ cfg });
  if (!account.enabled) {
    return false;
  }
  const clientOpts = buildClientOptions(account);
  return clientOpts !== undefined;
}

/**
 * Get configuration status for LinkedIn talent search.
 */
export function getLinkedInTalentSearchStatus(cfg: OpenClawConfig): {
  available: boolean;
  enabled: boolean;
  configured: boolean;
  missing: string[];
} {
  const account = resolveLinkedInAccount({ cfg });
  const clientOpts = buildClientOptions(account);
  const missing = getMissingCredentials(account);

  return {
    available: account.enabled && clientOpts !== undefined,
    enabled: account.enabled,
    configured: clientOpts !== undefined,
    missing,
  };
}

// =============================================================================
// LinkedIn InMail Candidate Tool
// =============================================================================

const LinkedInInMailCandidateSchema = Type.Object({
  identifier: Type.String({
    description:
      "LinkedIn identifier of the candidate: provider_id, member_urn, member_id, or public_identifier " +
      "from search results. This is the person you want to message.",
  }),
  message: Type.String({
    description: "The message body to send to the candidate.",
  }),
  subject: Type.Optional(
    Type.String({
      description:
        "Optional subject line for the InMail message. Recommended for better open rates.",
    }),
  ),
  api: optionalStringEnum(LINKEDIN_API_VALUES, {
    description:
      "LinkedIn API mode to use: 'recruiter' for LinkedIn Recruiter, 'sales_navigator' for Sales Navigator, " +
      "or 'classic' for regular LinkedIn with InMail credits. Default: recruiter.",
  }),
  hiring_project_id: Type.Optional(
    Type.String({
      description:
        "Optional LinkedIn Recruiter hiring project ID to associate the message with a job/project.",
    }),
  ),
  job_posting_id: Type.Optional(
    Type.String({
      description: "Optional LinkedIn Recruiter job posting ID to reference in the message.",
    }),
  ),
  visibility: Type.Optional(
    Type.Union([Type.Literal("PUBLIC"), Type.Literal("PRIVATE"), Type.Literal("PROJECT")], {
      description:
        "Message visibility for Recruiter: PUBLIC (visible to all recruiters), " +
        "PRIVATE (only you), or PROJECT (project members). Default: PRIVATE.",
    }),
  ),
  account_id: Type.Optional(
    Type.String({
      description: "Account ID for multi-account setups.",
    }),
  ),
});

/**
 * Create the LinkedIn InMail candidate tool.
 * This tool sends InMail messages to candidates who are not connections,
 * using the Recruiter API, Sales Navigator API, or classic InMail.
 */
export function createLinkedInInMailCandidateTool(options?: {
  config?: OpenClawConfig;
}): AnyAgentTool | null {
  const cfg = options?.config;

  const account = resolveLinkedInAccount({ cfg: cfg ?? ({} as OpenClawConfig) });
  if (!account.enabled) {
    return null;
  }

  return {
    label: "LinkedIn InMail Candidate",
    name: "linkedin_inmail_candidate",
    description:
      "Send an InMail message to a LinkedIn candidate who is NOT a 1st-degree connection. " +
      "Use this for outreach to 2nd/3rd degree connections or out-of-network candidates found via search. " +
      "Requires LinkedIn Recruiter, Sales Navigator, or Premium account with InMail credits. " +
      "For 1st-degree connections, use linkedin_message_connection instead.",
    parameters: LinkedInInMailCandidateSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;

      const identifier = readStringParam(params, "identifier");
      const message = readStringParam(params, "message");
      const subject = readStringParam(params, "subject");
      const api = parseLinkedInApi(params.api) ?? "recruiter";
      const hiringProjectId = readStringParam(params, "hiring_project_id");
      const jobPostingId = readStringParam(params, "job_posting_id");
      const visibility = params.visibility as "PUBLIC" | "PRIVATE" | "PROJECT" | undefined;
      const accountId = readStringParam(params, "account_id");

      if (!identifier) {
        return jsonResult({
          success: false,
          error:
            "Identifier is required. Use the provider_id, member_id, member_urn, or public_identifier " +
            "from linkedin_talent_search results.",
        });
      }

      if (!message) {
        return jsonResult({
          success: false,
          error: "Message is required.",
        });
      }

      const resolvedAccount = accountId
        ? resolveLinkedInAccount({ cfg: cfg ?? ({} as OpenClawConfig), accountId })
        : account;

      const opts = buildClientOptions(resolvedAccount);
      if (!opts) {
        const missing = getMissingCredentials(resolvedAccount);
        return jsonResult({
          success: false,
          error: `LinkedIn is not configured. Missing: ${missing.join(", ")}`,
        });
      }

      try {
        // Build LinkedIn options for InMail
        const linkedinOptions: {
          api: "classic" | "recruiter" | "sales_navigator";
          inmail: boolean;
          hiring_project_id?: string;
          job_posting_id?: string;
          visibility?: "PUBLIC" | "PRIVATE" | "PROJECT";
        } = {
          api,
          inmail: true,
        };

        // Add recruiter-specific options if provided
        if (hiringProjectId) {
          linkedinOptions.hiring_project_id = hiringProjectId;
        }
        if (jobPostingId) {
          linkedinOptions.job_posting_id = jobPostingId;
        }
        if (visibility) {
          linkedinOptions.visibility = visibility;
        }

        // Send InMail via startChat
        const chatResponse = await startChat(opts, {
          attendees_ids: [identifier],
          text: message,
          subject,
          linkedin: linkedinOptions,
        });

        return jsonResult({
          success: true,
          inmail_sent: true,
          api,
          recipient_identifier: identifier,
          subject: subject ?? null,
          chat_id: chatResponse.chat_id,
          message_id: chatResponse.message_id,
          linkedin_options: {
            api,
            inmail: true,
            hiring_project_id: hiringProjectId ?? null,
            job_posting_id: jobPostingId ?? null,
            visibility: visibility ?? null,
          },
        });
      } catch (err) {
        const classified = classifyLinkedInError(err);

        // Provide more specific error messages for common InMail issues
        let errorDetail = classified.userFriendlyMessage;
        if (
          classified.type === "api" &&
          (classified.message.includes("inmail") ||
            classified.message.includes("InMail") ||
            classified.message.includes("credit"))
        ) {
          errorDetail =
            "InMail could not be sent. This may be due to: " +
            "1) No InMail credits available, " +
            "2) The candidate has disabled InMail, " +
            "3) The account type doesn't support InMail (need Recruiter/Sales Navigator/Premium), or " +
            "4) Rate limiting. Original error: " +
            classified.message;
        }

        return jsonResult({
          success: false,
          error: errorDetail,
          errorType: classified.type,
          canRetry: classified.isTransient,
          suggestion:
            classified.type === "auth"
              ? "Check that your LinkedIn account has Recruiter, Sales Navigator, or Premium subscription."
              : classified.type === "rate_limit"
                ? "Wait a few minutes and try again."
                : "Verify the candidate identifier is correct and try again.",
        });
      }
    },
  };
}

// =============================================================================
// LinkedIn List Conversations Tool
// =============================================================================

const LinkedInListConversationsSchema = Type.Object({
  name: Type.Optional(
    Type.String({
      description:
        "Filter conversations by attendee name (partial match). " +
        "Use this to find conversations with a specific person.",
    }),
  ),
  limit: Type.Optional(
    Type.Number({
      description: "Maximum number of conversations to return. Default: 20, max: 50.",
      minimum: 1,
      maximum: 50,
    }),
  ),
  unread_only: Type.Optional(
    Type.Boolean({
      description: "If true, only return conversations with unread messages.",
    }),
  ),
  account_id: Type.Optional(
    Type.String({
      description: "Account ID for multi-account setups.",
    }),
  ),
});

/**
 * Create the LinkedIn list conversations tool.
 * This tool lists all LinkedIn conversations (both regular messages and InMail).
 */
export function createLinkedInListConversationsTool(options?: {
  config?: OpenClawConfig;
}): AnyAgentTool | null {
  const cfg = options?.config;

  const account = resolveLinkedInAccount({ cfg: cfg ?? ({} as OpenClawConfig) });
  if (!account.enabled) {
    return null;
  }

  return {
    label: "LinkedIn List Conversations",
    name: "linkedin_list_conversations",
    description:
      "List LinkedIn conversations (DMs and InMail). " +
      "Use this to find conversations with anyone you've messaged, including non-connections reached via InMail. " +
      "You can filter by name to find a specific conversation. " +
      "Use linkedin_get_conversation_messages with the returned chat_id to read the full conversation.",
    parameters: LinkedInListConversationsSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;

      const nameFilter = readStringParam(params, "name");
      const limit = readNumberParam(params, "limit", { integer: true }) ?? 20;
      const unreadOnly = params.unread_only === true;
      const accountId = readStringParam(params, "account_id");

      const resolvedAccount = accountId
        ? resolveLinkedInAccount({ cfg: cfg ?? ({} as OpenClawConfig), accountId })
        : account;

      const opts = buildClientOptions(resolvedAccount);
      if (!opts) {
        const missing = getMissingCredentials(resolvedAccount);
        return jsonResult({
          success: false,
          error: `LinkedIn is not configured. Missing: ${missing.join(", ")}`,
        });
      }

      try {
        // Fetch more chats than needed to allow for filtering
        const fetchLimit = nameFilter ? Math.min(limit * 3, 100) : limit;
        const chatsResponse = await listChats(opts, {
          limit: fetchLimit,
          unread: unreadOnly ? true : undefined,
        });

        const conversations: Array<{
          chat_id: string;
          attendees: Array<{ id: string; name: string; profile_url?: string }>;
          last_message_at: string | null;
          unread_count: number;
          is_inmail: boolean;
          subject: string | null;
          chat_type: string;
        }> = [];

        // Process chats - use chat.name for DMs (faster and more reliable than getChatAttendees)
        for (const chat of chatsResponse.items) {
          if (conversations.length >= limit) {
            break;
          }

          // For direct messages, use the chat's name and attendee_provider_id
          // These are populated directly on the chat object
          let attendeeName = chat.name || null;
          let attendeeId = chat.attendee_provider_id || null;

          // If chat.name is empty, try to get attendees from API as fallback
          if (!attendeeName && chat.type === 0) {
            try {
              const attendeesResponse = await getChatAttendees(opts, chat.id, { limit: 5 });
              const otherAttendee = attendeesResponse.items.find((a) => a.is_self !== 1);
              if (otherAttendee) {
                attendeeName = otherAttendee.name || null;
                attendeeId = attendeeId || otherAttendee.provider_id;
              }
            } catch {
              // Continue with null name
            }
          }

          // Build attendee list
          const attendees: Array<{ id: string; name: string; profile_url?: string }> = [];
          if (attendeeName || attendeeId) {
            attendees.push({
              id: attendeeId || "unknown",
              name: attendeeName || "Unknown",
            });
          }

          // For group chats, we need to fetch attendees
          if (chat.type !== 0 && attendees.length === 0) {
            try {
              const attendeesResponse = await getChatAttendees(opts, chat.id, { limit: 10 });
              for (const a of attendeesResponse.items) {
                if (a.is_self !== 1) {
                  attendees.push({
                    id: a.provider_id,
                    name: a.name || "Unknown",
                    profile_url: a.profile_url,
                  });
                }
              }
            } catch {
              // Continue with empty attendees
            }
          }

          // If name filter is provided, check if any attendee matches
          if (nameFilter) {
            const lowerFilter = nameFilter.toLowerCase();
            const matches = attendees.some((a) => a.name.toLowerCase().includes(lowerFilter));
            if (!matches) {
              continue;
            }
          }

          const isInmail =
            chat.content_type === "inmail" ||
            (chat.folder?.some((f) => f.includes("RECRUITER") || f.includes("SALES_NAVIGATOR")) ??
              false);

          conversations.push({
            chat_id: chat.id,
            attendees,
            last_message_at: chat.timestamp,
            unread_count: chat.unread_count,
            is_inmail: isInmail,
            subject: chat.subject ?? null,
            chat_type: chat.type === 0 ? "direct" : chat.type === 1 ? "group" : "channel",
          });
        }

        if (conversations.length === 0 && nameFilter) {
          return jsonResult({
            success: true,
            conversations: [],
            count: 0,
            message:
              `No conversations found matching "${nameFilter}". ` +
              "Try a different spelling or check if they were messaged from a different account.",
          });
        }

        // Format for display
        const formatted = conversations
          .map((c, i) => {
            const names = c.attendees.map((a) => a.name).join(", ");
            const inmail = c.is_inmail ? " (InMail)" : "";
            const unread = c.unread_count > 0 ? ` [${c.unread_count} unread]` : "";
            const subject = c.subject ? `\n   Subject: ${c.subject}` : "";
            return `${i + 1}. ${names}${inmail}${unread}\n   Chat ID: ${c.chat_id}${subject}`;
          })
          .join("\n\n");

        return jsonResult({
          success: true,
          conversations,
          count: conversations.length,
          formatted,
          instruction:
            "To read messages from a conversation, use linkedin_get_conversation_messages with the chat_id.",
        });
      } catch (err) {
        const classified = classifyLinkedInError(err);
        return jsonResult({
          success: false,
          error: classified.userFriendlyMessage,
          errorType: classified.type,
          canRetry: classified.isTransient,
        });
      }
    },
  };
}

// =============================================================================
// LinkedIn Get Conversation Messages Tool
// =============================================================================

const LinkedInGetConversationMessagesSchema = Type.Object({
  chat_id: Type.String({
    description: "The chat/conversation ID. Get this from linkedin_list_conversations results.",
  }),
  limit: Type.Optional(
    Type.Number({
      description: "Maximum number of messages to return. Default: 20, max: 50.",
      minimum: 1,
      maximum: 50,
    }),
  ),
  cursor: Type.Optional(
    Type.String({
      description: "Pagination cursor to fetch older messages.",
    }),
  ),
  account_id: Type.Optional(
    Type.String({
      description: "Account ID for multi-account setups.",
    }),
  ),
});

/**
 * Create the LinkedIn get conversation messages tool.
 * This tool retrieves messages from a specific LinkedIn conversation.
 */
export function createLinkedInGetConversationMessagesTool(options?: {
  config?: OpenClawConfig;
}): AnyAgentTool | null {
  const cfg = options?.config;

  const account = resolveLinkedInAccount({ cfg: cfg ?? ({} as OpenClawConfig) });
  if (!account.enabled) {
    return null;
  }

  return {
    label: "LinkedIn Get Conversation Messages",
    name: "linkedin_get_conversation_messages",
    description:
      "Get messages from a specific LinkedIn conversation. " +
      "Use linkedin_list_conversations first to find the chat_id. " +
      "Returns messages in reverse chronological order (newest first).",
    parameters: LinkedInGetConversationMessagesSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;

      const chatId = readStringParam(params, "chat_id");
      const limit = readNumberParam(params, "limit", { integer: true }) ?? 20;
      const cursor = readStringParam(params, "cursor");
      const accountId = readStringParam(params, "account_id");

      if (!chatId) {
        return jsonResult({
          success: false,
          error: "chat_id is required. Use linkedin_list_conversations to find the chat_id.",
        });
      }

      const resolvedAccount = accountId
        ? resolveLinkedInAccount({ cfg: cfg ?? ({} as OpenClawConfig), accountId })
        : account;

      const opts = buildClientOptions(resolvedAccount);
      if (!opts) {
        const missing = getMissingCredentials(resolvedAccount);
        return jsonResult({
          success: false,
          error: `LinkedIn is not configured. Missing: ${missing.join(", ")}`,
        });
      }

      try {
        // Fetch messages, attendees, and chat info in parallel
        const [messagesResponse, attendeesResponse, chatInfo] = await Promise.all([
          getMessages(opts, chatId, { limit, cursor }),
          getChatAttendees(opts, chatId, { limit: 20 }),
          getChat(opts, chatId).catch(() => null),
        ]);

        // Build attendee lookup map from getChatAttendees
        const attendeeMap = new Map<string, { name: string; profile_url?: string }>();
        for (const attendee of attendeesResponse.items) {
          attendeeMap.set(attendee.provider_id, {
            name: attendee.name || "Unknown",
            profile_url: attendee.profile_url,
          });
        }

        // Use chat.name as fallback for the other attendee's name (for DMs)
        // This supplements getChatAttendees for cases where name resolution fails
        const chatName = chatInfo?.name || null;
        const chatAttendeeProviderId = chatInfo?.attendee_provider_id || null;
        if (chatName && chatAttendeeProviderId) {
          const existing = attendeeMap.get(chatAttendeeProviderId);
          if (!existing || existing.name === "Unknown") {
            attendeeMap.set(chatAttendeeProviderId, {
              name: chatName,
              profile_url: existing?.profile_url,
            });
          }
        }

        // If all non-self attendees are "Unknown" but chat.name exists, apply to first non-self
        if (chatName) {
          for (const attendee of attendeesResponse.items) {
            if (attendee.is_self !== 1) {
              const entry = attendeeMap.get(attendee.provider_id);
              if (entry && entry.name === "Unknown") {
                entry.name = chatName;
              }
            }
          }
        }

        // Format messages
        const messages = messagesResponse.items.map((msg) => {
          const senderInfo = attendeeMap.get(msg.sender_id);
          return {
            id: msg.id,
            text: msg.text,
            sender_id: msg.sender_id,
            sender_name:
              senderInfo?.name ?? (msg.is_sender === 1 ? "You" : (chatName ?? "Unknown")),
            timestamp: msg.timestamp,
            is_sender: msg.is_sender === 1,
            message_type: msg.message_type ?? "MESSAGE",
            subject: msg.subject ?? null,
            has_attachments: msg.attachments?.length > 0,
          };
        });

        // Build attendee list (excluding self)
        const attendees = attendeesResponse.items
          .filter((a) => a.is_self !== 1)
          .map((a) => {
            const info = attendeeMap.get(a.provider_id);
            return {
              id: a.provider_id,
              name: info?.name || chatName || "Unknown",
              profile_url: info?.profile_url || a.profile_url,
            };
          });

        // Format for display
        const formatted = messages
          .map((m) => {
            const sender = m.is_sender ? "You" : m.sender_name;
            const date = new Date(m.timestamp).toLocaleString();
            const type = m.message_type !== "MESSAGE" ? ` [${m.message_type}]` : "";
            const subject = m.subject ? `\n   Subject: ${m.subject}` : "";
            return `[${date}] ${sender}${type}:${subject}\n   ${m.text || "(no text)"}`;
          })
          .join("\n\n");

        return jsonResult({
          success: true,
          chat_id: chatId,
          messages,
          attendees,
          count: messages.length,
          cursor: messagesResponse.cursor,
          has_more: messagesResponse.cursor !== null,
          formatted,
        });
      } catch (err) {
        const classified = classifyLinkedInError(err);
        return jsonResult({
          success: false,
          error: classified.userFriendlyMessage,
          errorType: classified.type,
          canRetry: classified.isTransient,
        });
      }
    },
  };
}
