/**
 * Talently CV Analysis Tool
 *
 * Agent tool for submitting CVs for batch analysis.
 */

import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../agents/tools/common.js";
import type { OpenClawConfig } from "../config/config.js";
import { jsonResult, readStringArrayParam, readNumberParam } from "../agents/tools/common.js";
import { buildClientOptions, submitCVsForAnalysis } from "./client.js";
import { resolveTalentlyCVAnalysisConfig, getMissingCredentials } from "./config.js";

// =============================================================================
// Tool Schema
// =============================================================================

const TalentlyCVAnalysisSchema = Type.Object({
  cv_paths: Type.Array(
    Type.String({
      description: "Absolute path to a CV PDF file",
    }),
    {
      description: "Array of absolute paths to CV PDF files to analyze",
    },
  ),
  target_level: Type.Optional(
    Type.Number({
      description: "Target level for calibration (1-7)",
      minimum: 1,
      maximum: 7,
    }),
  ),
  is_manager: Type.Optional(
    Type.Boolean({
      description: "Whether evaluating for a manager role",
    }),
  ),
});

// =============================================================================
// Tool Factory
// =============================================================================

/**
 * Create the Talently CV Analysis tool.
 *
 * Requires TALENTLY_CV_ANALYSIS_API_URL environment variable or tools.talentlyCvAnalysis.apiUrl config.
 */
export function createTalentlyCVAnalysisTool(options?: {
  config?: OpenClawConfig;
}): AnyAgentTool | null {
  const cfg = options?.config;
  const resolvedConfig = resolveTalentlyCVAnalysisConfig(cfg ?? ({} as OpenClawConfig));

  // Return null if explicitly disabled
  if (!resolvedConfig.enabled) {
    return null;
  }

  // Build client options (may be undefined if missing credentials)
  const clientOpts = buildClientOptions(resolvedConfig);

  return {
    label: "Talently CV Analysis",
    name: "talently_cv_analysis",
    description:
      "Submit CV files for batch analysis. Uploads CVs to the Talently analysis service and returns " +
      "a job ID. The candidates will be processed and added to the system. " +
      "Provide absolute paths to PDF files.",
    parameters: TalentlyCVAnalysisSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;

      // Check if client is configured
      if (!clientOpts) {
        const missing = getMissingCredentials(resolvedConfig);
        return jsonResult({
          success: false,
          error: `Talently CV Analysis not configured. Missing: ${missing.join(", ")}`,
          configuration_help:
            "Set apiUrl in tools.talentlyCvAnalysis or TALENTLY_CV_ANALYSIS_API_URL env var. " +
            "Set apiKey in tools.talentlyCvAnalysis or TALENTLY_CV_ANALYSIS_API_KEY env var.",
        });
      }

      // Parse parameters
      const cvPaths = readStringArrayParam(params, "cv_paths", { required: true });
      const targetLevel = readNumberParam(params, "target_level", { integer: true });
      const isManager = typeof params.is_manager === "boolean" ? params.is_manager : undefined;

      try {
        const result = await submitCVsForAnalysis(clientOpts, {
          cvPaths,
          targetLevel,
          isManager,
        });

        return jsonResult({
          success: true,
          job_id: result.job_id,
          total: result.total,
          message: result.message,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);

        // Check for specific error types
        if (errorMessage.includes("AbortError") || errorMessage.includes("aborted")) {
          return jsonResult({
            success: false,
            error: `Talently CV Analysis request timed out after ${resolvedConfig.timeoutMs}ms`,
          });
        }

        return jsonResult({
          success: false,
          error: `Talently CV Analysis failed: ${errorMessage}`,
        });
      }
    },
  };
}
