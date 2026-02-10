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
import {
  listConnections,
  startChat,
  classifyLinkedInError,
  type LinkedInConnection,
} from "./client.js";
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

  const clientOpts = buildClientOptions(account);

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

      // Resolve account for this request
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
        // Search connections by name
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

        // If confirm_id is provided, find that specific connection
        if (confirmId) {
          const confirmed = matches.find((c) => c.member_id === confirmId);
          if (!confirmed) {
            return jsonResult({
              success: false,
              error: `Connection with ID "${confirmId}" not found in search results.`,
              matches: matches.map((c, i) => formatConnection(c, i)),
            });
          }

          // Send message to the confirmed connection
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

        // If exactly one match, send directly
        if (matches.length === 1) {
          const recipient = matches[0]!;

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

        // Multiple matches - return list for confirmation
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
