/**
 * LinkedIn Search Functions
 *
 * High-level search functions for talent discovery.
 */

import type { OpenClawConfig } from "../config/config.js";
import type {
  LinkedInClientOptions,
  LinkedInPeopleResult,
  LinkedInRecruiterSearchParams,
  LinkedInClassicPeopleSearchParams,
  LinkedInPriority,
  LinkedInRoleScope,
  LinkedInNetworkDistance,
} from "./types.js";
import { buildClientOptions, resolveLinkedInAccount, getMissingCredentials } from "./accounts.js";
import { searchLinkedIn, getSearchParameters } from "./client.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

export type TalentSearchParams = {
  /** General search keywords. */
  keywords?: string;
  /** Role/job title filters. */
  role?: Array<{
    keywords: string;
    priority?: LinkedInPriority;
    scope?: LinkedInRoleScope;
  }>;
  /** Skills filters. */
  skills?: Array<{
    keywords: string;
    priority?: LinkedInPriority;
  }>;
  /** Location filter (free text, will be included in keywords). */
  location?: string;
  /** Industry filter (free text, will be included in keywords). */
  industry?: string;
  /** Network distance filter (1, 2, or 3). */
  network_distance?: number[];
  /** Limit number of results. */
  limit?: number;
  /** Use recruiter API if available. */
  useRecruiter?: boolean;
  /** Account ID for multi-account setups. */
  accountId?: string;
};

export type TalentSearchResult = {
  success: boolean;
  candidates: FormattedCandidate[];
  total_count: number;
  page_count: number;
  cursor?: string;
  error?: string;
};

export type FormattedCandidate = {
  name: string;
  headline: string;
  location: string | null;
  network_distance: string;
  profile_url: string | null;
  skills: string[];
  current_company?: string;
  current_role?: string;
};

/**
 * Format network distance for display.
 */
function formatNetworkDistance(distance: LinkedInNetworkDistance): string {
  switch (distance) {
    case "SELF":
      return "You";
    case "DISTANCE_1":
      return "1st";
    case "DISTANCE_2":
      return "2nd";
    case "DISTANCE_3":
      return "3rd+";
    case "OUT_OF_NETWORK":
      return "Out of network";
    default:
      return distance;
  }
}

/**
 * Format a people search result for display.
 */
function formatCandidate(result: LinkedInPeopleResult): FormattedCandidate {
  const name =
    result.name || `${result.first_name || ""} ${result.last_name || ""}`.trim() || "Unknown";
  const skills = result.skills?.map((s) => s.name) ?? [];
  const currentPosition = result.current_positions?.[0];

  return {
    name,
    headline: result.headline || "",
    location: result.location,
    network_distance: formatNetworkDistance(result.network_distance),
    profile_url: result.public_profile_url || result.profile_url,
    skills,
    current_company: currentPosition?.company,
    current_role: currentPosition?.role,
  };
}

/**
 * Build a classic people search query.
 */
function buildClassicSearchQuery(params: TalentSearchParams): LinkedInClassicPeopleSearchParams {
  const query: LinkedInClassicPeopleSearchParams = {
    api: "classic",
    category: "people",
  };

  // Build keywords from various inputs
  const keywordParts: string[] = [];
  if (params.keywords) {
    keywordParts.push(params.keywords);
  }
  if (params.location) {
    keywordParts.push(params.location);
  }
  if (params.industry) {
    keywordParts.push(params.industry);
  }

  // Add role keywords
  if (params.role?.length) {
    for (const r of params.role) {
      keywordParts.push(r.keywords);
    }
  }

  // Add skill keywords
  if (params.skills?.length) {
    for (const s of params.skills) {
      keywordParts.push(s.keywords);
    }
  }

  if (keywordParts.length > 0) {
    query.keywords = keywordParts.join(" ");
  }

  // Network distance
  if (params.network_distance?.length) {
    query.network_distance = params.network_distance.filter(
      (d): d is 1 | 2 | 3 => d === 1 || d === 2 || d === 3,
    );
  }

  return query;
}

/**
 * Build a recruiter search query.
 */
