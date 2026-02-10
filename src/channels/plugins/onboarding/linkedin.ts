/**
 * LinkedIn Messaging Channel Onboarding Adapter
 *
 * Handles onboarding for LinkedIn messaging channel.
 * - Channel config: channels.linkedin.* (dmPolicy, allowFrom, webhookSecret)
 * - Credentials: channels.linkedin.* OR tools.linkedin.* OR env vars (fallback)
 */

import type { OpenClawConfig } from "../../../config/config.js";
import type { DmPolicy } from "../../../config/types.js";
import type { WizardPrompter } from "../../../wizard/prompts.js";
import type { ChannelOnboardingAdapter, ChannelOnboardingDmPolicy } from "../onboarding-types.js";
import { formatDocsLink } from "../../../terminal/links.js";
import { addWildcardAllowFrom } from "./helpers.js";

const channel = "linkedin" as const;

/**
 * Resolve LinkedIn credentials from multiple sources (channel > tool > env).
 */
function resolveLinkedInCredentials(cfg: OpenClawConfig): {
  baseUrl: string | undefined;
  apiKey: string | undefined;
  accountId: string | undefined;
  source: "channel" | "tool" | "env" | "none";
} {
  // First check channels.linkedin
  const channelCfg = cfg.channels?.linkedin;
  if (channelCfg?.baseUrl && channelCfg?.apiKey && channelCfg?.accountId) {
    return {
      baseUrl: channelCfg.baseUrl,
      apiKey: channelCfg.apiKey,
      accountId: channelCfg.accountId,
      source: "channel",
    };
  }

  // Then check tools.linkedin (shared with talent search)
  const toolCfg = cfg.tools?.linkedin;
  if (toolCfg?.baseUrl && toolCfg?.apiKey && toolCfg?.accountId) {
    return {
      baseUrl: toolCfg.baseUrl,
      apiKey: toolCfg.apiKey,
      accountId: toolCfg.accountId,
      source: "tool",
    };
  }

  // Finally check environment variables
  const envBaseUrl = process.env.UNIPILE_BASE_URL;
  const envApiKey = process.env.UNIPILE_API_KEY;
  const envAccountId = process.env.UNIPILE_ACCOUNT_ID;
  if (envBaseUrl && envApiKey && envAccountId) {
    return {
      baseUrl: envBaseUrl,
      apiKey: envApiKey,
      accountId: envAccountId,
      source: "env",
    };
  }

  return {
    baseUrl: channelCfg?.baseUrl ?? toolCfg?.baseUrl ?? envBaseUrl,
    apiKey: channelCfg?.apiKey ?? toolCfg?.apiKey ?? envApiKey,
    accountId: channelCfg?.accountId ?? toolCfg?.accountId ?? envAccountId,
    source: "none",
  };
}

/**
 * Check if LinkedIn credentials are configured from any source.
 */
function isLinkedInConfigured(cfg: OpenClawConfig): boolean {
  const creds = resolveLinkedInCredentials(cfg);
  return creds.source !== "none";
}

/**
 * Check if LinkedIn channel is enabled.
 */
function isLinkedInChannelEnabled(cfg: OpenClawConfig): boolean {
  return cfg.channels?.linkedin?.enabled !== false && isLinkedInConfigured(cfg);
}

/**
 * Set LinkedIn channel DM policy.
 */
function setLinkedInDmPolicy(cfg: OpenClawConfig, dmPolicy: DmPolicy): OpenClawConfig {
  // LinkedIn only supports open, pairing, allowlist (not "disabled")
  const validPolicy = dmPolicy === "disabled" ? "pairing" : dmPolicy;
  const rawAllowFrom =
    validPolicy === "open"
      ? addWildcardAllowFrom(cfg.channels?.linkedin?.dm?.allowFrom)
      : undefined;
  // Ensure allowFrom is string[]
  const allowFrom = rawAllowFrom?.map((item) => String(item));
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      linkedin: {
        ...cfg.channels?.linkedin,
        enabled: dmPolicy !== "disabled",
        dm: {
          ...cfg.channels?.linkedin?.dm,
          policy: validPolicy,
          ...(allowFrom ? { allowFrom } : {}),
        },
      },
    },
  };
}

/**
 * Show help for getting Unipile credentials.
 */
async function noteLinkedInCredentialsHelp(prompter: WizardPrompter): Promise<void> {
  await prompter.note(
    [
      "LinkedIn messaging uses the Unipile API.",
      "",
      "1) Sign up at https://unipile.com",
      "2) Connect your LinkedIn account in the Unipile dashboard",
      "3) Get your API key and account ID from the dashboard",
      "",
      "You'll need:",
      "- Base URL (e.g., api1.unipile.com:13111)",
      "- API Key",
      "- Account ID (your LinkedIn account on Unipile)",
      "",
      "Tip: Credentials can come from:",
      "  1. channels.linkedin.* (this channel)",
      "  2. tools.linkedin.* (shared with talent search)",
      "  3. Environment variables (UNIPILE_BASE_URL, UNIPILE_API_KEY, UNIPILE_ACCOUNT_ID)",
      "",
      `Docs: ${formatDocsLink("/linkedin")}`,
    ].join("\n"),
    "LinkedIn credentials (Unipile)",
  );
}

/**
 * Prompt for LinkedIn allowFrom list.
 */
