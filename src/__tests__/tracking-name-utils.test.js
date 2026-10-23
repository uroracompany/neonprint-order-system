import { describe, expect, it } from "vitest";
import {
  canonicalizeTrackingName,
  escapeIlikePattern,
  normalizeTrackingName,
  sortTrackingNames,
} from "../utils/trackingNames";

describe("tracking name utilities", () => {
  it("canonicalizes whitespace without changing accents or punctuation", () => {
    expect(canonicalizeTrackingName("  Banner\t  principal\n #1  ")).toBe("Banner principal #1");
    expect(canonicalizeTrackingName("  ")).toBe("");
  });

  it("compares names case-insensitively after canonicalization", () => {
    expect(normalizeTrackingName("  BANNER   PRINCIPAL ")).toBe("banner principal");
    expect(normalizeTrackingName("Diseño")).not.toBe(normalizeTrackingName("Diseno"));
  });

  it("escapes ILIKE wildcards and backslashes", () => {
    expect(escapeIlikePattern("50%_off\\final")).toBe("50\\%\\_off\\\\final");
  });

  it("sorts valid catalog options for a stable menu", () => {
    expect(sortTrackingNames([
      { id: "2", name: "Vinilo" },
      { id: "1", name: "banner" },
      { id: "3", name: "  " },
    ])).toEqual([
      { id: "1", name: "banner" },
      { id: "2", name: "Vinilo" },
    ]);
  });
});
