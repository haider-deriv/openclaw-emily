/**
 * ElevenLabs Agents - Google Calendar Integration
 *
 * Send calendar invites and confirmation emails via gog CLI.
 */

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { OpenClawConfig } from "../config/config.js";
import { EmailTemplateType } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Map template type to file name */
const TEMPLATE_FILES: Record<EmailTemplateType, string> = {
  [EmailTemplateType.INTERVIEW_CONFIRMATION]: "interview-confirmation.html",
  [EmailTemplateType.FOLLOW_UP]: "follow-up.html",
  [EmailTemplateType.RESCHEDULE]: "reschedule.html",
};

/**
 * Parse email template type from data collection value.
 * Returns undefined if value doesn't match any known template type.
 */
export function parseEmailTemplateType(value: unknown): EmailTemplateType | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  const validValues = Object.values(EmailTemplateType) as string[];
  if (validValues.includes(normalized)) {
    return normalized as EmailTemplateType;
  }
  return undefined;
}

const execFileAsync = promisify(execFile);

const INTERVIEW_DURATION_MINUTES = 30;

export type SendInterviewInviteParams = {
  candidateName: string;
  candidateEmail: string;
  /** ISO 8601 timestamp for the interview start time (optional - skip calendar if not provided) */
  interviewTimestamp?: string;
  /** Calendar ID (default: "primary") */
  calendarId: string;
  /** Conversation ID for reference */
  conversationId?: string;
  /** Email template type (default: INTERVIEW_CONFIRMATION) */
  templateType?: EmailTemplateType;
  /** Zoom/meeting link to include in the email */
  meetingLink?: string;
  /** Meeting passcode to include in the email */
  meetingPasscode?: string;
  /** Skip calendar creation (e.g., when Talently already created it) */
  skipCalendar?: boolean;
};

export type SendInterviewInviteResult = {
  ok: boolean;
  error?: string;
  calendarEventCreated?: boolean;
  emailSent?: boolean;
};

/**
 * Resolve gog environment variables from config or process environment.
 */
export function resolveGogEnv(cfg: OpenClawConfig): Record<string, string> | undefined {
  const skillsGogEnv = cfg.skills?.entries?.gog?.env;
  const gogEnv: Record<string, string> = {};

  // GOG_ACCOUNT
  const account = (skillsGogEnv?.GOG_ACCOUNT as string)?.trim() || process.env.GOG_ACCOUNT?.trim();
  if (!account) {
    return undefined; // No account configured
  }
  gogEnv.GOG_ACCOUNT = account;

  // GOG_KEYRING_BACKEND (file backend for non-interactive use)
  const keyringBackend =
    (skillsGogEnv?.GOG_KEYRING_BACKEND as string)?.trim() ||
    process.env.GOG_KEYRING_BACKEND?.trim();
  if (keyringBackend) {
    gogEnv.GOG_KEYRING_BACKEND = keyringBackend;
  }

  // GOG_KEYRING_PASSWORD (for file backend)
  const keyringPassword =
    (skillsGogEnv?.GOG_KEYRING_PASSWORD as string) || process.env.GOG_KEYRING_PASSWORD;
  if (keyringPassword) {
    gogEnv.GOG_KEYRING_PASSWORD = keyringPassword;
  }

  return gogEnv;
}

/**
 * Resolve the gog account from config or environment.
 */
export function resolveGogAccount(cfg: OpenClawConfig): string | undefined {
  const gogEnv = resolveGogEnv(cfg);
  return gogEnv?.GOG_ACCOUNT;
}

/**
 * Format a date for display in email.
 */
function formatDateForEmail(date: Date): { date: string; time: string } {
  const dateStr = date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return { date: dateStr, time: timeStr };
}

/**
 * Calculate end time by adding duration to start time.
 */
function calculateEndTime(startIso: string, durationMinutes: number): string {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  return end.toISOString();
}

/**
 * Load and populate the email template with values.
 */
