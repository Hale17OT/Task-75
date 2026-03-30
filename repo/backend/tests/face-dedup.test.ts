import { describe, expect, it } from "vitest";
import { hammingSimilarity } from "../src/services/face/dedup.js";

describe("face dedup helpers", () => {
  it("returns full similarity for identical hashes", () => {
    expect(hammingSimilarity("abcdef", "abcdef")).toBe(1);
  });

  it("returns lower similarity as distance increases", () => {
    const close = hammingSimilarity("abcdef", "abcxef");
    const far = hammingSimilarity("abcdef", "zzzzzz");
    expect(close).toBeGreaterThan(far);
    expect(far).toBeGreaterThanOrEqual(0);
  });
});
