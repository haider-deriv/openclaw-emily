/**
 * Talently Interview Tool - Types
 *
 * TypeScript interfaces for the Quick Interview API.
 */

// =============================================================================
// Configuration Types
// =============================================================================

export type TalentlyInterviewConfig = {
  enabled?: boolean;
  apiUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  interviewerEmails?: string[];
};

// =============================================================================
// API Request Types
// =============================================================================

/**
 * Request payload for creating a quick interview.
 */
export type QuickInterviewRequest = {
  interviewer_email: string;
  candidate_email: string;
  scheduled_at: string; // ISO format datetime
  interview_title?: string;
  duration_minutes?: number; // Default: 60
};

// =============================================================================
// API Response Types
// =============================================================================

/**
 * Participant info in quick interview response.
 */
export type QuickInterviewParticipant = {
  email: string;
  role: string; // "interviewer" or "candidate"
};

/**
 * Response from the quick interview creation endpoint.
 */
export type QuickInterviewResponse = {
  meeting_link: string;
  meeting_passcode?: string;
  calendar_event_link?: string;
  scheduled_at: string;
  duration_minutes: number;
  status: string;
  title: string;
  participants: QuickInterviewParticipant[];
};
