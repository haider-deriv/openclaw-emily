/**
 * Talently Interview Tool - API Client
 *
 * HTTP client for the Quick Interview API.
 */

import type { ResolvedTalentlyInterviewConfig } from "./config.js";
import type { QuickInterviewRequest, QuickInterviewResponse } from "./types.js";

export type TalentlyInterviewClientOptions = {
  apiUrl: string;
  apiKey?: string;
  timeoutMs: number;
};

/**
 * Build client options from resolved config.
 * Returns null if required credentials are missing.
 */
export function buildClientOptions(
  config: ResolvedTalentlyInterviewConfig,
): TalentlyInterviewClientOptions | null {
  if (!config.apiUrl) {
    return null;
  }

  return {
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs,
  };
}

/**
 * Create a quick interview via the Talently API.
 * Creates Zoom meeting and Google Calendar event without DB storage.
 */
export async function createQuickInterview(
  opts: TalentlyInterviewClientOptions,
  data: QuickInterviewRequest,
): Promise<QuickInterviewResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (opts.apiKey) {
      headers["X-API-Key"] = opts.apiKey;
    }

    const res = await fetch(`${opts.apiUrl}/interviews/quick`, {
      method: "POST",
      headers,
      body: JSON.stringify(data),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      throw new Error(`Interview API error (${res.status}): ${errorText}`);
    }

    return (await res.json()) as QuickInterviewResponse;
  } finally {
    clearTimeout(timeout);
  }
}
