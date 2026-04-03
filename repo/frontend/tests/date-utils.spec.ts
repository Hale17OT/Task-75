import { describe, expect, it } from "vitest";
import { formatIsoToMmDdYyyy, parseMmDdYyyy } from "../src/utils/date";

describe("date utils", () => {
  it("parses MM/DD/YYYY values into API-friendly ISO date fragments", () => {
    expect(parseMmDdYyyy("03/28/2026")).toBe("2026-03-28");
    expect(parseMmDdYyyy("02/31/2026")).toBe("");
    expect(parseMmDdYyyy("2026-03-28")).toBe("");
    expect(parseMmDdYyyy("")).toBe("");
  });

  it("formats ISO timestamps for MM/DD/YYYY-oriented UI fields", () => {
    expect(formatIsoToMmDdYyyy("2026-03-28T10:00:00.000Z")).toBe("03/28/2026");
    expect(formatIsoToMmDdYyyy("not-a-date")).toBe("");
    expect(formatIsoToMmDdYyyy(null)).toBe("");
  });
});
