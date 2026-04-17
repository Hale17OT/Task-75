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

  it("uses UTC getters so day-boundary timestamps do not drift on west-of-UTC workstations", () => {
    // 2026-04-15T00:00:00Z is local 2026-04-14 in PDT/PST/EST; UTC formatting must keep the 15th.
    expect(formatIsoToMmDdYyyy("2026-04-15T00:00:00.000Z")).toBe("04/15/2026");
    // 2026-04-15T23:59:59Z would be 2026-04-16 in any timezone east of UTC; UTC formatting must keep the 15th.
    expect(formatIsoToMmDdYyyy("2026-04-15T23:59:59.999Z")).toBe("04/15/2026");
    // First day of the year right at UTC midnight.
    expect(formatIsoToMmDdYyyy("2026-01-01T00:00:00.000Z")).toBe("01/01/2026");
    // Last day of the year right at the end of UTC.
    expect(formatIsoToMmDdYyyy("2026-12-31T23:59:59.999Z")).toBe("12/31/2026");
  });
});
