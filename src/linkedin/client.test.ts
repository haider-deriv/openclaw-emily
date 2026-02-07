import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type {
  LinkedInClientOptions,
  LinkedInSearchResponse,
  LinkedInSearchParametersResponse,
} from "./types.js";
import { normalizeBaseUrl, searchLinkedIn, getSearchParameters } from "./client.js";

describe("normalizeBaseUrl", () => {
  it("adds https:// to bare hostname with port", () => {
    expect(normalizeBaseUrl("api1.unipile.com:13111")).toBe("https://api1.unipile.com:13111");
  });

  it("preserves existing https://", () => {
    expect(normalizeBaseUrl("https://api1.unipile.com:13111")).toBe(
      "https://api1.unipile.com:13111",
    );
  });

  it("preserves existing http://", () => {
    expect(normalizeBaseUrl("http://localhost:3114")).toBe("http://localhost:3114");
  });

  it("strips trailing slashes", () => {
    expect(normalizeBaseUrl("https://api1.unipile.com:13111/")).toBe(
      "https://api1.unipile.com:13111",
    );
    expect(normalizeBaseUrl("api1.unipile.com:13111///")).toBe("https://api1.unipile.com:13111");
  });

  it("trims whitespace", () => {
    expect(normalizeBaseUrl("  api1.unipile.com:13111  ")).toBe("https://api1.unipile.com:13111");
  });

  it("throws on empty string", () => {
    expect(() => normalizeBaseUrl("")).toThrow("LinkedIn base URL is required");
    expect(() => normalizeBaseUrl("   ")).toThrow("LinkedIn base URL is required");
  });
});

describe("searchLinkedIn", () => {
  const mockClientOpts: LinkedInClientOptions = {
    baseUrl: "https://api1.unipile.com:13111",
    apiKey: "test-api-key",
    accountId: "test-account-id",
    timeoutMs: 5000,
  };

  const mockResponse: LinkedInSearchResponse = {
    object: "LinkedinSearch",
    items: [
      {
        object: "SearchResult",
        type: "PEOPLE",
        id: "test-id-1",
        public_identifier: "johndoe",
        public_profile_url: "https://linkedin.com/in/johndoe",
        profile_url: null,
        profile_picture_url: null,
        profile_picture_url_large: null,
        member_urn: null,
        name: "John Doe",
        network_distance: "DISTANCE_2",
        location: "San Francisco, CA",
        industry: "Technology",
        headline: "Senior AI Engineer at TechCorp",
      },
    ],
    paging: {
      start: 0,
      page_count: 1,
      total_count: 1,
    },
    cursor: null,
  };

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends POST request with correct headers and body", async () => {
    const result = await searchLinkedIn(
      { api: "classic", category: "people", keywords: "AI Engineer" },
      mockClientOpts,
    );

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/linkedin/search?account_id=test-account-id"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-API-KEY": "test-api-key",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ api: "classic", category: "people", keywords: "AI Engineer" }),
      }),
    );

    expect(result.object).toBe("LinkedinSearch");
    expect(result.items).toHaveLength(1);
  });

  it("includes limit and cursor in query params", async () => {
    await searchLinkedIn({ api: "classic", category: "people" }, mockClientOpts, {
      limit: 5,
      cursor: "test-cursor",
    });

    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/limit=5/), expect.any(Object));
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/cursor=test-cursor/),
      expect.any(Object),
    );
  });

  it("throws on API error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: () =>
          Promise.resolve(
            JSON.stringify({
              title: "Unauthorized",
              type: "errors/invalid_credentials",
              status: 401,
            }),
          ),
      }),
    );

    await expect(
      searchLinkedIn({ api: "classic", category: "people" }, mockClientOpts),
    ).rejects.toThrow(/LinkedIn API error/);
  });
});

describe("getSearchParameters", () => {
  const mockClientOpts: LinkedInClientOptions = {
    baseUrl: "https://api1.unipile.com:13111",
    apiKey: "test-api-key",
    accountId: "test-account-id",
  };

  const mockResponse: LinkedInSearchParametersResponse = {
    object: "LinkedinSearchParametersList",
    items: [
      {
        object: "LinkedinSearchParameter",
        id: "12345",
        title: "Python",
      },
      {
        object: "LinkedinSearchParameter",
        id: "12346",
        title: "Machine Learning",
      },
    ],
    paging: {
      page_count: 1,
    },
  };

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends GET request with correct query parameters", async () => {
    const result = await getSearchParameters(mockClientOpts, {
      type: "SKILL",
      keywords: "Python",
      limit: 10,
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/account_id=test-account-id/),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "X-API-KEY": "test-api-key",
        }),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/type=SKILL/), expect.any(Object));
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/keywords=Python/),
      expect.any(Object),
    );

    expect(result.items).toHaveLength(2);
    expect(result.items[0].title).toBe("Python");
  });
});
