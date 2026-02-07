/**
 * Polling mode for Slack - allows receiving messages as a user (not a bot)
 * using the conversations.history API instead of Socket Mode/Events API.
 */

import { WebClient } from "@slack/web-api";
import type { SlackFile, SlackMessageEvent } from "../types.js";
import type { SlackMonitorContext } from "./context.js";
import type { SlackMessageHandler } from "./message-handler.js";

export interface PollingConfig {
  ctx: SlackMonitorContext;
  handleSlackMessage: SlackMessageHandler;
  userToken: string;
  myUserId: string;
  pollInterval: number; // in seconds
  abortSignal?: AbortSignal;
}

type ChannelInfo = {
  id: string;
  type: "im" | "mpim" | "channel" | "group";
};

// Track processed messages to avoid duplicates within a session
const processedMessages = new Set<string>();

// Track discovered channels
const discoveredChannels = new Map<string, ChannelInfo>();

// Startup timestamp - only process messages newer than this
let startupTimestamp: number = 0;

/**
 * Get all channels the user is a member of (DMs, group DMs, and channels)
 */
async function getAllChannels(client: WebClient): Promise<ChannelInfo[]> {
  const channels: ChannelInfo[] = [];

  try {
    // Get DMs and group DMs
    const dmResponse = await client.conversations.list({
      types: "im,mpim",
      limit: 100,
    });
    if (dmResponse.ok && dmResponse.channels) {
      for (const ch of dmResponse.channels) {
        if (ch.id) {
          const type = ch.is_mpim ? "mpim" : "im";
          channels.push({ id: ch.id, type });
          discoveredChannels.set(ch.id, { id: ch.id, type });
        }
      }
    }
  } catch (err) {
    console.error("Error fetching DM channels:", err);
  }

  try {
    // Get public and private channels the user is a member of
    const channelResponse = await client.conversations.list({
      types: "public_channel,private_channel",
      limit: 200,
      exclude_archived: true,
    });
    if (channelResponse.ok && channelResponse.channels) {
      for (const ch of channelResponse.channels) {
        if (ch.id && ch.is_member) {
          const type = ch.is_private ? "group" : "channel";
          channels.push({ id: ch.id, type });
          discoveredChannels.set(ch.id, { id: ch.id, type });
        }
      }
    }
  } catch (err) {
    console.error("Error fetching channels:", err);
  }

  return channels;
}

/**
 * Check if text contains a mention of the user
 */
function containsMention(text: string, userId: string): boolean {
  // Check for <@USER_ID> mention format
  const mentionPattern = new RegExp(`<@${userId}>`, "i");
  return mentionPattern.test(text);
}

/**
 * Process a single message (used by both channel and thread polling)
 */
async function processMessage(
  msg: {
    ts?: string;
    user?: string;
    text?: string;
    subtype?: string;
    bot_id?: string;
    thread_ts?: string;
    files?: SlackFile[];
  },
  channelId: string,
  channelType: "im" | "mpim" | "channel" | "group",
  myUserId: string,
  handleSlackMessage: SlackMessageHandler,
  isDirectMessage: boolean,
): Promise<void> {
  const ts = msg.ts;
  const userId = msg.user;
  const text = msg.text;
  const subtype = msg.subtype;

  // Skip if already processed
  if (!ts || processedMessages.has(ts)) {
    return;
  }

  // Skip own messages
  if (userId === myUserId) {
    processedMessages.add(ts);
    return;
  }

  // Skip bot messages
  if (msg.bot_id || subtype === "bot_message") {
    processedMessages.add(ts);
    return;
  }

  // Skip empty or subtyped messages (joins, leaves, etc.)
  if (!text || !text.trim() || subtype) {
    processedMessages.add(ts);
    return;
  }

  // Skip messages from before startup (prevents re-processing on restart)
  const messageTime = parseFloat(ts);
  if (messageTime < startupTimestamp) {
    processedMessages.add(ts);
    return;
  }

  // For channels (not DMs), require @mention
  if (!isDirectMessage && !containsMention(text, myUserId)) {
    processedMessages.add(ts);
    return;
  }

  // Mark as processed before handling
  processedMessages.add(ts);

  // Convert to SlackMessageEvent format
  const slackEvent: SlackMessageEvent = {
    type: "message",
    channel: channelId,
    user: userId || "",
    text: text,
    ts: ts,
    event_ts: ts,
    channel_type: channelType,
    // Include thread_ts if it's a threaded reply
    ...(msg.thread_ts && msg.thread_ts !== ts ? { thread_ts: msg.thread_ts } : {}),
    // Include files for media handling
    ...(msg.files && msg.files.length > 0 ? { files: msg.files } : {}),
  };

  // Handle the message using existing handler
  try {
    await handleSlackMessage(slackEvent, { source: "message" });
  } catch (err) {
    console.error(`Error handling message in ${channelId}:`, err);
  }
}