async function promptLinkedInAllowFrom(params: {
  cfg: OpenClawConfig;
  prompter: WizardPrompter;
}): Promise<OpenClawConfig> {
  const { cfg, prompter } = params;
  const existingAllowFrom = cfg.channels?.linkedin?.dm?.allowFrom ?? [];

  await prompter.note(
    [
      "Enter LinkedIn provider IDs to allow messages from.",
      "Provider IDs are assigned by Unipile when users message you.",
      "",
      "You can find sender IDs in the webhook payload or chat attendees.",
      "Use '*' to allow all senders (not recommended for production).",
    ].join("\n"),
    "LinkedIn allowFrom",
  );

  const entry = await prompter.text({
    message: "LinkedIn allowFrom (provider ID or *)",
    placeholder: "*",
    initialValue: existingAllowFrom[0] ? String(existingAllowFrom[0]) : "*",
  });

  const ids = String(entry)
    .split(/[\n,;]+/g)
    .map((e) => e.trim())
    .filter(Boolean);

  const merged = [...existingAllowFrom.map((item) => String(item).trim()).filter(Boolean), ...ids];
  const unique = [...new Set(merged)];

  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      linkedin: {
        ...cfg.channels?.linkedin,
        enabled: true,
        dm: {
          ...cfg.channels?.linkedin?.dm,
          policy: "allowlist",
          allowFrom: unique,
        },
      },
    },
  };
}

const dmPolicy: ChannelOnboardingDmPolicy = {
  label: "LinkedIn",
  channel,
  policyKey: "channels.linkedin.dm.policy",
  allowFromKey: "channels.linkedin.dm.allowFrom",
  getCurrent: (cfg) => cfg.channels?.linkedin?.dm?.policy ?? "pairing",
  setPolicy: (cfg, policy) => setLinkedInDmPolicy(cfg, policy),
  promptAllowFrom: promptLinkedInAllowFrom,
};

export const linkedinOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,
  getStatus: async ({ cfg }) => {
    const configured = isLinkedInConfigured(cfg);
    const channelEnabled = isLinkedInChannelEnabled(cfg);
    const creds = resolveLinkedInCredentials(cfg);
    const sourceHint =
      creds.source === "tool"
        ? " (from tools.linkedin)"
        : creds.source === "env"
          ? " (from env vars)"
          : "";
    return {
      channel,
      configured,
      statusLines: [
        `LinkedIn: ${configured ? (channelEnabled ? `configured${sourceHint}` : "credentials only") : "needs Unipile credentials"}`,
      ],
      selectionHint: configured ? "configured" : "requires Unipile account",
      quickstartScore: configured ? 5 : 20,
    };
  },
  configure: async ({ cfg, prompter, forceAllowFrom }) => {
    let next = cfg;

    // Check credential sources
    const creds = resolveLinkedInCredentials(cfg);
    const hasCredentials = creds.source !== "none";

    if (!hasCredentials) {
      await noteLinkedInCredentialsHelp(prompter);

      // Check if env vars exist but are incomplete
      const hasPartialEnv =
        process.env.UNIPILE_BASE_URL ||
        process.env.UNIPILE_API_KEY ||
        process.env.UNIPILE_ACCOUNT_ID;

      if (hasPartialEnv) {
        await prompter.note(
          "Some Unipile environment variables detected but incomplete.",
          "Environment",
        );
      }

      // Prompt for credentials - store in channels.linkedin for channel-specific use
      next = await promptLinkedInChannelCredentials(next, prompter);
    } else {
      // Credentials exist from some source
      const sourceDesc =
        creds.source === "tool"
          ? "tools.linkedin (shared with talent search)"
          : creds.source === "env"
            ? "environment variables"
            : "channels.linkedin";

      const keep = await prompter.confirm({
        message: `LinkedIn credentials found in ${sourceDesc}. Use these?`,
        initialValue: true,
      });

      if (!keep) {
        // User wants to specify channel-specific credentials
        next = await promptLinkedInChannelCredentials(next, prompter);
      } else {
        // Just enable the channel, credentials come from existing source
        next = {
          ...next,
          channels: {
            ...next.channels,
            linkedin: {
              ...next.channels?.linkedin,
              enabled: true,
            },
          },
        };
      }
    }

    // Prompt for allowFrom if needed
    if (forceAllowFrom) {
      next = await promptLinkedInAllowFrom({ cfg: next, prompter });
    }

    return { cfg: next, accountId: "default" };
  },
  dmPolicy,
  disable: (cfg) => ({
    ...cfg,
    channels: {
      ...cfg.channels,
      linkedin: {
        ...cfg.channels?.linkedin,
        enabled: false,
      },
    },
  }),
};

/**
 * Prompt for LinkedIn/Unipile credentials (stored in channels.linkedin).
 */
async function promptLinkedInChannelCredentials(
  cfg: OpenClawConfig,
  prompter: WizardPrompter,
): Promise<OpenClawConfig> {
  // Get existing values from any source for defaults
  const existing = resolveLinkedInCredentials(cfg);

  const baseUrl = await prompter.text({
    message: "Unipile base URL",
    placeholder: "api1.unipile.com:13111",
    initialValue: existing.baseUrl ?? "api1.unipile.com:13111",
    validate: (value) => (value?.trim() ? undefined : "Required"),
  });

  const apiKey = await prompter.text({
    message: "Unipile API key",
    placeholder: "your-api-key",
    initialValue: existing.apiKey,
    validate: (value) => (value?.trim() ? undefined : "Required"),
  });

  const accountId = await prompter.text({
    message: "LinkedIn account ID (from Unipile)",
    placeholder: "your-account-id",
    initialValue: existing.accountId,
    validate: (value) => (value?.trim() ? undefined : "Required"),
  });

  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      linkedin: {
        ...cfg.channels?.linkedin,
        enabled: true,
        baseUrl: String(baseUrl).trim(),
        apiKey: String(apiKey).trim(),
        accountId: String(accountId).trim(),
      },
    },
  };
}
