import type { Server as HttpServer } from "node:http";
import { WebSocketServer } from "ws";
import type { CliDeps } from "../cli/deps.js";
import type { createSubsystemLogger } from "../logging/subsystem.js";
import type { PluginRegistry } from "../plugins/registry.js";
import type { RuntimeEnv } from "../runtime.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import type { ResolvedGatewayAuth } from "./auth.js";
import type { ChatAbortControllerEntry } from "./chat-abort.js";
import type { ControlUiRootState } from "./control-ui.js";
import type { HooksConfigResolved } from "./hooks.js";
import type { DedupeEntry } from "./server-shared.js";
import type { GatewayTlsRuntime } from "./server/tls.js";
import type { GatewayWsClient } from "./server/ws-types.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { CANVAS_HOST_PATH } from "../canvas-host/a2ui.js";
import { type CanvasHostHandler, createCanvasHostHandler } from "../canvas-host/server.js";
import { resolveMainSessionKeyFromConfig } from "../config/sessions.js";
import { DirectCallFunctionName } from "../cron/types.js";
import { resolveElevenLabsAgentsConfig } from "../elevenlabs-agents/config.js";
import {
  parseEmailTemplateType,
  resolveGogEnv,
  sendInterviewInvite,
} from "../elevenlabs-agents/google-calendar.js";
import { getStoredConversation, saveConversationFromWebhook } from "../elevenlabs-agents/store.js";
import { registerElevenLabsWebhookHandler } from "../elevenlabs-agents/webhook.js";
import { requestHeartbeatNow } from "../infra/heartbeat-wake.js";
import { enqueueSystemEvent } from "../infra/system-events.js";
import { resolveGatewayListenHosts } from "./net.js";
import {
  createGatewayBroadcaster,
  type GatewayBroadcastFn,
  type GatewayBroadcastToConnIdsFn,
} from "./server-broadcast.js";
import {
  type ChatRunEntry,
  createChatRunState,
  createToolEventRecipientRegistry,
} from "./server-chat.js";
import { MAX_PAYLOAD_BYTES } from "./server-constants.js";
import { attachGatewayUpgradeHandler, createGatewayHttpServer } from "./server-http.js";
import { createGatewayHooksRequestHandler } from "./server/hooks.js";
import { listenGatewayHttpServer } from "./server/http-listen.js";
import { createGatewayPluginRequestHandler } from "./server/plugins-http.js";