/**
 * Poll a thread for new replies
 */
async function pollThread(
  client: WebClient,
  channelId: string,
  threadTs: string,
  channelType: "im" | "mpim" | "channel" | "group",
  myUserId: string,
  handleSlackMessage: SlackMessageHandler,
  isDirectMessage: boolean,
): Promise<void> {
  try {
    const response = await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: 10,
    });

    if (!response.ok || !response.messages) {
      return;
    }

    // Skip first message (it's the parent, already processed)
    for (const msg of response.messages.slice(1)) {
      await processMessage(
        msg,
        channelId,
        channelType,
        myUserId,
        handleSlackMessage,
        isDirectMessage,
      );
    }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (!errorMessage.includes("ratelimited")) {
      console.error(`Error polling thread ${threadTs} in ${channelId}:`, err);
    }
  }
}

/**
 * Poll a single channel for new messages
 */
async function pollChannel(
  client: WebClient,
  channelInfo: ChannelInfo,
  myUserId: string,
  handleSlackMessage: SlackMessageHandler,
): Promise<void> {
  const { id: channelId, type: channelType } = channelInfo;
  const isDirectMessage = channelType === "im" || channelType === "mpim";

  try {
    const response = await client.conversations.history({
      channel: channelId,
      limit: 10,
    });

    if (!response.ok || !response.messages) {
      return;
    }

    // Collect threads that have recent activity
    const activeThreads: string[] = [];

    for (const msg of response.messages) {
      // Check if this message is a thread parent with replies
      const replyCount = (msg as { reply_count?: number }).reply_count ?? 0;
      const latestReply = (msg as { latest_reply?: string }).latest_reply;

      if (replyCount > 0 && msg.ts) {
        // Check if thread has activity after startup
        const latestReplyTime = latestReply ? parseFloat(latestReply) : 0;
        if (latestReplyTime >= startupTimestamp) {
          activeThreads.push(msg.ts);
        }
      }

      // Process top-level message
      await processMessage(
        msg,
        channelId,
        channelType,
        myUserId,
        handleSlackMessage,
        isDirectMessage,
      );
    }

    // Poll active threads for new replies
    for (const threadTs of activeThreads) {
      await pollThread(
        client,
        channelId,
        threadTs,
        channelType,
        myUserId,
        handleSlackMessage,
        isDirectMessage,
      );
    }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    // Rate limiting - log but don't spam
    if (errorMessage.includes("ratelimited")) {
      console.warn(`Rate limited polling ${channelId}, will retry later`);
    } else {
      console.error(`Error polling channel ${channelId}:`, err);
    }
  }
}

/**
 * Main polling loop
 */
async function pollingLoop(config: PollingConfig): Promise<void> {
  const { ctx, handleSlackMessage, userToken, myUserId, pollInterval, abortSignal } = config;

  const client = new WebClient(userToken);

  // Set startup timestamp - only process messages after this time
  startupTimestamp = Date.now() / 1000;

  ctx.runtime.log?.(`slack polling mode started (interval: ${pollInterval}s, user: ${myUserId})`);

  while (!abortSignal?.aborted) {
    try {
      const channels = await getAllChannels(client);

      for (const channelInfo of channels) {
        if (abortSignal?.aborted) {
          break;
        }
        await pollChannel(client, channelInfo, myUserId, handleSlackMessage);
      }
    } catch (err) {
      console.error("Polling loop error:", err);
    }

    // Wait for next poll interval
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

  ctx.runtime.log?.("slack polling mode stopped");
}

/**
 * Start the polling loop for user token mode
 */
export function startPollingLoop(config: PollingConfig): void {
  // Run polling in background
  void pollingLoop(config);
}

/**
 * Clear processed messages cache (useful for testing)
 */
export function clearProcessedMessages(): void {
  processedMessages.clear();
}
