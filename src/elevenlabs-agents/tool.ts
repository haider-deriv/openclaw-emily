/**
 * ElevenLabs Agents Tool
 *
 * Agent tool for making outbound calls via ElevenLabs Conversational AI.
 */

import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../agents/tools/common.js";
import type { OpenClawConfig } from "../config/config.js";
import { jsonResult, readNumberParam, readStringParam } from "../agents/tools/common.js";
import {
  buildClientOptions,
  initiateOutboundCall,
  getConversation,
  listConversations,
  pollUntilDone,
  classifyElevenLabsError,
  type ElevenLabsClientOptions,
} from "./client.js";
import {
  resolveElevenLabsAgentsConfig,
  getMissingCredentials,
  type ResolvedElevenLabsAgentsConfig,
} from "./config.js";
import {
  saveConversation,
  getStoredConversation,
  listStoredConversations,
  createInitialStoredConversation,
  updateConversationFromApi,
} from "./store.js";

// =============================================================================
// Tool Schema
// =============================================================================

// Using a single object with action field (avoiding Type.Union per codebase convention)
const ElevenLabsAgentsSchema = Type.Object({
  action: Type.String({
    description:
      'Action to perform: "initiate_call", "get_conversation", "list_conversations", or "poll_until_done"',
  }),
  // initiate_call params
  to_number: Type.Optional(
    Type.String({
      description: "Phone number to call (E.164 format, e.g., +1234567890)",
    }),
  ),
  dynamic_variables: Type.Optional(
    Type.Object(
      {
        candidate_name: Type.Optional(
          Type.String({
            description: "Name of the candidate being called (required for calls)",
          }),
        ),
        position: Type.Optional(
          Type.String({
            description: "Job position being discussed",
          }),
        ),
        company: Type.Optional(
          Type.String({
            description: "Company name",
          }),
        ),
        key_requirements: Type.Optional(
          Type.String({
            description: "Key job requirements to discuss",
          }),
        ),
        questions_to_ask: Type.Optional(
          Type.String({
            description: "Specific questions to ask during the call",
          }),
        ),
      },
      {
        description:
          "Dynamic variables to customize the agent's context. candidate_name is required for initiating calls.",
      },
    ),
  ),
  // get_conversation / poll_until_done params
  conversation_id: Type.Optional(
    Type.String({
      description: "Conversation ID to retrieve or poll",
    }),
  ),
  // list_conversations params
  limit: Type.Optional(
    Type.Number({
      description: "Maximum number of conversations to return (default: 10)",
      minimum: 1,
      maximum: 100,
    }),
  ),
  status: Type.Optional(
    Type.String({
      description: 'Filter by status (e.g., "done", "pending", "in-progress")',
    }),
  ),
  // poll_until_done params
  timeout_seconds: Type.Optional(
    Type.Number({
      description: "Maximum time to wait for call completion (default: 300)",
      minimum: 10,
      maximum: 600,
    }),
  ),
  poll_interval_seconds: Type.Optional(
    Type.Number({
      description: "Seconds between status checks (default: 10)",
      minimum: 5,
      maximum: 60,
    }),
  ),
});

// =============================================================================
// Action Handlers
// =============================================================================

