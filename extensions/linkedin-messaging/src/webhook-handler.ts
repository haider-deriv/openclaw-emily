/**
 * LinkedIn Messaging Webhook Handler
 *
 * Handles incoming webhook events from Unipile for LinkedIn messages.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig, MsgContext, ReplyPayload } from "openclaw/plugin-sdk";
import {
  normalizePluginHttpPath,
  registerPluginHttpRoute,
  dispatchReplyWithBufferedBlockDispatcher,
} from "openclaw/plugin-sdk";
import type { LinkedInWebhookPayload } from "../../../src/linkedin/types.js";
import type { ResolvedLinkedInAccount } from "./channel.js";
import { sendMessage } from "../../../src/linkedin/client.js";
import { getLinkedInRuntime } from "./runtime.js";

export interface LinkedInWebhookHandlerOptions {
  account: ResolvedLinkedInAccount;
  config: OpenClawConfig;
  abortSignal?: AbortSignal;
  webhookPath?: string;
  onMessage?: (payload: LinkedInWebhookPayload) => Promise<void>;
}

export interface LinkedInWebhookHandler {
  path: string;
  stop: () => void;
}

// Track runtime state in memory
const runtimeState = new Map<
  string,
  {
    running: boolean;
    lastStartAt: number | null;
    lastStopAt: number | null;
    lastError: string | null;
    lastInboundAt?: number | null;
    lastOutboundAt?: number | null;
  }
>();

function recordChannelRuntimeState(params: {
  channel: string;
  accountId: string;
  state: Partial<{
    running: boolean;
    lastStartAt: number | null;
    lastStopAt: number | null;
    lastError: string | null;
    lastInboundAt: number | null;
    lastOutboundAt: number | null;
  }>;
}): void {
  const key = `${params.channel}:${params.accountId}`;
  const existing = runtimeState.get(key) ?? {
    running: false,
    lastStartAt: null,
    lastStopAt: null,
    lastError: null,
  };
  runtimeState.set(key, { ...existing, ...params.state });
}

export function getLinkedInRuntimeState(accountId: string) {
  return runtimeState.get(`linkedin:${accountId}`);
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/**
 * Validate Unipile webhook signature (if configured).
 * Unipile uses a simple shared secret validation.
 */
function validateWebhookSignature(
  _body: string,
  signature: string | undefined,
  secret: string | undefined,
): boolean {
  if (!secret) {
    // No secret configured, skip validation
    return true;
  }
  if (!signature) {
    return false;
  }
  // Unipile typically sends the secret as a header
  // Exact validation depends on Unipile's implementation
  return signature === secret;
}

/**
 * Start the LinkedIn webhook handler.
 */
