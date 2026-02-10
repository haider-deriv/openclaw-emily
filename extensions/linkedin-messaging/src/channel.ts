/**
 * LinkedIn Messaging Channel Plugin
 *
 * Uses Unipile API for LinkedIn messaging.
 * - Channel config: channels.linkedin.* (dmPolicy, allowFrom, webhookSecret)
 * - Credentials: channels.linkedin.* OR tools.linkedin.* OR env vars (fallback)
 */

import type { ChannelPlugin, ChannelGatewayContext, OpenClawConfig } from "openclaw/plugin-sdk";
import {
  getChatChannelMeta,
  DEFAULT_ACCOUNT_ID,
  formatPairingApproveHint,
  missingTargetError,
  linkedinOnboardingAdapter,
  buildChannelConfigSchema,
  LinkedInChannelConfigSchema,
} from "openclaw/plugin-sdk";
import { getLinkedInRuntime } from "./runtime.js";

// Resolved account type for LinkedIn messaging
export type ResolvedLinkedInAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  unipileAccountId: string;
  timeoutMs: number;
  dmPolicy: "open" | "pairing" | "allowlist";
  allowFrom: string[];
  webhookSecret?: string;
  webhookPath?: string;
  webhookBaseUrl?: string;
  pollInterval?: number; // Polling interval in seconds (default: 30)
};

const DEFAULT_TIMEOUT_MS = 30_000;
const meta = getChatChannelMeta("linkedin");

/**
 * Resolve LinkedIn credentials from multiple sources (channel > tool > env).
 */
function resolveCredentials(cfg: OpenClawConfig): {
  baseUrl: string | undefined;
  apiKey: string | undefined;
  accountId: string | undefined;
} {
  const channelCfg = cfg.channels?.linkedin;
  const toolCfg = cfg.tools?.linkedin;

  return {
    baseUrl: channelCfg?.baseUrl ?? toolCfg?.baseUrl ?? process.env.UNIPILE_BASE_URL,
    apiKey: channelCfg?.apiKey ?? toolCfg?.apiKey ?? process.env.UNIPILE_API_KEY,
    accountId: channelCfg?.accountId ?? toolCfg?.accountId ?? process.env.UNIPILE_ACCOUNT_ID,
  };
}

/**
 * Resolve LinkedIn account from channels.linkedin config with credential fallback.
 */
function resolveLinkedInAccount(
  cfg: OpenClawConfig,
  _accountId?: string,
): ResolvedLinkedInAccount | null {
  const channelCfg = cfg.channels?.linkedin;
  const creds = resolveCredentials(cfg);

  if (!creds.baseUrl || !creds.apiKey || !creds.accountId) {
    return null;
  }

  // Channel settings come from channels.linkedin.dm
  const dmPolicy = channelCfg?.dm?.policy ?? "pairing";
  const allowFrom = channelCfg?.dm?.allowFrom?.map((item) => String(item)) ?? [];

  return {
    accountId: DEFAULT_ACCOUNT_ID,
    name: channelCfg?.name,
    enabled: channelCfg?.enabled !== false,
    baseUrl: creds.baseUrl,
    apiKey: creds.apiKey,
    unipileAccountId: creds.accountId,
    timeoutMs: channelCfg?.timeoutMs ?? cfg.tools?.linkedin?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    dmPolicy: dmPolicy === "disabled" ? "pairing" : dmPolicy,
    allowFrom,
    webhookSecret: channelCfg?.webhookSecret,
    webhookPath: channelCfg?.webhookPath,
    webhookBaseUrl: channelCfg?.webhookBaseUrl,
    pollInterval: channelCfg?.pollInterval,
  };
}

/**
 * Check if LinkedIn channel is enabled.
 */
function isLinkedInChannelEnabled(cfg: OpenClawConfig): boolean {
  const account = resolveLinkedInAccount(cfg);
  return account !== null && account.enabled;
}

/**
 * Normalize LinkedIn target ID (provider_id from Unipile).
 */
