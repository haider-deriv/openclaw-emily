/**
 * LinkedIn Polling Mode
 *
 * Polls Unipile API for new messages instead of relying on webhooks.
 * Similar to Slack's polling mode in src/slack/monitor/polling.ts
 */

import type { OpenClawConfig } from "../config/config.js";
import type {
  LinkedInChat,
  LinkedInClientOptions,
  LinkedInMessage,
  LinkedInWebhookPayload,
} from "./types.js";
import {
  listChats,
  getMessages,
  getChatAttendees,
  getUserProfile,
  classifyLinkedInError,
} from "./client.js";

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

// Cache chat attendees to avoid repeated API calls (chatId -> senderId -> displayName)
const attendeeCache = new Map<string, Map<string, string>>();

/**
 * Resolve sender name by looking up chat attendees.
 * Falls back to chat name (which contains the contact name for direct messages).
 * Caches results to avoid repeated API calls.
 */
async function resolveSenderName(
  chatId: string,
  senderAttendeeId: string,
  senderId: string,
  chatName: string | null | undefined,
  clientOpts: LinkedInClientOptions,
  log?: (msg: string) => void,
): Promise<string | undefined> {
  // Check cache first - try both IDs
  const chatAttendees = attendeeCache.get(chatId);
  if (chatAttendees) {
    const cached = chatAttendees.get(senderAttendeeId) ?? chatAttendees.get(senderId);
    if (cached) {
      return cached;
    }
  }

  try {
    // Fetch attendees from API
    const response = await getChatAttendees(clientOpts, chatId);

    log?.(`[LINKEDIN POLLING] Fetched ${response.items.length} attendees for chat ${chatId}`);

    // Cache all attendees for this chat, mapping multiple ID formats
    const newCache = new Map<string, string>();
    for (const attendee of response.items) {
      log?.(
        `[LINKEDIN POLLING] Attendee: id=${attendee.id}, provider_id=${attendee.provider_id}, display_name=${attendee.display_name}, is_self=${attendee.is_self}`,
      );
      if (attendee.display_name) {
        // Map id, provider_id to the name for flexible matching
        newCache.set(attendee.id, attendee.display_name);
        newCache.set(attendee.provider_id, attendee.display_name);
      }
    }
    attendeeCache.set(chatId, newCache);

    log?.(
      `[LINKEDIN POLLING] Looking for sender: attendee_id=${senderAttendeeId}, sender_id=${senderId}`,
    );

    // Try to find the sender name using either ID
    let name = newCache.get(senderAttendeeId) ?? newCache.get(senderId);

    // If display_name was undefined, try fetching the user profile
    if (!name) {
      log?.(`[LINKEDIN POLLING] display_name not found, fetching user profile for ${senderId}`);
      try {
        const profile = await getUserProfile(clientOpts, senderId);
        if (profile.first_name || profile.last_name) {
          name = [profile.first_name, profile.last_name].filter(Boolean).join(" ");
          log?.(`[LINKEDIN POLLING] Got name from user profile: ${name}`);
          // Cache this for future lookups
          newCache.set(senderAttendeeId, name);
          newCache.set(senderId, name);
        }
      } catch (profileErr) {
        log?.(
          `[LINKEDIN POLLING] Failed to fetch user profile for ${senderId}: ${String(profileErr)}`,
        );
      }
    }

    // Fallback to chat name (for direct chats, this is the contact's name)
    if (!name && chatName) {
      log?.(`[LINKEDIN POLLING] Using chat name as fallback: ${chatName}`);
      name = chatName;
      // Cache this for future lookups
      newCache.set(senderAttendeeId, chatName);
      newCache.set(senderId, chatName);
    }

    log?.(`[LINKEDIN POLLING] Resolved sender name: ${name ?? "NOT FOUND"}`);

    return name;
  } catch (err) {
    log?.(`[LINKEDIN POLLING] Failed to fetch attendees for chat ${chatId}: ${String(err)}`);
    // Even on error, try using chat name as fallback
    if (chatName) {
      log?.(`[LINKEDIN POLLING] Using chat name as fallback after error: ${chatName}`);
      return chatName;
    }
    return undefined;
  }
}

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
        if (abortSignal?.aborted) {
          break;
        }

        // Get messages from this chat
        const startupTime = startupTimestamps.get(accountId);
        const messagesResponse = await getMessages(clientOpts, chat.id, {
          limit: 10,
          after: startupTime,
        });

        for (const msg of messagesResponse.items) {
          const wasNew = await processMessage(msg, chat, config);
          if (wasNew) {
            newMessageCount++;
          }
        }
      }

      if (newMessageCount > 0) {
        log?.(`[LINKEDIN POLLING] Processed ${newMessageCount} new message(s)`);
      }
    } catch (err) {
      // Classify the error for better handling
      const classified = classifyLinkedInError(err);

      if (classified.isTransient) {
        // Transient errors (network, timeout) - log as debug, will retry on next poll
        log?.(
          `[LINKEDIN POLLING] Transient ${classified.type} error (will retry): ${classified.message}`,
        );
      } else {
        // Non-transient errors - log as error
        log?.(`[LINKEDIN POLLING] Error (${classified.type}): ${classified.message}`);
      }
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
  chat: LinkedInChat,
  config: LinkedInPollingConfig,
): Promise<boolean> {
  const { clientOpts, accountId, onMessage, log } = config;
  const processed = processedMessages.get(accountId)!;
  const chatId = chat.id;

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

  log?.(`[LINKEDIN POLLING] New message in chat ${chatId}: "${msg.text?.slice(0, 50)}..."`);
  log?.(
    `[LINKEDIN POLLING] Message sender_id=${msg.sender_id}, sender_attendee_id=${msg.sender_attendee_id}`,
  );
  log?.(`[LINKEDIN POLLING] Chat name: ${chat.name ?? "null"}, type: ${chat.type}`);

  // Resolve sender name from chat attendees, with chat.name as fallback for direct chats
  const senderName = await resolveSenderName(
    chatId,
    msg.sender_attendee_id,
    msg.sender_id,
    chat.name,
    clientOpts,
    log,
  );

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
      name: senderName,
    },
    is_sender: false,
    is_group: chat.type !== 0, // type 0 = direct, 1 = group, 2 = channel
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
 * Clear attendee cache for a chat (useful for testing or when attendees change).
 */
export function clearAttendeeCache(chatId?: string): void {
  if (chatId) {
    attendeeCache.delete(chatId);
  } else {
    attendeeCache.clear();
  }
}

/**
 * Get the startup timestamp for an account.
 */
export function getStartupTimestamp(accountId: string): string | undefined {
  return startupTimestamps.get(accountId);
}