function buildEmailHtml(
  templateType: EmailTemplateType,
  params: {
    candidateName: string;
    interviewDate: string;
    interviewTime: string;
    meetingLink?: string;
    meetingPasscode?: string;
  },
): string {
  const templateFile =
    TEMPLATE_FILES[templateType] ?? TEMPLATE_FILES[EmailTemplateType.INTERVIEW_CONFIRMATION];
  const templatePath = join(__dirname, "templates", templateFile);
  let template: string;

  try {
    template = readFileSync(templatePath, "utf-8");
  } catch {
    // Fallback to inline template if file not found
    template = `<p>Hi {{candidate_name}},</p>
<p>Your interview has been scheduled for <strong>{{interview_date}}</strong> at <strong>{{interview_time}}</strong>.</p>
{{meeting_details}}
<p>You will also receive a calendar invite with these details.</p>
<p>Best regards,<br>The Team</p>`;
  }

  // Build meeting details block
  let meetingDetails = "";
  if (params.meetingLink) {
    meetingDetails = `<p><strong>Join the meeting:</strong><br /><a href="${params.meetingLink}">${params.meetingLink}</a>`;
    if (params.meetingPasscode) {
      meetingDetails += `<br />Passcode: ${params.meetingPasscode}`;
    }
    meetingDetails += "</p>";
  }

  return template
    .replace(/\{\{candidate_name\}\}/g, params.candidateName)
    .replace(/\{\{interview_date\}\}/g, params.interviewDate)
    .replace(/\{\{interview_time\}\}/g, params.interviewTime)
    .replace(/\{\{meeting_details\}\}/g, meetingDetails);
}

/**
 * Get shell config for running commands (like the agent does).
 */
function getShellConfig(): { shell: string; args: string[] } {
  const envShell = process.env.SHELL?.trim();
  const shell = envShell && envShell.length > 0 ? envShell : "/bin/sh";
  return { shell, args: ["-l", "-c"] }; // -l for login shell to get full env
}

/**
 * Escape a string for shell usage.
 */
function shellEscape(str: string): string {
  // Use single quotes and escape any single quotes within
  return `'${str.replace(/'/g, "'\"'\"'")}'`;
}

/**
 * Execute gog CLI command through a login shell (like the agent does).
 * This ensures access to keychain credentials and full PATH.
 */