function normalizeLinkedInTarget(target: string): string | null {
  const trimmed = target?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

/**
 * Check if a string looks like a LinkedIn target ID.
 */
function looksLikeLinkedInTargetId(target: string): boolean {
  const trimmed = target?.trim();
  if (!trimmed) {
    return false;
  }
  return /^[a-zA-Z0-9_-]+$/.test(trimmed);
}

export const linkedInMessagingPlugin: ChannelPlugin<ResolvedLinkedInAccount> = {
  id: "linkedin",
  meta: {
    ...meta,
    label: "LinkedIn",
    order: 15,
    showConfigured: false,
    forceAccountBinding: true,
  },
  onboarding: linkedinOnboardingAdapter,
  pairing: {
    idLabel: "linkedinSenderId",
  },
  capabilities: {
    chatTypes: ["direct"],
    polls: false,
    reactions: false,
    media: true,
  },
  configSchema: buildChannelConfigSchema(LinkedInChannelConfigSchema),
  reload: { configPrefixes: ["channels.linkedin", "tools.linkedin"], noopPrefixes: [] },
  config: {
    listAccountIds: (_cfg) => [DEFAULT_ACCOUNT_ID],
    resolveAccount: (cfg, _accountId) => resolveLinkedInAccount(cfg, _accountId),
    defaultAccountId: (_cfg) => DEFAULT_ACCOUNT_ID,
    setAccountEnabled: ({ cfg, enabled }) => {
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          linkedin: {
            ...cfg.channels?.linkedin,
            enabled,
          },
        },
      };
    },
    deleteAccount: ({ cfg }) => {
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          linkedin: {
            ...cfg.channels?.linkedin,
            enabled: false,
          },
        },
      };
    },
    isEnabled: (account, cfg) => isLinkedInChannelEnabled(cfg) && account.enabled,
    disabledReason: () => "channel disabled",
    isConfigured: async (account) => Boolean(account.apiKey && account.unipileAccountId),
    unconfiguredReason: () => "not configured",
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.apiKey && account.unipileAccountId),
      dmPolicy: account.dmPolicy,
      allowFrom: account.allowFrom,
    }),
    resolveAllowFrom: ({ cfg }) => {
      const account = resolveLinkedInAccount(cfg);
      return account?.allowFrom ?? [];
    },
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter((entry): entry is string => Boolean(entry)),
  },
  security: {
    resolveDmPolicy: ({ account }) => {
      return {
        policy: account.dmPolicy ?? "pairing",
        allowFrom: account.allowFrom ?? [],
        policyPath: "channels.linkedin.dm.policy",
        allowFromPath: "channels.linkedin.dm.allowFrom",
        approveHint: formatPairingApproveHint("linkedin"),
        normalizeEntry: (raw) => normalizeLinkedInTarget(raw),
      };
    },
    collectWarnings: () => [],
  },
  messaging: {
    normalizeTarget: (raw) => normalizeLinkedInTarget(raw) ?? raw,
    targetResolver: {
      looksLikeId: looksLikeLinkedInTargetId,
      hint: "<linkedin_provider_id>",
    },
  },
  outbound: {
    deliveryMode: "gateway",
    chunker: (text, limit) => getLinkedInRuntime().channel.text.chunkText(text, limit),
    chunkerMode: "text",
    textChunkLimit: 4000,
    resolveTarget: ({ to, allowFrom, mode }) => {
      const trimmed = to?.trim() ?? "";
      const allowListRaw = (allowFrom ?? []).map((entry) => String(entry).trim()).filter(Boolean);
      const hasWildcard = allowListRaw.includes("*");
      const allowList = allowListRaw
        .filter((entry) => entry !== "*")
        .map((entry) => normalizeLinkedInTarget(entry))
        .filter((entry): entry is string => Boolean(entry));

      if (trimmed) {
        const normalizedTo = normalizeLinkedInTarget(trimmed);
        if (!normalizedTo) {
          if ((mode === "implicit" || mode === "heartbeat") && allowList.length > 0) {
            return { ok: true, to: allowList[0] };
          }
          return {
            ok: false,
            error: missingTargetError(
              "LinkedIn",
              "<provider_id> or channels.linkedin.allowFrom[0]",
            ),
          };
        }
        if (mode === "implicit" || mode === "heartbeat") {
          if (hasWildcard || allowList.length === 0) {
            return { ok: true, to: normalizedTo };
          }
          if (allowList.includes(normalizedTo)) {
            return { ok: true, to: normalizedTo };
          }
          return { ok: true, to: allowList[0] };
        }
        return { ok: true, to: normalizedTo };
      }

      if (allowList.length > 0) {
        return { ok: true, to: allowList[0] };
      }
      return {
        ok: false,
        error: missingTargetError("LinkedIn", "<provider_id> or channels.linkedin.allowFrom[0]"),
      };
    },
    sendText: async ({ to, text, cfg }) => {
      const account = resolveLinkedInAccount(cfg);
      if (!account) {
        throw new Error("LinkedIn account not configured");
      }

      const { startChat } = await import("../../../src/linkedin/client.js");

      const clientOpts = {
        baseUrl: account.baseUrl,
        apiKey: account.apiKey,
        accountId: account.unipileAccountId,
        timeoutMs: account.timeoutMs,
      };

      try {
        const result = await startChat(clientOpts, {
          attendees_ids: [to],
          text,
        });
        return {
          channel: "linkedin",
          ok: true,
          messageId: result.message_id ?? undefined,
          chatId: result.chat_id ?? undefined,
        };
      } catch (err) {
        throw err;
      }
    },
    sendMedia: async ({ to, text, mediaUrl, cfg }) => {
      const account = resolveLinkedInAccount(cfg);
      if (!account) {
        throw new Error("LinkedIn account not configured");
      }

      const { startChat } = await import("../../../src/linkedin/client.js");

      const clientOpts = {
        baseUrl: account.baseUrl,
        apiKey: account.apiKey,
        accountId: account.unipileAccountId,
        timeoutMs: account.timeoutMs,
      };

      const messageText = mediaUrl ? `${text}\n\n${mediaUrl}` : text;

      const result = await startChat(clientOpts, {
        attendees_ids: [to],
        text: messageText,
      });

      return {
        channel: "linkedin",
        ok: true,
        messageId: result.message_id ?? undefined,
        chatId: result.chat_id ?? undefined,
      };
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      connected: false,
      lastMessageAt: null,
      lastError: null,
    },
    collectStatusIssues: ({ account }) => {
      const issues: Array<{ level: "error" | "warn"; message: string }> = [];
      if (!account.apiKey || !account.unipileAccountId) {
        issues.push({
          level: "error",
          message: "LinkedIn credentials not configured (channels.linkedin or tools.linkedin)",
        });
      }
      if (!account.enabled) {
        issues.push({
          level: "warn",
          message: "LinkedIn channel is disabled",
        });
      }
      return issues;
    },
    buildChannelSummary: async ({ account, snapshot }) => {
      return {
        configured: Boolean(account.apiKey && account.unipileAccountId),
        running: snapshot.running ?? false,
        connected: snapshot.connected ?? false,
        lastMessageAt: snapshot.lastMessageAt ?? null,
        lastError: snapshot.lastError ?? null,
      };
    },
    buildAccountSnapshot: async ({ account, runtime }) => {
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: Boolean(account.apiKey && account.unipileAccountId),
        running: runtime?.running ?? false,
        connected: runtime?.connected ?? false,
        lastMessageAt: runtime?.lastMessageAt ?? null,
        lastError: runtime?.lastError ?? null,
        dmPolicy: account.dmPolicy,
        allowFrom: account.allowFrom,
      };
    },
    resolveAccountState: ({ configured }) => (configured ? "ready" : "not configured"),
  },
  gateway: {
    startAccount: async (ctx: ChannelGatewayContext<ResolvedLinkedInAccount>) => {
      const account = ctx.account;
      const config = ctx.cfg; // NOTE: It's ctx.cfg, not ctx.config!
      ctx.log?.info(`[${account.accountId}] starting LinkedIn messaging provider`);

      const { processLinkedInMessage } = await import("./webhook-handler.js");
      const { startLinkedInPolling } = await import("../../../src/linkedin/polling.js");

      // Build client options for Unipile API
      const clientOpts = {
        baseUrl: account.baseUrl,
        apiKey: account.apiKey,
        accountId: account.unipileAccountId,
        timeoutMs: account.timeoutMs,
      };

      // Start polling mode (more reliable than webhooks)
      const pollInterval = account.pollInterval ?? 30;
      ctx.log?.info(
        `[${account.accountId}] starting LinkedIn polling mode (interval: ${pollInterval}s)`,
      );

      startLinkedInPolling({
        clientOpts,
        config,
        accountId: account.accountId,
        pollInterval,
        abortSignal: ctx.abortSignal,
        onMessage: async (payload) => {
          await processLinkedInMessage(payload, account, config);
        },
        log: (msg) => ctx.log?.info(msg),
      });

      ctx.setStatus({
        accountId: ctx.accountId,
        running: true,
        connected: true,
        lastError: null,
      });

      return new Promise<void>((resolve) => {
        ctx.abortSignal?.addEventListener("abort", () => {
          ctx.log?.info(`[${account.accountId}] stopping LinkedIn messaging provider`);
          ctx.setStatus({
            accountId: ctx.accountId,
            running: false,
            connected: false,
          });
          resolve();
        });
      });
    },
  },
};
