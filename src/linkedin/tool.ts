/**
 * LinkedIn Talent Search Tool
 *
 * Agent tool for searching candidates on LinkedIn.
 */

import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../agents/tools/common.js";
import type { OpenClawConfig } from "../config/config.js";
import type { LinkedInPriority, LinkedInRoleScope } from "./types.js";
import { jsonResult, readNumberParam, readStringParam } from "../agents/tools/common.js";
import { resolveLinkedInAccount, buildClientOptions, getMissingCredentials } from "./accounts.js";
import { searchTalent, formatSearchResultsText } from "./search.js";

// Tool input schema
// Avoiding Type.Union per tool schema guardrails; using string enums instead
const LinkedInTalentSearchSchema = Type.Object({
  keywords: Type.Optional(
    Type.String({
      description: "General search keywords (e.g., 'AI Engineer', 'Python developer').",
    }),
  ),
  role: Type.Optional(
    Type.Array(
      Type.Object({
        keywords: Type.String({ description: "Job title or role keywords." }),
        priority: Type.Optional(
          Type.String({
            description: "Priority: MUST_HAVE, CAN_HAVE, or DOESNT_HAVE.",
          }),
        ),
        scope: Type.Optional(
          Type.String({
            description:
              "Scope: CURRENT_OR_PAST, CURRENT, PAST, PAST_NOT_CURRENT, or OPEN_TO_WORK.",
          }),
        ),
      }),
      { description: "Filter by job roles/titles." },
    ),
  ),
  skills: Type.Optional(
    Type.Array(
      Type.Object({
        keywords: Type.String({
          description: "Skill keywords (e.g., 'Python', 'Machine Learning').",
        }),
        priority: Type.Optional(
          Type.String({
            description: "Priority: MUST_HAVE, CAN_HAVE, or DOESNT_HAVE.",
          }),
        ),
      }),
      { description: "Filter by skills." },
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
  limit: Type.Optional(
    Type.Number({
      description: "Number of results to return (1-25). Default: 10.",
      minimum: 1,
      maximum: 25,
    }),
  ),
  use_recruiter: Type.Optional(
    Type.Boolean({
      description:
        "Use LinkedIn Recruiter API for advanced filtering (requires Recruiter subscription).",
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

function normalizeScope(value: unknown): LinkedInRoleScope | undefined {
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

function parseRoleArray(
  raw: unknown,
): Array<{ keywords: string; priority?: LinkedInPriority; scope?: LinkedInRoleScope }> | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const result: Array<{
    keywords: string;
    priority?: LinkedInPriority;
    scope?: LinkedInRoleScope;
  }> = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const keywords = typeof obj.keywords === "string" ? obj.keywords.trim() : "";
    if (!keywords) {
      continue;
    }
    result.push({
      keywords,
      priority: normalizePriority(obj.priority),
      scope: normalizeScope(obj.scope),
    });
  }
  return result.length > 0 ? result : undefined;
}

function parseSkillsArray(
  raw: unknown,
): Array<{ keywords: string; priority?: LinkedInPriority }> | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const result: Array<{ keywords: string; priority?: LinkedInPriority }> = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const keywords = typeof obj.keywords === "string" ? obj.keywords.trim() : "";
    if (!keywords) {
      continue;
    }
    result.push({
      keywords,
      priority: normalizePriority(obj.priority),
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

/**
 * Create the LinkedIn talent search tool.
 */
export function createLinkedInTalentSearchTool(options?: {
  config?: OpenClawConfig;
}): AnyAgentTool | null {
  const cfg = options?.config;

  // Check if LinkedIn is configured
  const account = resolveLinkedInAccount({ cfg: cfg ?? ({} as OpenClawConfig) });
  if (!account.enabled) {
    return null;
  }

  // Check if we have at least some configuration
  const clientOpts = buildClientOptions(account);
  if (!clientOpts) {
    // Still return the tool so agents know about it, but it will return config error
    // This allows users to see what's missing
  }

  return {
    label: "LinkedIn Talent Search",
    name: "linkedin_talent_search",
    description:
      "Search for candidates on LinkedIn by role, skills, location, and industry. " +
      "Use this tool to find potential hires, build candidate pipelines, or research talent in specific domains. " +
      "Supports filtering by job title, skills, location, industry, and network connections.",
    parameters: LinkedInTalentSearchSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;

      const keywords = readStringParam(params, "keywords");
      const location = readStringParam(params, "location");
      const industry = readStringParam(params, "industry");
      const limit = readNumberParam(params, "limit", { integer: true });
      const useRecruiter = params.use_recruiter === true;
      const accountId = readStringParam(params, "account_id");

      const role = parseRoleArray(params.role);
      const skills = parseSkillsArray(params.skills);
      const network_distance = parseNetworkDistance(params.network_distance);

      // Require at least one search parameter
      if (!keywords && !role?.length && !skills?.length && !location && !industry) {
        return jsonResult({
          success: false,
          error:
            "At least one search parameter is required (keywords, role, skills, location, or industry).",
          candidates: [],
        });
      }

      const result = await searchTalent(
        {
          keywords,
          role,
          skills,
          location,
          industry,
          network_distance,
          limit,
          useRecruiter,
          accountId,
        },
        cfg ?? ({} as OpenClawConfig),
      );

      // Return structured result with formatted text
      return jsonResult({
        ...result,
        formatted: formatSearchResultsText(result),
      });
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