function buildRecruiterSearchQuery(params: TalentSearchParams): LinkedInRecruiterSearchParams {
  const query: LinkedInRecruiterSearchParams = {
    api: "recruiter",
    category: "people",
  };

  // Set keywords
  if (params.keywords) {
    query.keywords = params.keywords;
  }

  // Add role filters
  if (params.role?.length) {
    query.role = params.role.map((r) => ({
      keywords: r.keywords,
      priority: r.priority,
      scope: r.scope,
    }));
  }

  // Add skill filters
  if (params.skills?.length) {
    query.skills = params.skills.map((s) => ({
      keywords: s.keywords,
      priority: s.priority,
    }));
  }

  // Network distance
  if (params.network_distance?.length) {
    query.network_distance = params.network_distance.filter(
      (d): d is 1 | 2 | 3 => d === 1 || d === 2 || d === 3,
    );
  }

  return query;
}

/**
 * Search for talent on LinkedIn.
 */
export async function searchTalent(
  params: TalentSearchParams,
  cfg: OpenClawConfig,
): Promise<TalentSearchResult> {
  // Resolve account
  const account = resolveLinkedInAccount({ cfg, accountId: params.accountId });

  if (!account.enabled) {
    return {
      success: false,
      candidates: [],
      total_count: 0,
      page_count: 0,
      error: "LinkedIn integration is disabled.",
    };
  }

  const clientOpts = buildClientOptions(account);
  if (!clientOpts) {
    const missing = getMissingCredentials(account);
    return {
      success: false,
      candidates: [],
      total_count: 0,
      page_count: 0,
      error: `LinkedIn credentials missing: ${missing.join(", ")}. Configure in openclaw.yml under channels.linkedin or set UNIPILE_* environment variables.`,
    };
  }

  // Build search query
  const searchQuery = params.useRecruiter
    ? buildRecruiterSearchQuery(params)
    : buildClassicSearchQuery(params);

  const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  try {
    const response = await searchLinkedIn(searchQuery, clientOpts, { limit });

    // Filter to people results only
    const peopleResults = response.items.filter(
      (item): item is LinkedInPeopleResult => item.type === "PEOPLE",
    );

    const candidates = peopleResults.map(formatCandidate);

    return {
      success: true,
      candidates,
      total_count: response.paging.total_count,
      page_count: response.paging.page_count,
      cursor: response.cursor ?? undefined,
    };
  } catch (err) {
    return {
      success: false,
      candidates: [],
      total_count: 0,
      page_count: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Get search parameter IDs for skills, locations, etc.
 * Useful for advanced searches requiring specific IDs.
 */
export async function lookupSearchParameter(
  type: "SKILL" | "LOCATION" | "COMPANY" | "INDUSTRY" | "JOB_TITLE" | "SCHOOL",
  keywords: string,
  clientOpts: LinkedInClientOptions,
  limit = 5,
): Promise<Array<{ id: string; title: string }>> {
  try {
    const response = await getSearchParameters(clientOpts, {
      type,
      keywords,
      limit,
    });
    return response.items.map((item) => ({
      id: item.id,
      title: item.title,
    }));
  } catch {
    return [];
  }
}

/**
 * Format search results for text output.
 */
export function formatSearchResultsText(result: TalentSearchResult): string {
  if (!result.success) {
    return `Search failed: ${result.error}`;
  }

  if (result.candidates.length === 0) {
    return "No candidates found matching your criteria.";
  }

  const lines: string[] = [
    `Found ${result.total_count} candidates (showing ${result.candidates.length}):`,
    "",
  ];

  for (let i = 0; i < result.candidates.length; i++) {
    const c = result.candidates[i];
    const num = i + 1;
    const roleInfo =
      c.current_role && c.current_company
        ? ` - ${c.current_role} at ${c.current_company}`
        : c.headline
          ? ` - ${c.headline}`
          : "";

    lines.push(`${num}. **${c.name}**${roleInfo}`);

    const details: string[] = [];
    if (c.location) {
      details.push(`Location: ${c.location}`);
    }
    details.push(`Network: ${c.network_distance}`);
    if (details.length > 0) {
      lines.push(`   ${details.join(" | ")}`);
    }

    if (c.skills.length > 0) {
      lines.push(`   Skills: ${c.skills.slice(0, 5).join(", ")}`);
    }

    if (c.profile_url) {
      lines.push(`   Profile: ${c.profile_url}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}
