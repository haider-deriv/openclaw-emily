/**
 * Talently Agent Tool
 *
 * Agent tool for answering recruitment questions, querying analytics,
 * and candidate information via the Talently agent.
 */

import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../agents/tools/common.js";
import type { OpenClawConfig } from "../config/config.js";
import { jsonResult, readStringParam } from "../agents/tools/common.js";

const DEFAULT_TIMEOUT_MS = 60_000;

const TalentlySchema = Type.Object({
  query: Type.String({
    description:
      "The question to ask about recruitment analytics or candidates. " +
      "Examples: 'What is the pipeline conversion rate?', 'Find candidates named John', " +
      "'Show me the top 10 candidates', 'Compare John Smith and Jane Doe'",
  }),
  session_id: Type.Optional(
    Type.String({
      description: "Optional session ID for conversation continuity across multiple queries",
    }),
  ),
});

interface TalentlyConfig {
  enabled?: boolean;
  agentUrl?: string;
  timeoutMs?: number;
}

function resolveTalentlyConfig(config?: OpenClawConfig): {
  enabled: boolean;
  agentUrl?: string;
  timeoutMs: number;
} {
  const talentlyCfg = (config?.tools as { talentlyAgent?: TalentlyConfig } | undefined)
    ?.talentlyAgent;
  const enabled = talentlyCfg?.enabled !== false;
  const agentUrl = talentlyCfg?.agentUrl || process.env.TALENTLY_AGENT_URL;
  const timeoutMs = talentlyCfg?.timeoutMs || DEFAULT_TIMEOUT_MS;
  return { enabled, agentUrl, timeoutMs };
}

/**
 * Create the Talently Agent tool.
 *
 * Requires TALENTLY_AGENT_URL environment variable or tools.talentlyAgent.agentUrl config.
 */
export function createTalentlyTool(options?: { config?: OpenClawConfig }): AnyAgentTool | null {
  const resolved = resolveTalentlyConfig(options?.config);

  if (!resolved.enabled || !resolved.agentUrl) {
    return null;
  }

  return {
    label: "Talently Agent",
    name: "talently_agent",
    description:
      "Query the Talently HR agent for recruitment analytics and candidate information. " +
      "Capabilities: pipeline conversion rates, tier distribution, source effectiveness, " +
      "time-to-hire metrics, candidate search, evaluation details, candidate comparisons, " +
      "top candidates ranking. Use natural language questions.",
    parameters: TalentlySchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });
      const sessionId = readStringParam(params, "session_id");

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), resolved.timeoutMs);

      try {
        const res = await fetch(`${resolved.agentUrl}/api/query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query,
            session_id: sessionId,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errorText = await res.text().catch(() => "Unknown error");
          return jsonResult({
            success: false,
            error: `Talently agent error (${res.status}): ${errorText}`,
          });
        }

        const result = (await res.json()) as Record<string, unknown>;
        return jsonResult({
          success: true,
          ...result,
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return jsonResult({
            success: false,
            error: `Talently agent request timed out after ${resolved.timeoutMs}ms`,
          });
        }
        return jsonResult({
          success: false,
          error: `Talently agent request failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
