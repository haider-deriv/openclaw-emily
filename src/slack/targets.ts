import {
  buildMessagingTarget,
  ensureTargetId,
  parseTargetMention,
  parseTargetPrefixes,
  requireTargetKind,
  type MessagingTarget,
  type MessagingTargetKind,
  type MessagingTargetParseOptions,
} from "../channels/targets.js";

export type SlackTargetKind = MessagingTargetKind;

export type SlackTarget = MessagingTarget;

export type SlackTargetParseOptions = MessagingTargetParseOptions & {
  /**
   * When true (default), throws an error if @username or #channel format
   * doesn't match an ID pattern. When false, returns undefined instead,
   * allowing callers to fall back to async resolution.
   */
  strict?: boolean;
};

/**
 * Check if a string looks like a valid Slack ID pattern.
 * Slack IDs are alphanumeric only (no hyphens, underscores, dots, or spaces).
 */
function isSlackIdPattern(value: string): boolean {
  // Slack IDs are purely alphanumeric. Names often contain hyphens, underscores, dots, or spaces.
  return /^[A-Z0-9]+$/i.test(value) && value.length > 0;
}

export function parseSlackTarget(
  raw: string,
  options: SlackTargetParseOptions = {},
): SlackTarget | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  const strict = options.strict !== false; // Default to strict mode for backward compatibility

  const mentionTarget = parseTargetMention({
    raw: trimmed,
    mentionPattern: /^<@([A-Z0-9]+)>$/i,
    kind: "user",
  });
  if (mentionTarget) {
    return mentionTarget;
  }
  const prefixedTarget = parseTargetPrefixes({
    raw: trimmed,
    prefixes: [
      { prefix: "user:", kind: "user" },
      { prefix: "channel:", kind: "channel" },
      { prefix: "slack:", kind: "user" },
    ],
  });
  if (prefixedTarget) {
    return prefixedTarget;
  }

  // @ format: could be @U123ABC (ID) or @username (name)
  if (trimmed.startsWith("@")) {
    const candidate = trimmed.slice(1).trim();
    if (isSlackIdPattern(candidate)) {
      return buildMessagingTarget("user", candidate, trimmed);
    }
    if (strict) {
      ensureTargetId({
        candidate,
        pattern: /^[A-Z0-9]+$/i,
        errorMessage: "Slack DMs require a user id (use user:<id> or <@id>)",
      });
    }
    // Non-strict mode: return undefined to allow async resolution
    return undefined;
  }

  // # format: could be #C123ABC (ID) or #general (name)
  if (trimmed.startsWith("#")) {
    const candidate = trimmed.slice(1).trim();
    if (isSlackIdPattern(candidate)) {
      return buildMessagingTarget("channel", candidate, trimmed);
    }
    if (strict) {
      ensureTargetId({
        candidate,
        pattern: /^[A-Z0-9]+$/i,
        errorMessage: "Slack channels require a channel id (use channel:<id>)",
      });
    }
    // Non-strict mode: return undefined to allow async resolution
    return undefined;
  }

  // Channel mention format: <#C123ABC|channel-name>
  const channelMentionMatch = trimmed.match(/^<#([A-Z0-9]+)(?:\|[^>]*)?>$/i);
  if (channelMentionMatch) {
    return buildMessagingTarget("channel", channelMentionMatch[1], trimmed);
  }

  // Email format: contains @ but doesn't start with @
  if (trimmed.includes("@") && !trimmed.startsWith("@")) {
    // This looks like an email, return undefined to allow async resolution
    return undefined;
  }

  // Default to channel if it looks like an ID pattern
  if (isSlackIdPattern(trimmed)) {
    const kind = options.defaultKind ?? "channel";
    return buildMessagingTarget(kind, trimmed, trimmed);
  }

  if (options.defaultKind) {
    return buildMessagingTarget(options.defaultKind, trimmed, trimmed);
  }

  // Default behavior: treat as channel (for backward compatibility)
  return buildMessagingTarget("channel", trimmed, trimmed);
}

export function resolveSlackChannelId(raw: string): string {
  const target = parseSlackTarget(raw, { defaultKind: "channel" });
  return requireTargetKind({ platform: "Slack", target, kind: "channel" });
}
