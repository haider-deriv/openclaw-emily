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
  LinkedInCompanyScope,
  LinkedInNetworkDistance,
  LinkedInSalesNavigatorSearchParams,
  LinkedInSearchRequestBody,
} from "./types.js";
import { buildClientOptions, resolveLinkedInAccount, getMissingCredentials } from "./accounts.js";
import { searchLinkedIn, getSearchParameters } from "./client.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 3;
const MAX_MAX_PAGES = 20;

export type TalentSearchApi = "classic" | "recruiter" | "sales_navigator";

export type TalentSearchParams = {
  /** API mode for search (classic, recruiter, or sales_navigator). */
  api?: TalentSearchApi;
  /** General search keywords. */
  keywords?: string;
  /** Role/job title filters. */
  role?: Array<{
    keywords?: string;
    id?: string;
    is_selection?: boolean;
    priority?: LinkedInPriority;
    scope?: LinkedInRoleScope;
  }>;
  /** Skills filters. */
  skills?: Array<{
    keywords?: string;
    id?: string;
    priority?: LinkedInPriority;
  }>;
  /** Company filters. */
  company?: Array<{
    keywords?: string;
    id?: string;
    name?: string;
    priority?: LinkedInPriority;
    scope?: LinkedInCompanyScope;
  }>;
  /** Location filter (free text, will be included in keywords). */
  location?: string;
  /** Industry filter (free text, will be included in keywords). */
  industry?: string;
  /** Network distance filter (1, 2, or 3). */
  network_distance?: number[];
  /** Recruiter spotlights. */
  spotlights?: Array<
    | "OPEN_TO_WORK"
    | "ACTIVE_TALENT"
    | "REDISCOVERED_CANDIDATES"
    | "INTERNAL_CANDIDATES"
    | "INTERESTED_IN_YOUR_COMPANY"
    | "HAVE_COMPANY_CONNECTIONS"
  >;
  /** Recruiter tenure filter in months. */
  tenure?: {
    min?: number;
    max?: number;
  };
  /** Recruiter seniority include/exclude. */
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
  /** Limit number of results (legacy behavior). */
  limit?: number;
  /** Legacy switch for recruiter mode. */
  useRecruiter?: boolean;
  /** New paging controls. */
  page_size?: number;
  max_pages?: number;
  cursor?: string;
  /** Account ID for multi-account setups. */
  accountId?: string;
};

export type TalentSearchResult = {
  success: boolean;
  candidates: FormattedCandidate[];
  total_count: number;
  page_count: number;
  cursor?: string;
  search?: {
    api: TalentSearchApi;
    page_size?: number;
    max_pages?: number;
    pages_fetched: number;
    used_cursor: boolean;
  };
  error?: string;
};

export type FormattedCandidate = {
  provider_id: string;
  public_identifier: string | null;
  public_profile_url: string | null;
  profile_url: string | null;
  name: string;
  headline: string;
  location: string | null;
  network_distance: string;
  network_distance_raw: LinkedInNetworkDistance;
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

function clampInteger(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  const intValue = Math.trunc(value);
  return Math.min(max, Math.max(min, intValue));
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
    provider_id: result.id,
    public_identifier: result.public_identifier,
    public_profile_url: result.public_profile_url,
    profile_url: result.public_profile_url || result.profile_url,
    name,
    headline: result.headline || "",
    location: result.location,
    network_distance: formatNetworkDistance(result.network_distance),
    network_distance_raw: result.network_distance,
    skills,
    current_company: currentPosition?.company,
    current_role: currentPosition?.role,
  };
}