async function handleInitiateCall(params: {
  clientOpts: ElevenLabsClientOptions;
  resolvedConfig: ResolvedElevenLabsAgentsConfig;
  workspaceDir: string;
  toNumber?: string;
  dynamicVariables?: Record<string, string>;
}) {
  const { clientOpts, resolvedConfig, workspaceDir, toNumber, dynamicVariables } = params;

  if (!toNumber) {
    return jsonResult({
      success: false,
      error: "to_number is required for initiate_call action",
    });
  }

  if (!resolvedConfig.agentId || !resolvedConfig.phoneNumberId) {
    const missing = getMissingCredentials(resolvedConfig);
    return jsonResult({
      success: false,
      error: `ElevenLabs Agents not fully configured. Missing: ${missing.join(", ")}`,
    });
  }

  try {
    // Merge default dynamic variables with provided ones
    const mergedVariables = {
      ...resolvedConfig.defaultDynamicVariables,
      ...dynamicVariables,
    };

    // Validate required variables
    if (!mergedVariables.candidate_name?.trim()) {
      return jsonResult({
        success: false,
        error: "candidate_name is required in dynamic_variables",
      });
    }

    const response = await initiateOutboundCall(clientOpts, {
      agentId: resolvedConfig.agentId,
      phoneNumberId: resolvedConfig.phoneNumberId,
      toNumber,
      dynamicVariables: Object.keys(mergedVariables).length > 0 ? mergedVariables : undefined,
    });

    // Save initial conversation record
    const storedConversation = createInitialStoredConversation({
      conversationId: response.conversation_id,
      toNumber,
      dynamicVariables: mergedVariables,
    });
    await saveConversation(workspaceDir, storedConversation);

    return jsonResult({
      success: true,
      conversation_id: response.conversation_id,
      status: response.status ?? "initiated",
      to_number: toNumber,
      message: `Call initiated to ${toNumber}. Use get_conversation or poll_until_done with conversation_id "${response.conversation_id}" to check results.`,
    });
  } catch (err) {
    const classified = classifyElevenLabsError(err);
    return jsonResult({
      success: false,
      error: classified.userFriendlyMessage,
      errorType: classified.type,
      canRetry: classified.isTransient,
    });
  }
}

async function handleGetConversation(params: {
  clientOpts: ElevenLabsClientOptions;
  workspaceDir: string;
  conversationId?: string;
}) {
  const { clientOpts, workspaceDir, conversationId } = params;

  if (!conversationId) {
    return jsonResult({
      success: false,
      error: "conversation_id is required for get_conversation action",
    });
  }

  try {
    // Fetch fresh data from API
    const details = await getConversation(clientOpts, conversationId);

    // Update stored conversation
    const stored = await updateConversationFromApi(workspaceDir, details);

    return jsonResult({
      success: true,
      conversation: stored,
    });
  } catch (err) {
    const classified = classifyElevenLabsError(err);

    // If not found in API, try to return stored version
    if (classified.type === "not_found") {
      const stored = await getStoredConversation(workspaceDir, conversationId);
      if (stored) {
        return jsonResult({
          success: true,
          conversation: stored,
          note: "Returned from local storage (not found in ElevenLabs API)",
        });
      }
    }

    return jsonResult({
      success: false,
      error: classified.userFriendlyMessage,
      errorType: classified.type,
      canRetry: classified.isTransient,
    });
  }
}

