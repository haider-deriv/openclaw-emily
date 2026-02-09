import type { WebClient } from "@slack/web-api";
import { buildMessagingTarget, type MessagingTarget } from "../channels/targets.js";

export type SlackResolvedTarget = MessagingTarget & {
  displayName?: string;
  email?: string;
};

type SlackUser = {
  id?: string;
  name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  is_app_user?: boolean;
  real_name?: string;
  profile?: {
    display_name?: string;
    real_name?: string;
    email?: string;
  };
};

type SlackChannel = {
  id?: string;
  name?: string;
  is_archived?: boolean;
  is_private?: boolean;
};

type SlackListUsersResponse = {
  members?: SlackUser[];
  response_metadata?: { next_cursor?: string };
};

type SlackListChannelsResponse = {
  channels?: SlackChannel[];
  response_metadata?: { next_cursor?: string };
};

/**
 * Parse user input to determine the type of identifier.
 * Returns the parsed components without making API calls.
 */
function parseUserInput(raw: string): {
  id?: string;
  name?: string;
  email?: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }

  // User mention format: <@U123ABC>
  const mention = trimmed.match(/^<@([A-Z0-9]+)>$/i);
  if (mention) {
    return { id: mention[1]?.toUpperCase() };
  }

  // Prefixed formats: user:U123ABC or slack:U123ABC
  const prefixed = trimmed.replace(/^(slack:|user:)/i, "");
  if (/^[A-Z][A-Z0-9]+$/i.test(prefixed) && prefixed.length >= 9) {
    return { id: prefixed.toUpperCase() };
  }

  // Email format: contains @ but doesn't start with @
  if (trimmed.includes("@") && !trimmed.startsWith("@")) {
    return { email: trimmed.toLowerCase() };
  }

  // Username/display name format: @username or just username
  const name = trimmed.replace(/^@/, "").trim();
  return name ? { name } : {};
}

/**
 * Parse channel input to determine the type of identifier.
 * Returns the parsed components without making API calls.
 */
