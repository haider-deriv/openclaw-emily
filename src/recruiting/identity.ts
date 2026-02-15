import type { IdentityBand, IdentityResolution, IdentityResolutionInput } from "./types.js";

function normalizeUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function includesLinkedinUrl(
  value: string | null | undefined,
  linkedinUrl: string | null,
): boolean {
  if (!value || !linkedinUrl) {
    return false;
  }
  const normalizedValue = normalizeUrl(value);
  return normalizedValue === linkedinUrl;
}

function resolveBand(confidence: number): IdentityBand {
  if (confidence >= 0.9) {
    return "CONFIRMED";
  }
  if (confidence >= 0.8) {
    return "HIGH";
  }
  if (confidence >= 0.6) {
    return "MEDIUM";
  }
  return "LOW";
}

export function resolveIdentity(input: IdentityResolutionInput): IdentityResolution {
  const reasons: string[] = [];
  let score = 0;

  const linkedinUrl = normalizeUrl(input.linkedin.profileUrl ?? null);
  const githubLinkedin = normalizeUrl(input.github?.profileLinkedinUrl ?? null);
  const xLinkedin = normalizeUrl(input.x?.profileLinkedinUrl ?? null);
  const siteLinkedin = normalizeUrl(input.personalSite?.linkedinUrl ?? null);

  // Rule 1: direct profile links (highest confidence)
  if (
    includesLinkedinUrl(githubLinkedin, linkedinUrl) ||
    includesLinkedinUrl(xLinkedin, linkedinUrl) ||
    includesLinkedinUrl(siteLinkedin, linkedinUrl)
  ) {
    score = Math.max(score, 0.95);
    reasons.push("direct_profile_link");
  }

  // Rule 2: reverse links through personal site
  const githubUrl = normalizeUrl(input.github?.url ?? null);
  const xUrl = normalizeUrl(input.x?.url ?? null);
  const siteGithub = normalizeUrl(input.personalSite?.githubUrl ?? null);
  const siteX = normalizeUrl(input.personalSite?.xUrl ?? null);
  if (linkedinUrl && ((githubUrl && siteGithub === githubUrl) || (xUrl && siteX === xUrl))) {
    score = Math.max(score, 0.9);
    reasons.push("reverse_link_via_site");
  }

  // Rule 3: strong contextual match
  const sameEmployer =
    input.linkedin.employer &&
    input.github?.employer &&
    input.linkedin.employer.trim().toLowerCase() === input.github.employer.trim().toLowerCase();
  const sameLocation =
    input.linkedin.location &&
    input.github?.location &&
    input.linkedin.location.trim().toLowerCase() === input.github.location.trim().toLowerCase();
  const handlePatternMatch =
    Boolean(input.github?.handle?.trim()) &&
    Boolean(input.x?.handle?.trim()) &&
    input.github?.handle?.trim().toLowerCase() === input.x?.handle?.trim().toLowerCase();

  if (sameEmployer && sameLocation && handlePatternMatch) {
    score = Math.max(score, 0.82);
    reasons.push("strong_context_employer_location_handle");
  } else if ((sameEmployer && sameLocation) || (sameEmployer && handlePatternMatch)) {
    score = Math.max(score, 0.7);
    reasons.push("context_partial_match");
  }

  if (score === 0) {
    reasons.push("unconfirmed_no_strong_match");
  }

  const confidence = Math.round(score * 1000) / 1000;
  const band = resolveBand(confidence);

  return {
    confidence,
    band,
    shortlistEligible: band === "CONFIRMED" || band === "HIGH",
    reasons,
  };
}
