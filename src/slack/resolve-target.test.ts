import { describe, expect, it, vi } from "vitest";
import {
  resolveSlackChannelTarget,
  resolveSlackTarget,
  resolveSlackUserTarget,
} from "./resolve-target.js";

describe("resolveSlackUserTarget", () => {
  it("resolves user ID directly without API call", async () => {
    const client = {
      users: {
        list: vi.fn(),
      },
    };

    const result = await resolveSlackUserTarget({
      input: "U12345ABCD",
      client: client as never,
    });

    expect(result).toMatchObject({
      kind: "user",
      id: "U12345ABCD",
    });
    expect(client.users.list).not.toHaveBeenCalled();
  });

  it("resolves user mention format without API call", async () => {
    const client = {
      users: {
        list: vi.fn(),
      },
    };

    const result = await resolveSlackUserTarget({
      input: "<@U12345ABCD>",
      client: client as never,
    });

    expect(result).toMatchObject({
      kind: "user",
      id: "U12345ABCD",
    });
    expect(client.users.list).not.toHaveBeenCalled();
  });

  it("resolves prefixed user ID without API call", async () => {
    const client = {
      users: {
        list: vi.fn(),
      },
    };

    const result = await resolveSlackUserTarget({
      input: "user:U12345ABCD",
      client: client as never,
    });

    expect(result).toMatchObject({
      kind: "user",
      id: "U12345ABCD",
    });
    expect(client.users.list).not.toHaveBeenCalled();
  });

  it("resolves user by email via API", async () => {
    const client = {
      users: {
        list: vi.fn().mockResolvedValue({
          members: [
            {
              id: "U001",
              name: "john.doe",
              deleted: false,
              is_bot: false,
              profile: {
                display_name: "John Doe",
                email: "john@example.com",
              },
            },
          ],
        }),
      },
    };

    const result = await resolveSlackUserTarget({
      input: "john@example.com",
      client: client as never,
    });

    expect(result).toMatchObject({
      kind: "user",
      id: "U001",
      displayName: "John Doe",
      email: "john@example.com",
    });
    expect(client.users.list).toHaveBeenCalled();
  });

  it("resolves user by username via API", async () => {
    const client = {
      users: {
        list: vi.fn().mockResolvedValue({
          members: [
            {
              id: "U002",
              name: "jane.doe",
              deleted: false,
              is_bot: false,
              profile: {
                display_name: "Jane Doe",
                email: "jane@example.com",
              },
            },
          ],
        }),
      },
    };

    const result = await resolveSlackUserTarget({
      input: "@jane.doe",
      client: client as never,
    });

    expect(result).toMatchObject({
      kind: "user",
      id: "U002",
      displayName: "Jane Doe",
    });
    expect(client.users.list).toHaveBeenCalled();
  });

  it("resolves user by display name via API", async () => {
    const client = {
      users: {
        list: vi.fn().mockResolvedValue({
          members: [
            {
              id: "U003",
              name: "bob.smith",
              deleted: false,
              is_bot: false,
              profile: {
                display_name: "Bob Smith",
                real_name: "Robert Smith",
                email: "bob@example.com",
              },
            },
          ],
        }),
      },
    };

    const result = await resolveSlackUserTarget({
      input: "@Bob Smith",
      client: client as never,
    });

    expect(result).toMatchObject({
      kind: "user",
      id: "U003",
      displayName: "Bob Smith",
    });
  });

  it("prefers non-deleted users when multiple match", async () => {
    const client = {
      users: {
        list: vi.fn().mockResolvedValue({
          members: [
            {
              id: "U_DELETED",
              name: "john",
              deleted: true,
              is_bot: false,
              profile: { display_name: "John", email: "john@example.com" },
            },
            {
              id: "U_ACTIVE",
              name: "john",
              deleted: false,
              is_bot: false,
              profile: { display_name: "John", email: "john@example.com" },
            },
          ],
        }),
      },
    };

    const result = await resolveSlackUserTarget({
      input: "john@example.com",
      client: client as never,
    });

    expect(result?.id).toBe("U_ACTIVE");
  });

  it("prefers real users over bots when multiple match", async () => {
    const client = {
      users: {
        list: vi.fn().mockResolvedValue({
          members: [
            {
              id: "U_BOT",
              name: "helper",
              deleted: false,
              is_bot: true,
              profile: { display_name: "Helper Bot" },
            },
            {
              id: "U_HUMAN",
              name: "helper",
              deleted: false,
              is_bot: false,
              profile: { display_name: "Helper Human" },
            },
          ],
        }),
      },
    };

    const result = await resolveSlackUserTarget({
      input: "@helper",
      client: client as never,
    });

    expect(result?.id).toBe("U_HUMAN");
  });

  it("returns null for non-existent user", async () => {
    const client = {
      users: {
        list: vi.fn().mockResolvedValue({ members: [] }),
      },
    };

    const result = await resolveSlackUserTarget({
      input: "nonexistent@example.com",
      client: client as never,
    });

    expect(result).toBeNull();
  });
});

