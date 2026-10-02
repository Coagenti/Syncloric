import { describe, expect, it } from "vitest";
import { deriveNorishWindow } from "@/server/services/norish/runner";

describe("Norish ISO-only calendar partitions (v0.24.0-beta)", () => {
  it.each([
    ["2026-10-01", "2026-09-28", "2026-10-04"],
    ["2026-10-04", "2026-09-28", "2026-10-04"],
    ["2026-10-05", "2026-10-05", "2026-10-11"],
    ["2026-01-01", "2025-12-29", "2026-01-04"],
    ["2026-03-29", "2026-03-23", "2026-03-29"],
    ["2026-10-25", "2026-10-19", "2026-10-25"],
  ])("week for %s is %s..%s including DST and year boundaries", (anchor, start, end) => {
    expect(deriveNorishWindow("week", [anchor])).toEqual({ start, end });
  });
  it.each([
    ["2024-02-15", "2024-02-01", "2024-02-29"],
    ["2026-02-15", "2026-02-01", "2026-02-28"],
    ["2026-09-15", "2026-09-01", "2026-09-30"],
    ["2026-12-15", "2026-12-01", "2026-12-31"],
  ])("month for %s is %s..%s", (anchor, start, end) => {
    expect(deriveNorishWindow("month", [anchor])).toEqual({ start, end });
  });
  it("week prefers today payload; month prefers minimum observed date", () => {
    expect(deriveNorishWindow("week", ["2026-09-20"], "2026-10-01")).toEqual({ start: "2026-09-28", end: "2026-10-04" });
    expect(deriveNorishWindow("month", ["2026-09-15"], "2026-10-01")).toEqual({ start: "2026-09-01", end: "2026-09-30" });
  });
  it("empty dates require an explicit upstream today, never host current date", () => {
    expect(deriveNorishWindow("week", [])).toBeNull();
    expect(deriveNorishWindow("month", [])).toBeNull();
    expect(deriveNorishWindow("week", [], "2026-10-01")).toEqual({ start: "2026-09-28", end: "2026-10-04" });
    expect(deriveNorishWindow("month", [], "2026-10-01")).toEqual({ start: "2026-10-01", end: "2026-10-31" });
  });
});
