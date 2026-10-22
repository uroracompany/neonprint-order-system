import { beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.hoisted(() => vi.fn());

vi.mock("../../supabaseClient", () => ({
  supabase: {
    from: fromMock,
  },
}));

import { __resetAuthProfileRequests, getAuthProfile } from "../utils/authProfile";

const profileQuery = (result) => ({
  select: vi.fn(() => ({
    eq: vi.fn(() => ({
      single: vi.fn(() => result),
    })),
  })),
});

describe("auth profile loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetAuthProfileRequests();
  });

  it("times out a stuck profile request and allows a later retry", async () => {
    fromMock.mockReturnValueOnce(profileQuery(new Promise(() => {})));

    await expect(getAuthProfile("user-1", { timeoutMs: 1 }))
      .rejects.toMatchObject({ code: "PROFILE_TIMEOUT", status: 408 });

    const profile = { id: "user-1", role: "digital_producer" };
    fromMock.mockReturnValueOnce(profileQuery(Promise.resolve({ data: profile, error: null })));

    await expect(getAuthProfile("user-1", { timeoutMs: 100 }))
      .resolves.toEqual(profile);
    expect(fromMock).toHaveBeenCalledTimes(2);
  });
});
