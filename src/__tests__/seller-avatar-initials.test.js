import { describe, expect, it } from "vitest";
import { getAvatarInitials } from "../utils/avatar-initials";

describe("seller table avatar initials", () => {
  it("uses two characters for a one-word client name", () => {
    expect(getAvatarInitials("Bobo")).toBe("BO");
  });

  it("uses one initial from each of the first two names", () => {
    expect(getAvatarInitials("JP Morgan")).toBe("JM");
  });

  it("keeps two visible placeholder characters when a client has no name", () => {
    expect(getAvatarInitials("")).toBe("??");
  });
});