export async function createGatewayRuntimeState(params: {
  cfg: import("../config/config.js").OpenClawConfig;
  bindHost: string;
  port: number;
  controlUiEnabled: boolean;
  controlUiBasePath: string;
  controlUiRoot?: ControlUiRootState;
  openAiChatCompletionsEnabled: boolean;
  openResponsesEnabled: boolean;
  openResponsesConfig?: import("../config/types.gateway.js").GatewayHttpResponsesConfig;
  resolvedAuth: ResolvedGatewayAuth;
  /** Optional rate limiter for auth brute-force protection. */
  rateLimiter?: AuthRateLimiter;
  gatewayTls?: GatewayTlsRuntime;
  hooksConfig: () => HooksConfigResolved | null;
  pluginRegistry: PluginRegistry;
  deps: CliDeps;
  canvasRuntime: RuntimeEnv;
  canvasHostEnabled: boolean;
  allowCanvasHostInTests?: boolean;
  logCanvas: { info: (msg: string) => void; warn: (msg: string) => void };
  log: { info: (msg: string) => void; warn: (msg: string) => void };
  logHooks: ReturnType<typeof createSubsystemLogger>;
  logPlugins: ReturnType<typeof createSubsystemLogger>;
  /** Callback to get the cron service (set after this function returns) */
  getCron?: () => import("../cron/service.js").CronService | null;
}): Promise<{
  canvasHost: CanvasHostHandler | null;
  httpServer: HttpServer;
  httpServers: HttpServer[];
  httpBindHosts: string[];
  wss: WebSocketServer;
  clients: Set<GatewayWsClient>;
  broadcast: GatewayBroadcastFn;
  broadcastToConnIds: GatewayBroadcastToConnIdsFn;
  agentRunSeq: Map<string, number>;
  dedupe: Map<string, DedupeEntry>;
  chatRunState: ReturnType<typeof createChatRunState>;
  chatRunBuffers: Map<string, string>;
  chatDeltaSentAt: Map<string, number>;
  addChatRun: (sessionId: string, entry: ChatRunEntry) => void;
  removeChatRun: (
    sessionId: string,
    clientRunId: string,
    sessionKey?: string,
  ) => ChatRunEntry | undefined;
  chatAbortControllers: Map<string, ChatAbortControllerEntry>;
  toolEventRecipients: ReturnType<typeof createToolEventRecipientRegistry>;
}> {
  let canvasHost: CanvasHostHandler | null = null;
  if (params.canvasHostEnabled) {
    try {
      const handler = await createCanvasHostHandler({
        runtime: params.canvasRuntime,
        rootDir: params.cfg.canvasHost?.root,
        basePath: CANVAS_HOST_PATH,
        allowInTests: params.allowCanvasHostInTests,
        liveReload: params.cfg.canvasHost?.liveReload,
      });
      if (handler.rootDir) {
        canvasHost = handler;
        params.logCanvas.info(
          `canvas host mounted at http://${params.bindHost}:${params.port}${CANVAS_HOST_PATH}/ (root ${handler.rootDir})`,
        );
      }
    } catch (err) {
      params.logCanvas.warn(`canvas host failed to start: ${String(err)}`);
    }
  }

  const clients = new Set<GatewayWsClient>();
  const { broadcast, broadcastToConnIds } = createGatewayBroadcaster({ clients });

  const handleHooksRequest = createGatewayHooksRequestHandler({
    deps: params.deps,
    getHooksConfig: params.hooksConfig,
    bindHost: params.bindHost,
    port: params.port,
    logHooks: params.logHooks,
  });

  // Register ElevenLabs webhook handler if configured
  const elevenLabsConfig = resolveElevenLabsAgentsConfig(params.cfg);
  if (elevenLabsConfig.webhookSecret) {
    const defaultAgentId = resolveDefaultAgentId(params.cfg);
    const workspaceDir = resolveAgentWorkspaceDir(params.cfg, defaultAgentId);

    registerElevenLabsWebhookHandler({
      webhookSecret: elevenLabsConfig.webhookSecret,
      webhookPath: elevenLabsConfig.webhookPath,
      onWebhook: async (payload) => {
        // Save webhook data directly to store
        try {
          await saveConversationFromWebhook(workspaceDir, payload);
          params.log.info(
            `elevenlabs webhook: saved conversation ${payload.conversationId} (${payload.status})`,
          );
        } catch (err) {
          params.log.warn(
            `elevenlabs webhook: failed to save conversation ${payload.conversationId}: ${err}`,
          );
        }

        // Extract data collection results
        const dataCollectionList = payload.analysis?.data_collection_results_list as
          | Array<{ data_collection_id: string; value: unknown }>
          | undefined;

        // Track automated actions for agent notification
        const automatedActions: string[] = [];

        // Check for callback_time and schedule automatic callback
        const callbackTimeItem = dataCollectionList?.find(
          (item) => item.data_collection_id === "callback_timestamp_iso_8601",
        );
        const callbackTimeValue = callbackTimeItem?.value;
        if (
          callbackTimeValue &&
          typeof callbackTimeValue === "string" &&
          callbackTimeValue.trim()
        ) {
          try {
            const cron = params.getCron?.();
            if (cron) {
              // Get stored conversation to retrieve to_number and dynamic_variables
              const storedConv = await getStoredConversation(workspaceDir, payload.conversationId);
              if (storedConv && storedConv.to_number) {
                const candidateName =
                  storedConv.dynamic_variables?.candidate_name || storedConv.to_number;
                await cron.add({
                  name: `Callback: ${candidateName}`,
                  enabled: true,
                  schedule: { kind: "at", at: callbackTimeValue },
                  sessionTarget: "direct",
                  wakeMode: "now",
                  payload: {
                    kind: "directCall",
                    functionName: DirectCallFunctionName.ELEVENLABS_INITIATE_CALL,
                    params: {
                      toNumber: storedConv.to_number,
                      dynamicVariables: storedConv.dynamic_variables,
                      originalConversationId: payload.conversationId,
                    },
                  },
                  delivery: { mode: "announce", channel: "last" },
                });
                params.log.info(
                  `elevenlabs webhook: scheduled callback for ${candidateName} at ${callbackTimeValue}`,
                );
                automatedActions.push(`callback scheduled for ${callbackTimeValue}`);
              }
            }
          } catch (err) {
            params.log.warn(
              `elevenlabs webhook: failed to schedule callback for ${payload.conversationId}: ${err}`,
            );
          }
        }

        // Check for email/calendar invite data and send immediately
        const candidateEmailItem = dataCollectionList?.find(
          (item) => item.data_collection_id === "candidate_email",
        );
        const calendarInviteTimeItem = dataCollectionList?.find(
          (item) => item.data_collection_id === "calendar_invite_timestamp_iso_8601",
        );
        const emailTemplateTypeItem = dataCollectionList?.find(
          (item) => item.data_collection_id === "email_type",
        );
        const candidateEmail = candidateEmailItem?.value;
        const calendarInviteTime = calendarInviteTimeItem?.value;
        const templateType = parseEmailTemplateType(emailTemplateTypeItem?.value);

        // Send email if candidate_email is present (calendar invite is optional)
        if (candidateEmail && typeof candidateEmail === "string" && candidateEmail.trim()) {
          try {
            const gogEnv = resolveGogEnv(params.cfg);
            if (gogEnv) {
              // Get stored conversation to retrieve candidate name
              const storedConv = await getStoredConversation(workspaceDir, payload.conversationId);
              const candidateName =
                storedConv?.dynamic_variables?.candidate_name || candidateEmail.split("@")[0];

              // Only pass interviewTimestamp if it's a valid string
              const interviewTimestamp =
                calendarInviteTime && typeof calendarInviteTime === "string"
                  ? calendarInviteTime.trim() || undefined
                  : undefined;

              const inviteResult = await sendInterviewInvite(
                {
                  candidateName,
                  candidateEmail: candidateEmail.trim(),
                  interviewTimestamp,
                  calendarId: elevenLabsConfig.calendarId,
                  conversationId: payload.conversationId,
                  templateType,
                },
                gogEnv,
                params.log,
              );

              if (inviteResult.ok) {
                params.log.info(
                  `elevenlabs webhook: processed email/calendar for ${candidateEmail}`,
                );
                if (inviteResult.calendarEventCreated && interviewTimestamp) {
                  automatedActions.push(
                    `calendar invite sent to ${candidateEmail} for ${interviewTimestamp}`,
                  );
                }
                if (inviteResult.emailSent) {
                  automatedActions.push(`email sent to ${candidateEmail}`);
                }
              } else {
                params.log.warn(
                  `elevenlabs webhook: failed to send email/calendar: ${inviteResult.error}`,
                );
              }
            } else {
              params.log.warn(
                `elevenlabs webhook: candidate email present but gog not configured (missing GOG_ACCOUNT)`,
              );
            }
          } catch (err) {
            params.log.warn(
              `elevenlabs webhook: failed to send interview invite for ${payload.conversationId}: ${err}`,
            );
          }
        }

        // Notify agent with summary and data collection results
        const mainSessionKey = resolveMainSessionKeyFromConfig();
        const statusText = payload.status === "done" ? "completed" : payload.status;

        const dataPoints = dataCollectionList
          ?.map((item) => `${item.data_collection_id}: ${JSON.stringify(item.value)}`)
          .join(", ");
        const dataText = dataPoints ? ` Data: ${dataPoints}.` : "";

        // Extract summary
        const hasSummary = payload.analysis?.transcript_summary;
        const summaryText = hasSummary
          ? ` Summary: ${String(payload.analysis?.transcript_summary).slice(0, 500)}`
          : "";

        // Add automated actions info
        const actionsText =
          automatedActions.length > 0 ? ` Automated actions: ${automatedActions.join("; ")}.` : "";

        const message = `ElevenLabs call ${statusText}. Conversation ID: ${payload.conversationId}.${dataText}${summaryText}${actionsText}`;
        enqueueSystemEvent(message, { sessionKey: mainSessionKey });
        requestHeartbeatNow({ reason: `elevenlabs:${payload.conversationId}` });
      },
    });
    params.log.info(`elevenlabs webhook enabled at ${elevenLabsConfig.webhookPath}`);
  }

  const handlePluginRequest = createGatewayPluginRequestHandler({
    registry: params.pluginRegistry,
    log: params.logPlugins,
  });

  const bindHosts = await resolveGatewayListenHosts(params.bindHost);
  const httpServers: HttpServer[] = [];
  const httpBindHosts: string[] = [];
  for (const host of bindHosts) {
    const httpServer = createGatewayHttpServer({
      canvasHost,
      clients,
      controlUiEnabled: params.controlUiEnabled,
      controlUiBasePath: params.controlUiBasePath,
      controlUiRoot: params.controlUiRoot,
      openAiChatCompletionsEnabled: params.openAiChatCompletionsEnabled,
      openResponsesEnabled: params.openResponsesEnabled,
      openResponsesConfig: params.openResponsesConfig,
      handleHooksRequest,
      handlePluginRequest,
      resolvedAuth: params.resolvedAuth,
      rateLimiter: params.rateLimiter,
      tlsOptions: params.gatewayTls?.enabled ? params.gatewayTls.tlsOptions : undefined,
    });
    try {
      await listenGatewayHttpServer({
        httpServer,
        bindHost: host,
        port: params.port,
      });
      httpServers.push(httpServer);
      httpBindHosts.push(host);
    } catch (err) {
      if (host === bindHosts[0]) {
        throw err;
      }
      params.log.warn(
        `gateway: failed to bind loopback alias ${host}:${params.port} (${String(err)})`,
      );
    }
  }
  const httpServer = httpServers[0];
  if (!httpServer) {
    throw new Error("Gateway HTTP server failed to start");
  }

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_PAYLOAD_BYTES,
  });
  for (const server of httpServers) {
    attachGatewayUpgradeHandler({
      httpServer: server,
      wss,
      canvasHost,
      clients,
      resolvedAuth: params.resolvedAuth,
      rateLimiter: params.rateLimiter,
    });
  }

  const agentRunSeq = new Map<string, number>();
  const dedupe = new Map<string, DedupeEntry>();
  const chatRunState = createChatRunState();
  const chatRunRegistry = chatRunState.registry;
  const chatRunBuffers = chatRunState.buffers;
  const chatDeltaSentAt = chatRunState.deltaSentAt;
  const addChatRun = chatRunRegistry.add;
  const removeChatRun = chatRunRegistry.remove;
  const chatAbortControllers = new Map<string, ChatAbortControllerEntry>();
  const toolEventRecipients = createToolEventRecipientRegistry();

  return {
    canvasHost,
    httpServer,
    httpServers,
    httpBindHosts,
    wss,
    clients,
    broadcast,
    broadcastToConnIds,
    agentRunSeq,
    dedupe,
    chatRunState,
    chatRunBuffers,
    chatDeltaSentAt,
    addChatRun,
    removeChatRun,
    chatAbortControllers,
    toolEventRecipients,
  };
}