export function startLinkedInWebhookHandler(
  opts: LinkedInWebhookHandlerOptions,
): LinkedInWebhookHandler {
  const { account, abortSignal, webhookPath, onMessage } = opts;
  const runtime = getLinkedInRuntime();

  // Record starting state
  recordChannelRuntimeState({
    channel: "linkedin",
    accountId: account.accountId,
    state: {
      running: true,
      lastStartAt: Date.now(),
    },
  });

  // Register HTTP webhook handler
  const normalizedPath =
    normalizePluginHttpPath(webhookPath, "/linkedin/webhook") ?? "/linkedin/webhook";
  const unregisterHttp = registerPluginHttpRoute({
    path: normalizedPath,
    pluginId: "linkedin-messaging",
    accountId: account.accountId,
    log: (msg) => runtime.logging?.logVerbose?.(msg),
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      console.log(`[LINKEDIN] Webhook hit: ${req.method} ${req.url}`);

      // Handle GET requests for webhook verification
      if (req.method === "GET") {
        console.log("[LINKEDIN] GET request - returning OK");
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain");
        res.end("OK");
        return;
      }

      // Only accept POST requests
      if (req.method !== "POST") {
        console.log(`[LINKEDIN] Rejecting method: ${req.method}`);
        res.statusCode = 405;
        res.setHeader("Allow", "GET, POST");
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Method Not Allowed" }));
        return;
      }

      try {
        const rawBody = await readRequestBody(req);
        console.log(`[LINKEDIN] Raw webhook body:`, rawBody.slice(0, 500));

        const signature = req.headers["x-webhook-secret"] as string | undefined;

        // Validate signature if secret is configured
        if (!validateWebhookSignature(rawBody, signature, account.webhookSecret)) {
          console.log("[LINKEDIN] Signature validation FAILED");
          runtime.logging?.logVerbose?.("linkedin: webhook signature validation failed");
          res.statusCode = 401;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Invalid signature" }));
          return;
        }

        // Parse the webhook body
        const payload = JSON.parse(rawBody) as LinkedInWebhookPayload;
        console.log(`[LINKEDIN] Parsed payload:`, JSON.stringify(payload, null, 2));

        // Record inbound activity
        recordChannelRuntimeState({
          channel: "linkedin",
          accountId: account.accountId,
          state: {
            lastInboundAt: Date.now(),
          },
        });

        // Respond immediately with 200 to avoid timeout
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ status: "ok" }));

        // Log the incoming message
        console.log(
          `[LINKEDIN] Message from: ${payload.sender?.name ?? payload.sender?.id ?? "unknown"}`,
        );
        runtime.logging?.logVerbose?.(
          `linkedin: received message from ${payload.sender?.name ?? payload.sender?.id ?? "unknown"}`,
        );

        // Process the message asynchronously
        if (onMessage) {
          console.log("[LINKEDIN] Calling onMessage handler...");
          await onMessage(payload).catch((err) => {
            console.error(`[LINKEDIN] onMessage error:`, err);
            runtime.logging?.error?.(`linkedin webhook handler failed: ${String(err)}`);
          });
          console.log("[LINKEDIN] onMessage handler completed");
        } else {
          console.log("[LINKEDIN] WARNING: No onMessage handler!");
        }
      } catch (err) {
        console.error(`[LINKEDIN] Webhook error:`, err);
        runtime.logging?.error?.(`linkedin webhook error: ${String(err)}`);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Internal server error" }));
        }
      }
    },
  });

  runtime.logging?.logVerbose?.(`linkedin: registered webhook handler at ${normalizedPath}`);

  // Handle abort signal
  const stopHandler = () => {
    runtime.logging?.logVerbose?.(
      `linkedin: stopping webhook handler for account ${account.accountId}`,
    );
    unregisterHttp();
    recordChannelRuntimeState({
      channel: "linkedin",
      accountId: account.accountId,
      state: {
        running: false,
        lastStopAt: Date.now(),
      },
    });
  };

  abortSignal?.addEventListener("abort", stopHandler);

  return {
    path: normalizedPath,
    stop: () => {
      stopHandler();
      abortSignal?.removeEventListener("abort", stopHandler);
    },
  };
}

/**
 * Process an incoming LinkedIn message and dispatch to the auto-reply system.
 */
