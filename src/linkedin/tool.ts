/**
 * LinkedIn Talent Search Tool
 *
 * Agent tool for searching candidates on LinkedIn.
 */

import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../agents/tools/common.js";
import type { OpenClawConfig } from "../config/config.js";
import type { LinkedInCompanyScope, LinkedInPriority, LinkedInRoleScope } from "./types.js";
import { optionalStringEnum, stringEnum } from "../agents/schema/typebox.js";
import {
  jsonResult,
  readNumberParam,
  readStringArrayParam,
  readStringParam,
} from "../agents/tools/common.js";
import { resolveLinkedInAccount, buildClientOptions, getMissingCredentials } from "./accounts.js";
import {
  listConnections,
  startChat,
  classifyLinkedInError,
  getUserProfile,
  getUserPosts,
  getUserComments,
  getUserReactions,
  type LinkedInConnection,
} from "./client.js";
import { searchTalent, formatSearchResultsText } from "./search.js";

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