function parseChannelInput(raw: string): {
  id?: string;
  name?: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }

  // Channel mention format: <#C123ABC|channel-name>
  const mention = trimmed.match(/^<#([A-Z0-9]+)(?:\|([^>]+))?>$/i);
  if (mention) {
    return { id: mention[1]?.toUpperCase() };
  }

  // Prefixed format: channel:C123ABC
  const prefixed = trimmed.replace(/^(slack:|channel:)/i, "");
  if (/^[CG][A-Z0-9]+$/i.test(prefixed)) {
    return { id: prefixed.toUpperCase() };
  }

  // Channel name format: #general or just general
  const name = prefixed.replace(/^#/, "").trim();
  return name ? { name } : {};
}

/**
 * List all users in the Slack workspace via paginated API calls.
 */
async function listSlackUsers(client: WebClient): Promise<SlackUser[]> {
  const users: SlackUser[] = [];
  let cursor: string | undefined;
  do {
    const res = (await client.users.list({
      limit: 200,
      cursor,
    })) as SlackListUsersResponse;
    if (Array.isArray(res.members)) {
      users.push(...res.members);
    }
    const next = res.response_metadata?.next_cursor?.trim();
    cursor = next ? next : undefined;
  } while (cursor);
  return users;
}

/**
 * List all channels in the Slack workspace via paginated API calls.
 */
async function listSlackChannels(client: WebClient): Promise<SlackChannel[]> {
  const channels: SlackChannel[] = [];
  let cursor: string | undefined;
  do {
    const res = (await client.conversations.list({
      types: "public_channel,private_channel",
      exclude_archived: false,
      limit: 1000,
      cursor,
    })) as SlackListChannelsResponse;
    if (Array.isArray(res.channels)) {
      channels.push(...res.channels);
    }
    const next = res.response_metadata?.next_cursor?.trim();
    cursor = next ? next : undefined;
  } while (cursor);
  return channels;
}

/**
 * Score a user match for best-fit selection.
 * Higher scores indicate better matches.
 */
function scoreUserMatch(user: SlackUser, match: { name?: string; email?: string }): number {
  let score = 0;

  // Prefer non-deleted users
  if (!user.deleted) {
    score += 3;
  }

  // Prefer real users over bots
  if (!user.is_bot && !user.is_app_user) {
    score += 2;
  }

  // Exact email match is a strong signal
  if (match.email && user.profile?.email?.toLowerCase() === match.email) {
    score += 5;
  }

  // Name matching
  if (match.name) {
    const target = match.name.toLowerCase();
    const candidates = [
      user.name,
      user.profile?.display_name,
      user.profile?.real_name,
      user.real_name,
    ]
      .map((value) => value?.toLowerCase())
      .filter(Boolean) as string[];

    if (candidates.some((value) => value === target)) {
      score += 2;
    }
  }

  return score;
}

/**
 * Score a channel match for best-fit selection.
 * Higher scores indicate better matches.
 */
function scoreChannelMatch(channel: SlackChannel): number {
  // Prefer non-archived channels
  return channel.is_archived ? 0 : 1;
}

/**
 * Resolve a user target by ID, email, username, or display name.
 * Returns null if the user cannot be found.
 */
export async function resolveSlackUserTarget(params: {
  input: string;
  client: WebClient;
}): Promise<SlackResolvedTarget | null> {
  const parsed = parseUserInput(params.input);

  // Direct ID resolution (no API call needed for validation)
  if (parsed.id) {
    return {
      ...buildMessagingTarget("user", parsed.id, params.input),
    };
  }

  // Need to look up users via API
  if (!parsed.email && !parsed.name) {
    return null;
  }

  const users = await listSlackUsers(params.client);

  // Email-based resolution
  if (parsed.email) {
    const matches = users.filter((user) => user.profile?.email?.toLowerCase() === parsed.email);
    if (matches.length > 0) {
      const scored = matches
        .map((user) => ({ user, score: scoreUserMatch(user, parsed) }))
        .toSorted((a, b) => b.score - a.score);
      const best = scored[0]?.user ?? matches[0];
      const id = best.id?.trim();
      if (id) {
        return {
          ...buildMessagingTarget("user", id, params.input),
          displayName:
            best.profile?.display_name || best.profile?.real_name || best.real_name || best.name,
          email: best.profile?.email,
        };
      }
    }
    return null;
  }

  // Name-based resolution
  if (parsed.name) {
    const target = parsed.name.toLowerCase();
    const matches = users.filter((user) => {
      const candidates = [
        user.name,
        user.profile?.display_name,
        user.profile?.real_name,
        user.real_name,
      ]
        .map((value) => value?.toLowerCase())
        .filter(Boolean) as string[];
      return candidates.includes(target);
    });

    if (matches.length > 0) {
      const scored = matches
        .map((user) => ({ user, score: scoreUserMatch(user, parsed) }))
        .toSorted((a, b) => b.score - a.score);
      const best = scored[0]?.user ?? matches[0];
      const id = best.id?.trim();
      if (id) {
        return {
          ...buildMessagingTarget("user", id, params.input),
          displayName:
            best.profile?.display_name || best.profile?.real_name || best.real_name || best.name,
          email: best.profile?.email,
        };
      }
    }
    return null;
  }

  return null;
}

/**
 * Resolve a channel target by ID or name.
 * Returns null if the channel cannot be found.
 */
export async function resolveSlackChannelTarget(params: {
  input: string;
  client: WebClient;
}): Promise<SlackResolvedTarget | null> {
  const parsed = parseChannelInput(params.input);

  // Direct ID resolution (no API call needed for validation)
  if (parsed.id) {
    return {
      ...buildMessagingTarget("channel", parsed.id, params.input),
    };
  }

  // Need to look up channels via API
  if (!parsed.name) {
    return null;
  }

  const channels = await listSlackChannels(params.client);
  const target = parsed.name.toLowerCase();

  const matches = channels.filter((channel) => channel.name?.toLowerCase() === target);

  if (matches.length > 0) {
    const scored = matches
      .map((channel) => ({ channel, score: scoreChannelMatch(channel) }))
      .toSorted((a, b) => b.score - a.score);
    const best = scored[0]?.channel ?? matches[0];
    const id = best.id?.trim();
    if (id) {
      return {
        ...buildMessagingTarget("channel", id, params.input),
        displayName: best.name,
      };
    }
  }

  return null;
}

/**
 * Determine the target kind from input format.
 */
function inferTargetKind(
  input: string,
  defaultKind: "user" | "channel" = "channel",
): "user" | "channel" {
  const trimmed = input.trim();

  // Explicit user indicators
  if (trimmed.startsWith("<@")) {
    return "user";
  }
  if (trimmed.startsWith("user:")) {
    return "user";
  }
  if (trimmed.startsWith("slack:")) {
    return "user";
  }
  if (trimmed.includes("@") && !trimmed.startsWith("@") && !trimmed.startsWith("#")) {
    // Email address
    return "user";
  }
  if (trimmed.startsWith("@")) {
    return "user";
  }

  // Explicit channel indicators
  if (trimmed.startsWith("<#")) {
    return "channel";
  }
  if (trimmed.startsWith("channel:")) {
    return "channel";
  }
  if (trimmed.startsWith("#")) {
    return "channel";
  }

  return defaultKind;
}

/**
 * Resolve a Slack target (user or channel) by any supported identifier format.
 * Automatically detects whether the input refers to a user or channel.
 *
 * Supported formats:
 * - User ID: U01ABC123, <@U01ABC123>, user:U01ABC123, slack:U01ABC123
 * - Email: john@company.com
 * - Username: @johndoe
 * - Display name: @John Doe
 * - Channel ID: C01ABC123, <#C01ABC123>, channel:C01ABC123
 * - Channel name: #general
 */
export async function resolveSlackTarget(params: {
  input: string;
  client: WebClient;
  defaultKind?: "user" | "channel";
}): Promise<SlackResolvedTarget | null> {
  const kind = inferTargetKind(params.input, params.defaultKind);

  if (kind === "user") {
    return resolveSlackUserTarget(params);
  }

  return resolveSlackChannelTarget(params);
}
