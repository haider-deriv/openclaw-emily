/**
 * LinkedIn Polling Mode
 *
 * Polls Unipile API for new messages instead of relying on webhooks.
 * Similar to Slack's polling mode in src/slack/monitor/polling.ts
 */

import type { OpenClawConfig } from "../config/config.js";
import type { LinkedInClientOptions, LinkedInMessage, LinkedInWebhookPayload } from "./types.js";
import { listChats, getMessages } from "./client.js";

export interface LinkedInPollingConfig {
  clientOpts: LinkedInClientOptions;
  config: OpenClawConfig;
  accountId: string;
  pollInterval: number; // seconds (default: 30)
  abortSignal?: AbortSignal;
  onMessage: (payload: LinkedInWebhookPayload) => Promise<void>;
  log?: (msg: string) => void;
}

// Track processed messages to avoid duplicates (per account)
const processedMessages = new Map<string, Set<string>>();

// Track startup timestamp per account
const startupTimestamps = new Map<string, string>();

/**
 * Start the LinkedIn polling loop.
 */
export function startLinkedInPolling(config: LinkedInPollingConfig): void {
  const { accountId, log } = config;

  // Initialize tracking for this account
  if (!processedMessages.has(accountId)) {
    processedMessages.set(accountId, new Set());
  }

  // Record startup time (ISO 8601) - only process messages after this
  const startupTime = new Date().toISOString();
  startupTimestamps.set(accountId, startupTime);

  log?.(`[LINKEDIN POLLING] Starting for account ${accountId}`);
  log?.(`[LINKEDIN POLLING] Will process messages after ${startupTime}`);

  // Start polling loop in background
  void pollingLoop(config);
}

/**
 * Main polling loop.
 */
async function pollingLoop(config: LinkedInPollingConfig): Promise<void> {
  const { clientOpts, accountId, pollInterval, abortSignal, log } = config;

  while (!abortSignal?.aborted) {
    try {
      log?.(`[LINKEDIN POLLING] Checking for new messages...`);

      // Get all chats with recent activity
      const chatsResponse = await listChats(clientOpts, {
        limit: 50,
      });

      let newMessageCount = 0;

      for (const chat of chatsResponse.items) {
        if (abortSignal?.aborted) break;

        // Get messages from this chat
        const startupTime = startupTimestamps.get(accountId);
        const messagesResponse = await getMessages(clientOpts, chat.id, {
          limit: 10,
          after: startupTime,
        });

        for (const msg of messagesResponse.items) {
          const wasNew = await processMessage(msg, chat.id, config);
          if (wasNew) newMessageCount++;
        }
      }

      if (newMessageCount > 0) {
        log?.(`[LINKEDIN POLLING] Processed ${newMessageCount} new message(s)`);
      }
    } catch (err) {
      log?.(`[LINKEDIN POLLING] Error: ${String(err)}`);
    }

    // Wait for next poll interval
    if (!abortSignal?.aborted) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, pollInterval * 1000);
        abortSignal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timeout);
            resolve();
          },
          { once: true },
        );
      });
    }
  }

  log?.(`[LINKEDIN POLLING] Stopped for account ${accountId}`);
}

/**
 * Process a single message from the API.
 * Returns true if this was a new message that was processed.
 */
async function processMessage(
  msg: LinkedInMessage,
  chatId: string,
  config: LinkedInPollingConfig,
): Promise<boolean> {
  const { accountId, onMessage, log } = config;
  const processed = processedMessages.get(accountId)!;

  // Skip if already processed
  if (processed.has(msg.id)) {
    return false;
  }
  processed.add(msg.id);

  // Skip own messages (is_sender === 1)
  if (msg.is_sender === 1) {
    return false;
  }

  // Skip if no text content AND no attachments
  const hasText = Boolean(msg.text?.trim());
  const hasAttachments = msg.attachments && msg.attachments.length > 0;
  if (!hasText && !hasAttachments) {
    return false;
  }

  log?.(`[LINKEDIN POLLING] New message in chat ${chatId}: "${msg.text.slice(0, 50)}..."`);

  // Convert to webhook payload format (for compatibility with existing handler)
  const payload: LinkedInWebhookPayload = {
    account_id: msg.account_id,
    account_type: "LINKEDIN",
    chat_id: chatId,
    message_id: msg.id,
    message: msg.text ?? "",
    timestamp: msg.timestamp,
    sender: {
      id: msg.sender_id,
      name: undefined, // Not available from message, would need attendees lookup
    },
    is_sender: false,
    is_group: false, // Could determine from chat type if needed
    provider_message_id: msg.provider_id,
    attachments: msg.attachments, // Include attachments for media support
  };

  try {
    await onMessage(payload);
    return true;
  } catch (err) {
    log?.(`[LINKEDIN POLLING] Error processing message: ${String(err)}`);
    return false;
  }
}

/**
 * Clear processed messages cache for an account (useful for testing).
 */
export function clearProcessedMessages(accountId: string): void {
  processedMessages.get(accountId)?.clear();
}

/**
 * Get the startup timestamp for an account.
 */
export function getStartupTimestamp(accountId: string): string | undefined {
  return startupTimestamps.get(accountId);
}
