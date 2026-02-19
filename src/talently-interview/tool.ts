/**
 * Talently Interview Tool
 *
 * Agent tool for creating quick interviews with Zoom meetings and calendar events.
 */

import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../agents/tools/common.js";
import { jsonResult, readStringParam, readNumberParam } from "../agents/tools/common.js";
import type { OpenClawConfig } from "../config/config.js";
import { buildClientOptions, createQuickInterview } from "./client.js";
import { resolveTalentlyInterviewConfig, getMissingCredentials } from "./config.js";
import type { QuickInterviewRequest } from "./types.js";

// =============================================================================
// Tool Schema
// =============================================================================

const TalentlyInterviewSchema = Type.Object({
  interviewer_email: Type.String({
    description: "Email address of the interviewer",
  }),
  candidate_email: Type.String({
    description: "Email address of the candidate",
  }),
  scheduled_at: Type.String({
    description: "Interview date/time in ISO 8601 format (e.g. '2025-03-15T14:00:00Z')",
  }),
  interview_title: Type.Optional(
    Type.String({
      description: "Title for the interview. Defaults to 'Interview - {candidate_email}'",
    }),
  ),
  duration_minutes: Type.Optional(
    Type.Number({
      description: "Duration of the interview in minutes. Default: 60",
      minimum: 15,
      maximum: 480,
    }),
  ),
});

// =============================================================================
// Tool Factory
// =============================================================================

/**
 * Create the Talently Interview tool.
 *
 * Requires TALENTLY_INTERVIEW_API_URL (or TALENTLY_CV_ANALYSIS_API_URL) environment variable
 * or tools.talentlyInterview.apiUrl config.
 */
export function createTalentlyInterviewTool(options?: {
  config?: OpenClawConfig;
}): AnyAgentTool | null {
  const cfg = options?.config;
  const resolvedConfig = resolveTalentlyInterviewConfig(cfg ?? ({} as OpenClawConfig));

  if (!resolvedConfig.enabled) {
    return null;
  }

  const clientOpts = buildClientOptions(resolvedConfig);

  // Build description with configured interviewers
  let description =
    "Create a quick interview with automatic Zoom meeting and Google Calendar event. " +
    "Requires interviewer email, candidate email, and scheduled time. " +
    "Returns the Zoom meeting link and calendar event link.";

  if (resolvedConfig.interviewerEmails.length > 0) {
    description += ` Available interviewers: ${resolvedConfig.interviewerEmails.join(", ")}.`;
  }

  return {
    label: "Talently Interview",
    name: "talently_interview",
    description,
    parameters: TalentlyInterviewSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;

      if (!clientOpts) {
        const missing = getMissingCredentials(resolvedConfig);
        return jsonResult({
          success: false,
          error: `Talently Interview not configured. Missing: ${missing.join(", ")}`,
          configuration_help:
            "Set apiUrl in tools.talentlyInterview or TALENTLY_INTERVIEW_API_URL env var.",
        });
      }

      const interviewerEmail = readStringParam(params, "interviewer_email", { required: true });
      const candidateEmail = readStringParam(params, "candidate_email", { required: true });
      const scheduledAt = readStringParam(params, "scheduled_at", { required: true });
      const interviewTitle = readStringParam(params, "interview_title");
      const durationMinutes = readNumberParam(params, "duration_minutes", { integer: true });

      const requestData: QuickInterviewRequest = {
        interviewer_email: interviewerEmail,
        candidate_email: candidateEmail,
        scheduled_at: scheduledAt,
      };

      if (interviewTitle) {
        requestData.interview_title = interviewTitle;
      }
      if (durationMinutes) {
        requestData.duration_minutes = durationMinutes;
      }

      try {
        const result = await createQuickInterview(clientOpts, requestData);

        return jsonResult({
          success: true,
          meeting_link: result.meeting_link,
          meeting_passcode: result.meeting_passcode,
          calendar_event_link: result.calendar_event_link,
          scheduled_at: result.scheduled_at,
          duration_minutes: result.duration_minutes,
          title: result.title,
          status: result.status,
          participants: result.participants,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);

        if (errorMessage.includes("AbortError") || errorMessage.includes("aborted")) {
          return jsonResult({
            success: false,
            error: `Talently Interview request timed out after ${resolvedConfig.timeoutMs}ms`,
          });
        }

        return jsonResult({
          success: false,
          error: `Talently Interview creation failed: ${errorMessage}`,
        });
      }
    },
  };
}
