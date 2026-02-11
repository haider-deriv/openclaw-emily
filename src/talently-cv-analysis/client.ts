/**
 * Talently CV Analysis Tool - HTTP Client
 *
 * HTTP client for the CV Analysis API.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { ResolvedTalentlyCVAnalysisConfig } from "./config.js";
import type { BatchJobCreateResponse } from "./types.js";

// =============================================================================
// Client Options
// =============================================================================

export type TalentlyCVAnalysisClientOptions = {
  apiUrl: string;
  authToken?: string;
  timeoutMs: number;
};

/**
 * Build client options from resolved config.
 * Returns undefined if required config is missing.
 */
export function buildClientOptions(
  config: ResolvedTalentlyCVAnalysisConfig,
): TalentlyCVAnalysisClientOptions | undefined {
  if (!config.apiUrl) {
    return undefined;
  }
  return {
    apiUrl: config.apiUrl,
    authToken: config.authToken,
    timeoutMs: config.timeoutMs,
  };
}

// =============================================================================
// API Functions
// =============================================================================

/**
 * Submit CVs for batch analysis.
 *
 * POST /analyze/batch (multipart/form-data)
 */
export async function submitCVsForAnalysis(
  opts: TalentlyCVAnalysisClientOptions,
  params: {
    cvPaths: string[];
    targetLevel?: number;
    isManager?: boolean;
  },
): Promise<BatchJobCreateResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    // Build multipart form data
    const formData = new FormData();

    // Add each CV file
    for (const cvPath of params.cvPaths) {
      const fileBuffer = await fs.readFile(cvPath);
      const fileName = path.basename(cvPath);
      const blob = new Blob([fileBuffer], { type: "application/pdf" });
      formData.append("files", blob, fileName);
    }

    // Add optional parameters
    if (params.targetLevel !== undefined) {
      formData.append("target_level", String(params.targetLevel));
    }
    if (params.isManager !== undefined) {
      formData.append("is_manager", String(params.isManager));
    }

    // Build headers
    const headers: Record<string, string> = {};
    if (opts.authToken) {
      headers["Authorization"] = `Bearer ${opts.authToken}`;
    }

    // Make request
    const response = await fetch(`${opts.apiUrl}/analyze/batch`, {
      method: "POST",
      headers,
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`Talently CV Analysis API error (${response.status}): ${errorText}`);
    }

    const result = (await response.json()) as BatchJobCreateResponse;
    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}
