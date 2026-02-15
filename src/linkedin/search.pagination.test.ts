import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  searchLinkedIn: vi.fn(),
  getSearchParameters: vi.fn(),
}));

vi.mock("./client.js", () => ({
  searchLinkedIn: mocks.searchLinkedIn,
  getSearchParameters: mocks.getSearchParameters,
}));

const { searchTalent } = await import("./search.js");

describe("searchTalent pagination", () => {
  const cfg = {
    tools: {
      linkedin: {
        enabled: true,
        baseUrl: "https://api1.unipile.com:13111",
        apiKey: "test-key",
        accountId: "acct-1",
      },
    },
  } as never;

  beforeEach(() => {
    mocks.searchLinkedIn.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps legacy behavior when paging controls are omitted", async () => {
    mocks.searchLinkedIn.mockResolvedValueOnce({
      object: "LinkedinSearch",
      items: [
        {
          object: "SearchResult",
          type: "PEOPLE",
          id: "p1",
          public_identifier: "alice",
          public_profile_url: "https://linkedin.com/in/alice",
          profile_url: null,
          profile_picture_url: null,
          profile_picture_url_large: null,
          member_urn: null,
          name: "Alice",
          network_distance: "DISTANCE_2",
          location: "San Francisco",
          industry: null,
          headline: "Engineer",
          skills: [],
          current_positions: [],
        },
      ],
      paging: { start: 0, page_count: 1, total_count: 1 },
      cursor: null,
    });

    const result = await searchTalent({ keywords: "engineer" }, cfg);

    expect(result.success).toBe(true);
    expect(mocks.searchLinkedIn).toHaveBeenCalledTimes(1);
    expect(mocks.searchLinkedIn.mock.calls[0]?.[2]).toMatchObject({ limit: 10 });
    expect(result.candidates[0]?.provider_id).toBe("p1");
  });

  it("paginates with cursor and dedupes across pages", async () => {
    mocks.searchLinkedIn
      .mockResolvedValueOnce({
        object: "LinkedinSearch",
        items: [
          {
            object: "SearchResult",
            type: "PEOPLE",
            id: "p1",
            public_identifier: "alice",
            public_profile_url: "https://linkedin.com/in/alice",
            profile_url: null,
            profile_picture_url: null,
            profile_picture_url_large: null,
            member_urn: null,
            name: "Alice",
            network_distance: "DISTANCE_2",
            location: "SF",
            industry: null,
            headline: "Engineer",
            skills: [],
            current_positions: [],
          },
        ],
        paging: { start: 0, page_count: 1, total_count: 2 },
        cursor: "next-1",
      })
      .mockResolvedValueOnce({
        object: "LinkedinSearch",
        items: [
          {
            object: "SearchResult",
            type: "PEOPLE",
            id: "p1",
            public_identifier: "alice",
            public_profile_url: "https://linkedin.com/in/alice",
            profile_url: null,
            profile_picture_url: null,
            profile_picture_url_large: null,
            member_urn: null,
            name: "Alice",
            network_distance: "DISTANCE_2",
            location: "SF",
            industry: null,
            headline: "Engineer",
            skills: [],
            current_positions: [],
          },
          {
            object: "SearchResult",
            type: "PEOPLE",
            id: "p2",
            public_identifier: "bob",
            public_profile_url: "https://linkedin.com/in/bob",
            profile_url: null,
            profile_picture_url: null,
            profile_picture_url_large: null,
            member_urn: null,
            name: "Bob",
            network_distance: "DISTANCE_3",
            location: "NYC",
            industry: null,
            headline: "Backend Engineer",
            skills: [],
            current_positions: [],
          },
        ],
        paging: { start: 50, page_count: 1, total_count: 2 },
        cursor: null,
      });

    const result = await searchTalent(
      {
        keywords: "engineer",
        page_size: 50,
        max_pages: 3,
      },
      cfg,
    );

    expect(result.success).toBe(true);
    expect(mocks.searchLinkedIn).toHaveBeenCalledTimes(2);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((candidate) => candidate.provider_id)).toEqual(["p1", "p2"]);
    expect(result.search).toMatchObject({ page_size: 50, pages_fetched: 2 });
  });
});
