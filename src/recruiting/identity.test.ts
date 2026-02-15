import { describe, expect, it } from "vitest";
import { resolveIdentity } from "./identity.js";

describe("resolveIdentity", () => {
  it("returns CONFIRMED when direct profile links match", () => {
    const result = resolveIdentity({
      linkedin: {
        profileUrl: "https://linkedin.com/in/alice",
      },
      github: {
        profileLinkedinUrl: "https://linkedin.com/in/alice",
      },
    });

    expect(result.band).toBe("CONFIRMED");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.shortlistEligible).toBe(true);
    expect(result.reasons).toContain("direct_profile_link");
  });

  it("returns HIGH for strong contextual match", () => {
    const result = resolveIdentity({
      linkedin: {
        employer: "OpenClaw",
        location: "San Francisco",
      },
      github: {
        employer: "OpenClaw",
        location: "San Francisco",
        handle: "alice-dev",
      },
      x: {
        handle: "alice-dev",
      },
    });

    expect(result.band).toBe("HIGH");
    expect(result.shortlistEligible).toBe(true);
    expect(result.reasons).toContain("strong_context_employer_location_handle");
  });

  it("returns LOW when no strong evidence exists", () => {
    const result = resolveIdentity({
      linkedin: {
        profileUrl: "https://linkedin.com/in/unknown",
      },
      github: {
        handle: "alice",
      },
    });

    expect(result.band).toBe("LOW");
    expect(result.shortlistEligible).toBe(false);
    expect(result.reasons).toContain("unconfirmed_no_strong_match");
  });
});
