import type { TalentSearchParams } from "../linkedin/search.js";

export type IdentityBand = "CONFIRMED" | "HIGH" | "MEDIUM" | "LOW";

export type IdentityResolutionInput = {
  linkedin: {
    providerId?: string | null;
    publicIdentifier?: string | null;
    profileUrl?: string | null;
    name?: string | null;
    employer?: string | null;
    location?: string | null;
  };
  github?: {
    handle?: string | null;
    url?: string | null;
    profileLinkedinUrl?: string | null;
    employer?: string | null;
    location?: string | null;
  };
  x?: {
    handle?: string | null;
    url?: string | null;
    profileLinkedinUrl?: string | null;
  };
  personalSite?: {
    url?: string | null;
    linkedinUrl?: string | null;
    githubUrl?: string | null;
    xUrl?: string | null;
  };
};

export type IdentityResolution = {
  confidence: number;
  band: IdentityBand;
  shortlistEligible: boolean;
  reasons: string[];
};

export type CandidateSignal = {
  key: string;
  value?: string;
  numericValue?: number;
  source: string;
  details?: Record<string, unknown>;
};

export type CandidateScoreBreakdown = {
  builder_activity: number;
  ai_native_evidence: number;
  technical_depth: number;
  role_fit: number;
  identity_confidence: number;
};

export type CandidateScore = {
  total: number;
  shortlistEligible: boolean;
  breakdown: CandidateScoreBreakdown;
  concerns: string[];
  outreachAngle: string;
};

export type CandidateEvidenceLink = {
  url: string;
  title?: string;
  source: string;
  relevance?: number;
};

export type PipelineRoleInput = {
  roleKey: string;
  roleTitle: string;
  search: TalentSearchParams;
  targetCandidates?: number;
};

export type CandidatePipelineRunInput = {
  role: PipelineRoleInput;
  runId?: string;
  idempotencyKey?: string;
  browserVerificationEnabled?: boolean;
  sourceQueryMode?: "default" | "broad";
  evidenceQueryMode?: "default" | "strict";
};

export type CandidatePipelineCounts = {
  sourced: number;
  enriched: number;
  enrichFailed: number;
  externalDiscovered: number;
  identityConfirmedHigh: number;
  identityMediumLow: number;
  shortlistEligible: number;
};

export type CandidatePipelineErrorMessage = {
  message: string;
  errorType: string;
  count: number;
};

export type CandidatePipelineStageError = {
  stage: string;
  count: number;
  topMessages: CandidatePipelineErrorMessage[];
};

export type CandidatePipelineSearchQueryUsed = {
  api: "classic" | "recruiter" | "sales_navigator";
  keywords?: string;
  roleKeywords: string[];
  skills: string[];
  companyKeywords: string[];
  location?: string;
  industry?: string;
  networkDistance: number[];
  pageSize: number;
  maxPages: number;
};

export type CandidatePipelineLinkedInAccountHealth = {
  requestedAccountId?: string;
  resolvedAccountId: string;
  unipileAccountId?: string;
  enabled: boolean;
  apiKeySource: "env" | "config" | "none";
  missingCredentials: string[];
  recruiterReady: boolean;
};

export type CandidatePipelineDiagnostics = {
  counts: CandidatePipelineCounts;
  errorsByStage: CandidatePipelineStageError[];
  searchQueryUsed: CandidatePipelineSearchQueryUsed;
  modes: {
    sourceQueryMode: "default" | "broad";
    evidenceQueryMode: "default" | "strict";
  };
  accountHealth: CandidatePipelineLinkedInAccountHealth;
  failure?: {
    stage: string;
    message: string;
    errorType: string;
  };
};

export type CandidatePipelineStatus = {
  runId: string;
  status: "running" | "completed" | "failed";
  startedAt: number;
  finishedAt?: number;
  targetCandidates: number;
  roleKey: string;
  roleTitle: string;
  diagnostics?: CandidatePipelineDiagnostics;
};

export type CandidatePipelineResultRow = {
  candidateId: string;
  name: string;
  headline?: string;
  location?: string;
  totalScore: number;
  shortlistEligible: boolean;
  identityBand: IdentityBand;
  identityConfidence: number;
  outreachAngle: string;
  topEvidence: CandidateEvidenceLink[];
  concerns: string[];
};

export type CandidatePipelineResults = {
  runId: string;
  shortlist: CandidatePipelineResultRow[];
  reviewQueue: CandidatePipelineResultRow[];
  meta: {
    generatedAt: number;
    totalCandidates: number;
    shortlistCount: number;
    reviewCount: number;
    counts?: CandidatePipelineCounts;
    errorsByStage?: CandidatePipelineStageError[];
    searchQueryUsed?: CandidatePipelineSearchQueryUsed;
    modes?: CandidatePipelineDiagnostics["modes"];
    accountHealth?: CandidatePipelineLinkedInAccountHealth;
    failure?: CandidatePipelineDiagnostics["failure"];
    workflow?: WorkflowStats;
    verification?: VerificationStats;
    quota?: QuotaStatus;
  };
};

export type CandidateRecord = {
  candidateId?: string;
  providerId?: string | null;
  publicIdentifier?: string | null;
  profileUrl?: string | null;
  normalizedProfileUrlHash?: string | null;
  name?: string | null;
  headline?: string | null;
  location?: string | null;
  currentCompany?: string | null;
  currentRole?: string | null;
};

// Hybrid workflow types

export type CandidateReviewStatus =
  | "new_review"
  | "under_verification"
  | "promoted_shortlist"
  | "rejected"
  | "deferred";

export type CandidateReviewRecord = {
  candidateId: string;
  runId: string;
  status: CandidateReviewStatus;
  priority: number;
  notes?: string;
  updatedBy?: string;
  createdAt: number;
  updatedAt: number;
};

export type VerificationOutcome = "confirmed" | "rejected" | "inconclusive";

export type CandidateVerificationRecord = {
  candidateId: string;
  runId: string;
  method: "browser" | "api";
  outcome: VerificationOutcome;
  identityConfidenceBefore?: number;
  identityConfidenceAfter?: number;
  proofLinks: string[];
  notes?: string;
  createdAt: number;
};

export type CandidatePromotionRecord = {
  candidateId: string;
  runId: string;
  promotionReason: string;
  confidenceOverride?: number;
  outreachAngle?: string;
  proofLinks: string[];
  promotedAt: number;
  promotedBy?: string;
};

export type DailyOutputContract = {
  runId: string;
  roleKey: string;
  date: string;
  promotedCount: number;
  reviewedCount: number;
  verifiedCount: number;
  rejectedCount: number;
  deferredCount: number;
  generatedAt: number;
};

export type WorkflowStats = {
  reviewedCount: number;
  promotedCount: number;
  deferredCount: number;
  rejectedCount: number;
};

export type VerificationStats = {
  queued: number;
  completed: number;
  browserVerified: number;
  blockedDomainHits: number;
};

export type QuotaStatus = {
  verificationBudgetDaily: number;
  verificationUsedToday: number;
  promotionsTargetDaily: number;
  promotionsToday: number;
  reviewedTargetDaily: number;
  reviewedToday: number;
};