function buildSearchKeywords(params: TalentSearchParams): string | undefined {
  const parts: string[] = [];
  if (params.keywords) {
    parts.push(params.keywords);
  }
  if (params.location) {
    parts.push(params.location);
  }
  if (params.industry) {
    parts.push(params.industry);
  }
  for (const r of params.role ?? []) {
    if (r.keywords?.trim()) {
      parts.push(r.keywords);
    }
  }
  for (const s of params.skills ?? []) {
    if (s.keywords?.trim()) {
      parts.push(s.keywords);
    }
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/**
 * Build a classic people search query.
 */
function buildClassicSearchQuery(params: TalentSearchParams): LinkedInClassicPeopleSearchParams {
  const query: LinkedInClassicPeopleSearchParams = {
    api: "classic",
    category: "people",
  };

  const keywords = buildSearchKeywords(params);
  if (keywords) {
    query.keywords = keywords;
  }

  if (params.network_distance?.length) {
    query.network_distance = params.network_distance.filter(
      (d): d is 1 | 2 | 3 => d === 1 || d === 2 || d === 3,
    );
  }

  return query;
}

/**
 * Build a recruiter/sales navigator search query.
 */
function buildRecruiterSearchQuery(
  params: TalentSearchParams,
  api: "recruiter" | "sales_navigator",
): LinkedInRecruiterSearchParams | LinkedInSalesNavigatorSearchParams {
  const query: LinkedInRecruiterSearchParams | LinkedInSalesNavigatorSearchParams = {
    api,
    category: "people",
  };

  const keywords = buildSearchKeywords(params);
  if (keywords) {
    query.keywords = keywords;
  }

  if (params.role?.length) {
    query.role = params.role
      .map((r) => ({
        keywords: r.keywords,
        id: r.id,
        is_selection: r.is_selection,
        priority: r.priority,
        scope: r.scope,
      }))
      .filter((item) => Boolean(item.keywords || item.id));
  }

  if (params.skills?.length) {
    query.skills = params.skills
      .map((s) => ({
        keywords: s.keywords,
        id: s.id,
        priority: s.priority,
      }))
      .filter((item) => Boolean(item.keywords || item.id));
  }

  if (params.company?.length) {
    query.company = params.company
      .map((c) => ({
        keywords: c.keywords,
        id: c.id,
        name: c.name,
        priority: c.priority,
        scope: c.scope,
      }))
      .filter((item) => Boolean(item.keywords || item.id || item.name));
  }

  if (params.network_distance?.length) {
    query.network_distance = params.network_distance.filter(
      (d): d is 1 | 2 | 3 => d === 1 || d === 2 || d === 3,
    );
  }

  if (params.spotlights?.length) {
    query.spotlights = params.spotlights;
  }

  if (params.tenure && (params.tenure.min !== undefined || params.tenure.max !== undefined)) {
    query.tenure = {
      min: params.tenure.min,
      max: params.tenure.max,
    };
  }

  if (params.seniority && (params.seniority.include?.length || params.seniority.exclude?.length)) {
    query.seniority = {
      include: params.seniority.include,
      exclude: params.seniority.exclude,
    };
  }

  return query;
}

function dedupePeopleResults(items: LinkedInPeopleResult[]): LinkedInPeopleResult[] {
  const seen = new Set<string>();
  const deduped: LinkedInPeopleResult[] = [];
  for (const item of items) {
    const key =
      item.id ||
      item.public_identifier ||
      item.public_profile_url ||
      item.profile_url ||
      `${item.name || "unknown"}:${item.headline || ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function buildSearchRequest(params: TalentSearchParams): {
  api: TalentSearchApi;
  query: LinkedInSearchRequestBody;
} {
  const api: TalentSearchApi = params.api ?? (params.useRecruiter ? "recruiter" : "classic");
  if (api === "classic") {
    return { api, query: buildClassicSearchQuery(params) };
  }
  return {
    api,
    query: buildRecruiterSearchQuery(params, api),
  };
}

/**
 * Search for talent on LinkedIn.
 */
export async function searchTalent(
  params: TalentSearchParams,
  cfg: OpenClawConfig,
): Promise<TalentSearchResult> {
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

  const { api, query } = buildSearchRequest(params);

  const usingPagingControls =
    params.page_size !== undefined || params.max_pages !== undefined || params.cursor !== undefined;

  const requestedLimit = clampInteger(params.limit, 1, MAX_LIMIT, DEFAULT_LIMIT);

  try {
    if (!usingPagingControls) {
      const response = await searchLinkedIn(query, clientOpts, { limit: requestedLimit });
      const peopleResults = response.items.filter(
        (item): item is LinkedInPeopleResult => item.type === "PEOPLE",
      );
      const candidates = dedupePeopleResults(peopleResults).map(formatCandidate);

      return {
        success: true,
        candidates,
        total_count: response.paging.total_count,
        page_count: response.paging.page_count,
        cursor: response.cursor ?? undefined,
        search: {
          api,
          pages_fetched: 1,
          used_cursor: false,
        },
      };
    }

    const pageSize = clampInteger(params.page_size, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
    const maxPages = clampInteger(params.max_pages, 1, MAX_MAX_PAGES, DEFAULT_MAX_PAGES);
    const resultLimit =
      params.limit !== undefined ? Math.max(1, Math.trunc(params.limit)) : undefined;

    let cursor = params.cursor;
    let pagesFetched = 0;
    let totalCount = 0;
    let pageCount = 0;
    const allPeople: LinkedInPeopleResult[] = [];

    while (pagesFetched < maxPages) {
      const response = await searchLinkedIn(query, clientOpts, {
        limit: pageSize,
        cursor,
      });
      pagesFetched += 1;
      totalCount = Math.max(totalCount, response.paging.total_count);
      pageCount += response.paging.page_count;

      const pagePeople = response.items.filter(
        (item): item is LinkedInPeopleResult => item.type === "PEOPLE",
      );
      allPeople.push(...pagePeople);

      if (resultLimit !== undefined && dedupePeopleResults(allPeople).length >= resultLimit) {
        cursor = response.cursor ?? undefined;
        break;
      }

      if (!response.cursor || response.cursor === cursor) {
        cursor = undefined;
        break;
      }

      cursor = response.cursor;
    }

    const dedupedPeople = dedupePeopleResults(allPeople);
    const finalPeople =
      resultLimit !== undefined ? dedupedPeople.slice(0, resultLimit) : dedupedPeople;

    return {
      success: true,
      candidates: finalPeople.map(formatCandidate),
      total_count: totalCount,
      page_count: pageCount,
      cursor,
      search: {
        api,
        page_size: pageSize,
        max_pages: maxPages,
        pages_fetched: pagesFetched,
        used_cursor: Boolean(params.cursor),
      },
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

    lines.push(
      `   IDs: provider_id=${c.provider_id}, public_identifier=${c.public_identifier || "n/a"}`,
    );
    lines.push("");
  }

  return lines.join("\n");
}