async function handleListConversations(params: {
  workspaceDir: string;
  limit?: number;
  status?: string;
}) {
  const { workspaceDir, limit, status } = params;

  try {
    const conversations = await listStoredConversations(workspaceDir, {
      limit: limit ?? 10,
      status,
    });

    return jsonResult({
      success: true,
      conversations,
      count: conversations.length,
    });
  } catch (err) {
    return jsonResult({
      success: false,
      error: `Failed to list conversations: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

async function handlePollUntilDone(params: {
  clientOpts: ElevenLabsClientOptions;
  workspaceDir: string;
  conversationId?: string;
  timeoutSeconds?: number;
  pollIntervalSeconds?: number;
}) {
  const { clientOpts, workspaceDir, conversationId, timeoutSeconds, pollIntervalSeconds } = params;

  if (!conversationId) {
    return jsonResult({
      success: false,
      error: "conversation_id is required for poll_until_done action",
    });
  }

  try {
    const result = await pollUntilDone(clientOpts, conversationId, {
      timeoutSeconds: timeoutSeconds ?? 300,
      pollIntervalSeconds: pollIntervalSeconds ?? 10,
    });

    // Update stored conversation with final state
    const stored = await updateConversationFromApi(workspaceDir, result.details);

    const isDone = result.details.status === "done";
    const message = isDone
      ? `Call completed after ${result.elapsedSeconds}s (${result.pollCount} polls)`
      : `Polling timed out after ${result.elapsedSeconds}s. Status: ${result.details.status}`;

    return jsonResult({
      success: isDone,
      conversation: stored,
      poll_count: result.pollCount,
      elapsed_seconds: result.elapsedSeconds,
      message,
    });
  } catch (err) {
    const classified = classifyElevenLabsError(err);
    return jsonResult({
      success: false,
      error: classified.userFriendlyMessage,
      errorType: classified.type,
      canRetry: classified.isTransient,
    });
  }
}

// =============================================================================
// Tool Factory
// =============================================================================

/**
 * Create the ElevenLabs Agents tool.
 */
export function createElevenLabsAgentsTool(options?: {
  config?: OpenClawConfig;
  workspaceDir?: string;
}): AnyAgentTool | null {
  const cfg = options?.config;
  const resolvedConfig = resolveElevenLabsAgentsConfig(cfg ?? ({} as OpenClawConfig));

  // Return null if explicitly disabled
  if (!resolvedConfig.enabled) {
    return null;
  }

  // Build client options (may be undefined if missing credentials)
  const clientOpts = buildClientOptions(resolvedConfig);

  // Get workspace directory (fallback to cwd)
  const workspaceDir = options?.workspaceDir ?? process.cwd();

  return {
    label: "ElevenLabs Agents",
    name: "elevenlabs_agents",
    description:
      "Make outbound phone calls using ElevenLabs Conversational AI agents. " +
      "Actions: initiate_call (start a call), get_conversation (get call status/transcript), " +
      "list_conversations (list stored calls), poll_until_done (wait for call completion). " +
      "Pass dynamic_variables to customize the agent's context (e.g., candidate_name, position).",
    parameters: ElevenLabsAgentsSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      // Check if client is configured
      if (!clientOpts) {
        const missing = getMissingCredentials(resolvedConfig);
        return jsonResult({
          success: false,
          error: `ElevenLabs Agents not configured. Missing: ${missing.join(", ")}`,
          configuration_help:
            "Set apiKey in tools.elevenlabsAgents or ELEVENLABS_API_KEY env var. " +
            "Also set agentId (ELEVENLABS_AGENT_ID) and phoneNumberId (ELEVENLABS_PHONE_NUMBER_ID).",
        });
      }

      // Parse dynamic_variables
      let dynamicVariables: Record<string, string> | undefined;
      const rawDynVars = params.dynamic_variables;
      if (rawDynVars && typeof rawDynVars === "object" && !Array.isArray(rawDynVars)) {
        dynamicVariables = {};
        for (const [key, value] of Object.entries(rawDynVars)) {
          if (typeof value === "string") {
            dynamicVariables[key] = value;
          } else if (value !== null && value !== undefined) {
            dynamicVariables[key] = String(value);
          }
        }
      }

      switch (action) {
        case "initiate_call":
          return handleInitiateCall({
            clientOpts,
            resolvedConfig,
            workspaceDir,
            toNumber: readStringParam(params, "to_number"),
            dynamicVariables,
          });

        case "get_conversation":
          return handleGetConversation({
            clientOpts,
            workspaceDir,
            conversationId: readStringParam(params, "conversation_id"),
          });

        case "list_conversations":
          return handleListConversations({
            workspaceDir,
            limit: readNumberParam(params, "limit", { integer: true }),
            status: readStringParam(params, "status"),
          });

        case "poll_until_done":
          return handlePollUntilDone({
            clientOpts,
            workspaceDir,
            conversationId: readStringParam(params, "conversation_id"),
            timeoutSeconds: readNumberParam(params, "timeout_seconds", { integer: true }),
            pollIntervalSeconds: readNumberParam(params, "poll_interval_seconds", {
              integer: true,
            }),
          });

        default:
          return jsonResult({
            success: false,
            error: `Unknown action: ${action}. Valid actions: initiate_call, get_conversation, list_conversations, poll_until_done`,
          });
      }
    },
  };
}