async function runGogCommand(
  args: string[],
  gogEnv: Record<string, string>,
  log: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<{ ok: boolean; stdout: string; stderr: string; error?: string }> {
  const { shell, args: shellArgs } = getShellConfig();

  // Build the full command string
  const gogCmd = ["gog", ...args.map(shellEscape)].join(" ");
  const cmdStr = gogCmd;
  log.info(`[gog] Running: ${cmdStr}`);
  log.info(`[gog] Account: ${gogEnv.GOG_ACCOUNT}`);
  log.info(`[gog] Shell: ${shell} ${shellArgs.join(" ")}`);
  if (gogEnv.GOG_KEYRING_BACKEND) {
    log.info(`[gog] Keyring backend: ${gogEnv.GOG_KEYRING_BACKEND}`);
  }

  try {
    const { stdout, stderr } = await execFileAsync(shell, [...shellArgs, gogCmd], {
      env: { ...process.env, ...gogEnv },
      timeout: 30000, // 30 second timeout
    });
    if (stdout) {
      log.info(`[gog] stdout: ${stdout.trim()}`);
    }
    if (stderr) {
      log.warn(`[gog] stderr: ${stderr.trim()}`);
    }
    return { ok: true, stdout, stderr };
  } catch (err) {
    const error = err as Error & { stdout?: string; stderr?: string; code?: string };
    log.warn(`[gog] Command failed: ${error.message}`);
    if (error.stdout) {
      log.warn(`[gog] stdout: ${error.stdout.trim()}`);
    }
    if (error.stderr) {
      log.warn(`[gog] stderr: ${error.stderr.trim()}`);
    }
    if (error.code) {
      log.warn(`[gog] Exit code: ${error.code}`);
    }
    return {
      ok: false,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      error: error.message,
    };
  }
}

/**
 * Send interview invite via Google Calendar and/or confirmation email via Gmail.
 * Calendar invite is only created if interviewTimestamp is provided.
 */
export async function sendInterviewInvite(
  params: SendInterviewInviteParams,
  gogEnv: Record<string, string>,
  log: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<SendInterviewInviteResult> {
  const {
    candidateName,
    candidateEmail,
    interviewTimestamp,
    calendarId,
    conversationId,
    templateType = EmailTemplateType.INTERVIEW_CONFIRMATION,
    meetingLink,
    meetingPasscode,
    skipCalendar = false,
  } = params;

  let calendarEventCreated = false;
  let emailSent = false;
  let interviewDate = "";
  let interviewTime = "";

  // 1. Create calendar event (only if timestamp provided and not skipped)
  if (interviewTimestamp && !skipCalendar) {
    const startDate = new Date(interviewTimestamp);
    if (isNaN(startDate.getTime())) {
      log.warn(`Invalid interview timestamp: ${interviewTimestamp}, skipping calendar`);
    } else {
      const endIso = calculateEndTime(interviewTimestamp, INTERVIEW_DURATION_MINUTES);
      const formatted = formatDateForEmail(startDate);
      interviewDate = formatted.date;
      interviewTime = formatted.time;

      const eventSummary = `Interview with ${candidateName}`;
      let eventDescription = conversationId
        ? `Scheduled from ElevenLabs conversation: ${conversationId}`
        : "Scheduled interview";
      if (meetingLink) {
        eventDescription += `\n\nJoin meeting: ${meetingLink}`;
        if (meetingPasscode) {
          eventDescription += `\nPasscode: ${meetingPasscode}`;
        }
      }

      const calendarArgs = [
        "calendar",
        "create",
        calendarId,
        "--summary",
        eventSummary,
        "--from",
        interviewTimestamp,
        "--to",
        endIso,
        "--description",
        eventDescription,
        "--attendees",
        candidateEmail,
        "--no-input",
      ];

      log.info(`Creating calendar event for ${candidateName} at ${interviewTimestamp}`);
      const calendarResult = await runGogCommand(calendarArgs, gogEnv, log);

      if (calendarResult.ok) {
        calendarEventCreated = true;
        log.info(`Calendar event created for ${candidateName}`);
      } else {
        log.warn(`Failed to create calendar event: ${calendarResult.error}`);
      }
    }
  } else if (interviewTimestamp) {
    // Still compute display dates even if skipping calendar (for email template)
    const startDate = new Date(interviewTimestamp);
    if (!isNaN(startDate.getTime())) {
      const formatted = formatDateForEmail(startDate);
      interviewDate = formatted.date;
      interviewTime = formatted.time;
    }
    if (skipCalendar) {
      calendarEventCreated = true; // Talently already created it
      log.info(`Skipping gog calendar creation (handled by Talently API)`);
    }
  } else {
    log.info(`No interview timestamp provided, skipping calendar invite`);
  }

  // 2. Send email
  const emailHtml = buildEmailHtml(templateType, {
    candidateName,
    interviewDate,
    interviewTime,
    meetingLink,
    meetingPasscode,
  });

  // Use different subject based on whether we have a scheduled date
  const emailSubject = interviewDate
    ? `Interview Scheduled - ${interviewDate}`
    : `Follow-up from Deriv`;

  const emailArgs = [
    "gmail",
    "send",
    "--to",
    candidateEmail,
    "--subject",
    emailSubject,
    "--body-html",
    emailHtml,
    "--no-input",
  ];

  log.info(`Sending confirmation email to ${candidateEmail}`);
  const emailResult = await runGogCommand(emailArgs, gogEnv, log);

  if (emailResult.ok) {
    emailSent = true;
    log.info(`Confirmation email sent to ${candidateEmail}`);
  } else {
    log.warn(`Failed to send confirmation email: ${emailResult.error}`);
  }

  // Return result
  if (!emailSent) {
    return {
      ok: false,
      error: `Email failed: ${emailResult.error}`,
      calendarEventCreated,
      emailSent,
    };
  }

  return {
    ok: true,
    calendarEventCreated,
    emailSent,
  };
}