export async function processLinkedInMessage(
  payload: LinkedInWebhookPayload,
  account: ResolvedLinkedInAccount,
  config: OpenClawConfig,
): Promise<void> {
  console.log("[LINKEDIN] processLinkedInMessage called");
  const runtime = getLinkedInRuntime();

  // Skip if it's our own message
  if (payload.is_sender) {
    console.log("[LINKEDIN] Skipping own message (is_sender=true)");
    runtime.logging?.logVerbose?.("linkedin: skipping own message");
    return;
  }

  // Build client options for sending replies
  const clientOpts = {
    baseUrl: account.baseUrl,
    apiKey: account.apiKey,
    accountId: account.unipileAccountId,
    timeoutMs: account.timeoutMs,
  };

  // Build message body with attachment info
  let messageBody = payload.message ?? "";
  if (payload.attachments && payload.attachments.length > 0) {
    const attachmentDescriptions = payload.attachments.map((att) => {
      if (att.type === "img") return `[Image attachment${att.url ? `: ${att.url}` : ""}]`;
      if (att.type === "video") return `[Video attachment${att.url ? `: ${att.url}` : ""}]`;
      if (att.type === "audio") return `[Audio attachment${att.url ? `: ${att.url}` : ""}]`;
      if (att.type === "file")
        return `[File: ${(att as { file_name: string }).file_name}${att.url ? ` - ${att.url}` : ""}]`;
      if (att.type === "linkedin_post") return `[LinkedIn Post${att.url ? `: ${att.url}` : ""}]`;
      return `[Attachment: ${att.type}]`;
    });
    if (messageBody) {
      messageBody += "\n\n" + attachmentDescriptions.join("\n");
    } else {
      messageBody = attachmentDescriptions.join("\n");
    }
  }

  // Format message body with sender info (like Slack does)
  const senderName = payload.sender?.name;
  const senderId = payload.sender?.id ?? "";
  const chatType = payload.is_group ? "group" : "direct";
  const isDirectMessage = !payload.is_group;

  // Build envelope "from" label (like Slack's envelopeFrom)
  const envelopeFrom =
    runtime.channel?.conversation?.resolveConversationLabel?.({
      ChatType: chatType,
      SenderName: senderName,
      From: `linkedin:${senderId}`,
    }) ?? (isDirectMessage ? senderName : `linkedin:${payload.chat_id}`);

  // Append message ID to body (like Slack does)
  const textWithId = `${messageBody}\n[linkedin message id: ${payload.message_id} chat: ${payload.chat_id}]`;

  // Get timestamp for envelope
  const messageTimestamp = payload.timestamp ? new Date(payload.timestamp).getTime() : undefined;

  // Get previous timestamp for elapsed time calculation
  const storePath = runtime.channel?.session?.resolveStorePath?.(config.session?.store, {
    agentId: undefined, // Will use default agent
  });
  const sessionKey = `linkedin:${payload.chat_id}`;
  const previousTimestamp = storePath
    ? runtime.channel?.session?.readSessionUpdatedAt?.({ storePath, sessionKey })
    : undefined;

  // Use plugin runtime to format the inbound envelope with sender context
  const envelopeOptions = runtime.channel?.reply?.resolveEnvelopeFormatOptions?.(config);
  const formattedBody =
    runtime.channel?.reply?.formatInboundEnvelope?.({
      channel: "LinkedIn",
      from: envelopeFrom ?? senderName ?? senderId,
      timestamp: messageTimestamp,
      body: textWithId,
      chatType,
      sender: { name: senderName, id: senderId },
      previousTimestamp,
      envelope: envelopeOptions,
    }) ?? messageBody;

  // Build context payload for the auto-reply system (MsgContext format)
  // Include all fields that Slack includes so the agent knows the context
  const linkedInFrom = isDirectMessage
    ? `linkedin:${senderId}`
    : `linkedin:group:${payload.chat_id}`;
  const linkedInTo = `linkedin:${account.unipileAccountId}`;

  const ctxPayload: MsgContext = {
    Body: formattedBody,
    RawBody: messageBody,
    CommandBody: messageBody,
    From: linkedInFrom,
    To: linkedInTo,
    SessionKey: sessionKey,
    AccountId: account.accountId,
    ChatType: chatType,
    ConversationLabel: envelopeFrom,
    SenderName: senderName,
    SenderId: senderId,
    Provider: "linkedin" as const,
    Surface: "linkedin" as const,
    MessageSid: payload.message_id,
    ReplyToId: payload.chat_id,
    Timestamp: messageTimestamp,
    OriginatingChannel: "linkedin" as const,
    OriginatingTo: linkedInTo,
  };

  console.log("[LINKEDIN] Built MsgContext:", JSON.stringify(ctxPayload, null, 2));

  runtime.logging?.logVerbose?.(
    `linkedin: message from ${ctxPayload.SenderName ?? ctxPayload.From}: ${(ctxPayload.Body ?? "").slice(0, 100)}`,
  );

  // Dispatch to auto-reply system
  console.log("[LINKEDIN] Dispatching to auto-reply system...");
  console.log("[LINKEDIN] config is:", config ? "defined" : "UNDEFINED!");
  console.log("[LINKEDIN] config type:", typeof config);
  if (config) {
    console.log("[LINKEDIN] config.session:", config.session);
  }
  try {
    await dispatchReplyWithBufferedBlockDispatcher({
      ctx: ctxPayload,
      cfg: config,
      dispatcherOptions: {
        deliver: async (replyPayload: ReplyPayload) => {
          console.log("[LINKEDIN] deliver() called with:", JSON.stringify(replyPayload, null, 2));
          const text = replyPayload.text;
          if (!text) {
            console.log("[LINKEDIN] No text in reply payload, skipping");
            return;
          }

          console.log(`[LINKEDIN] Sending reply to chat ${payload.chat_id}: ${text.slice(0, 100)}`);
          // Send reply to the same chat
          await sendMessage(clientOpts, payload.chat_id, { text });

          console.log("[LINKEDIN] Reply sent successfully!");
          runtime.logging?.logVerbose?.(
            `linkedin: sent reply to ${payload.chat_id}: ${text.slice(0, 100)}`,
          );

          // Record outbound activity
          recordChannelRuntimeState({
            channel: "linkedin",
            accountId: account.accountId,
            state: {
              lastOutboundAt: Date.now(),
            },
          });
        },
        onError: (err, info) => {
          console.error(`[LINKEDIN] Reply error (${info.kind}):`, err);
          runtime.logging?.error?.(`linkedin ${info.kind} reply failed: ${String(err)}`);
        },
      },
    });
    console.log("[LINKEDIN] dispatchReplyWithBufferedBlockDispatcher completed");
  } catch (err) {
    console.error("[LINKEDIN] Auto-reply dispatch failed:", err);
    runtime.logging?.error?.(`linkedin: auto-reply dispatch failed: ${String(err)}`);
  }
}
