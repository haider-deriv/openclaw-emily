/**
 * ElevenLabs Agents - Talently Interview Integration
 *
 * Creates interviews via the Talently API when ElevenLabs calls complete
 * with candidate email and interview time data.
 */

import type { OpenClawConfig } from "../config/config.js";
import { buildClientOptions, createQuickInterview } from "../talently-interview/client.js";
import {
  resolveTalentlyInterviewConfig,
  type ResolvedTalentlyInterviewConfig,
} from "../talently-interview/config.js";
import type { QuickInterviewResponse } from "../talently-interview/types.js";

export type CreateTalentlyInterviewParams = {
  candidateName: string;
  candidateEmail: string;
  /** ISO 8601 timestamp for the interview */
  interviewTimestamp: string;
  /** Conversation ID for reference in the title */
  conversationId?: string;
};

export type CreateTalentlyInterviewResult =
  | {
      ok: true;
      meetingLink: string;
      meetingPasscode?: string;
      calendarEventLink?: string;
      scheduledAt: string;
      durationMinutes: number;
    }
  | {
      ok: false;
      error: string;
    };

/**
 * Resolve Talently Interview config from OpenClaw config.
 */
export function resolveTalentlyConfig(cfg: OpenClawConfig): ResolvedTalentlyInterviewConfig {
  return resolveTalentlyInterviewConfig(cfg);
}

/**
 * Check if Talently Interview is configured.
 */
export function isTalentlyInterviewConfigured(cfg: OpenClawConfig): boolean {
  const config = resolveTalentlyInterviewConfig(cfg);
  return Boolean(config.enabled && config.apiUrl && config.interviewerEmails.length > 0);
}

/**
 * Create an interview via the Talently API.
 * Returns Zoom meeting link and calendar event link.
 */
export async function createTalentlyInterview(
  cfg: OpenClawConfig,
  params: CreateTalentlyInterviewParams,
  log: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<CreateTalentlyInterviewResult> {
  const config = resolveTalentlyInterviewConfig(cfg);

  if (!config.enabled || !config.apiUrl) {
    return {
      ok: false,
      error: "Talently Interview not configured (missing apiUrl)",
    };
  }

  if (config.interviewerEmails.length === 0) {
    return {
      ok: false,
      error: "No interviewer emails configured in tools.talentlyInterview.interviewerEmails",
    };
  }

  const clientOpts = buildClientOptions(config);
  if (!clientOpts) {
    return {
      ok: false,
      error: "Failed to build Talently Interview client options",
    };
  }

  // Use first configured interviewer email
  const interviewerEmail = config.interviewerEmails[0];

  // Build interview title
  const title = params.conversationId
    ? `Interview with ${params.candidateName} (from call ${params.conversationId})`
    : `Interview with ${params.candidateName}`;

  log.info(
    `[talently-interview] Creating interview: ${params.candidateEmail} at ${params.interviewTimestamp}`,
  );

  try {
    const result: QuickInterviewResponse = await createQuickInterview(clientOpts, {
      interviewer_email: interviewerEmail,
      candidate_email: params.candidateEmail,
      scheduled_at: params.interviewTimestamp,
      interview_title: title,
      duration_minutes: 30,
    });

    log.info(`[talently-interview] Created: ${result.meeting_link}`);

    return {
      ok: true,
      meetingLink: result.meeting_link,
      meetingPasscode: result.meeting_passcode,
      calendarEventLink: result.calendar_event_link,
      scheduledAt: result.scheduled_at,
      durationMinutes: result.duration_minutes,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.warn(`[talently-interview] Failed: ${errorMessage}`);
    return {
      ok: false,
      error: `Talently Interview API error: ${errorMessage}`,
    };
  }
}