describe("resolveSlackChannelTarget", () => {
  it("resolves channel ID directly without API call", async () => {
    const client = {
      conversations: {
        list: vi.fn(),
      },
    };

    const result = await resolveSlackChannelTarget({
      input: "C12345ABCD",
      client: client as never,
    });

    expect(result).toMatchObject({
      kind: "channel",
      id: "C12345ABCD",
    });
    expect(client.conversations.list).not.toHaveBeenCalled();
  });

  it("resolves channel mention format without API call", async () => {
    const client = {
      conversations: {
        list: vi.fn(),
      },
    };

    const result = await resolveSlackChannelTarget({
      input: "<#C12345ABCD|general>",
      client: client as never,
    });

    expect(result).toMatchObject({
      kind: "channel",
      id: "C12345ABCD",
    });
    expect(client.conversations.list).not.toHaveBeenCalled();
  });

  it("resolves prefixed channel ID without API call", async () => {
    const client = {
      conversations: {
        list: vi.fn(),
      },
    };

    const result = await resolveSlackChannelTarget({
      input: "channel:C12345ABCD",
      client: client as never,
    });

    expect(result).toMatchObject({
      kind: "channel",
      id: "C12345ABCD",
    });
    expect(client.conversations.list).not.toHaveBeenCalled();
  });

  it("resolves channel by name via API", async () => {
    const client = {
      conversations: {
        list: vi.fn().mockResolvedValue({
          channels: [
            {
              id: "C001",
              name: "general",
              is_archived: false,
              is_private: false,
            },
          ],
        }),
      },
    };

    const result = await resolveSlackChannelTarget({
      input: "#general",
      client: client as never,
    });

    expect(result).toMatchObject({
      kind: "channel",
      id: "C001",
      displayName: "general",
    });
    expect(client.conversations.list).toHaveBeenCalled();
  });

  it("resolves channel by name without # prefix", async () => {
    const client = {
      conversations: {
        list: vi.fn().mockResolvedValue({
          channels: [
            {
              id: "C002",
              name: "random",
              is_archived: false,
            },
          ],
        }),
      },
    };

    const result = await resolveSlackChannelTarget({
      input: "random",
      client: client as never,
    });

    expect(result).toMatchObject({
      kind: "channel",
      id: "C002",
    });
  });

  it("prefers non-archived channels when multiple match", async () => {
    const client = {
      conversations: {
        list: vi.fn().mockResolvedValue({
          channels: [
            { id: "C_ARCHIVED", name: "general", is_archived: true },
            { id: "C_ACTIVE", name: "general", is_archived: false },
          ],
        }),
      },
    };

    const result = await resolveSlackChannelTarget({
      input: "#general",
      client: client as never,
    });

    expect(result?.id).toBe("C_ACTIVE");
  });

  it("returns null for non-existent channel", async () => {
    const client = {
      conversations: {
        list: vi.fn().mockResolvedValue({ channels: [] }),
      },
    };

    const result = await resolveSlackChannelTarget({
      input: "#nonexistent",
      client: client as never,
    });

    expect(result).toBeNull();
  });
});

describe("resolveSlackTarget", () => {
  it("auto-detects user from @ prefix", async () => {
    const client = {
      users: {
        list: vi.fn().mockResolvedValue({
          members: [
            {
              id: "U001",
              name: "testuser",
              deleted: false,
              profile: { display_name: "Test User" },
            },
          ],
        }),
      },
    };

    const result = await resolveSlackTarget({
      input: "@testuser",
      client: client as never,
    });

    expect(result).toMatchObject({
      kind: "user",
      id: "U001",
    });
  });

  it("auto-detects channel from # prefix", async () => {
    const client = {
      conversations: {
        list: vi.fn().mockResolvedValue({
          channels: [{ id: "C001", name: "general", is_archived: false }],
        }),
      },
    };

    const result = await resolveSlackTarget({
      input: "#general",
      client: client as never,
    });

    expect(result).toMatchObject({
      kind: "channel",
      id: "C001",
    });
  });

  it("auto-detects user from email format", async () => {
    const client = {
      users: {
        list: vi.fn().mockResolvedValue({
          members: [
            {
              id: "U001",
              name: "john",
              deleted: false,
              profile: { email: "john@example.com" },
            },
          ],
        }),
      },
    };

    const result = await resolveSlackTarget({
      input: "john@example.com",
      client: client as never,
    });

    expect(result).toMatchObject({
      kind: "user",
      id: "U001",
    });
  });

  it("uses defaultKind when ambiguous", async () => {
    const client = {
      conversations: {
        list: vi.fn().mockResolvedValue({
          channels: [{ id: "C001", name: "test", is_archived: false }],
        }),
      },
    };

    const result = await resolveSlackTarget({
      input: "test",
      client: client as never,
      defaultKind: "channel",
    });

    expect(result).toMatchObject({
      kind: "channel",
    });
  });
});
