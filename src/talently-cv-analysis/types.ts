/**
 * Talently CV Analysis Tool - Types
 *
 * TypeScript interfaces for the CV Analysis API.
 */

// =============================================================================
// Configuration Types
// =============================================================================

export type TalentlyCVAnalysisConfig = {
  enabled?: boolean;
  apiUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
};

// =============================================================================
// API Response Types
// =============================================================================

/**
 * Response from the endpoint.
 */
export type BatchJobCreateResponse = {
  job_id: string;
  total: number;
  message: string;
};

// =============================================================================
// Tool Result Types
// =============================================================================

export type CVAnalysisSuccessResult = {
  success: true;
  job_id: string;
  total: number;
  message: string;
};

export type CVAnalysisErrorResult = {
  success: false;
  error: string;
};

export type CVAnalysisResult = CVAnalysisSuccessResult | CVAnalysisErrorResult;
