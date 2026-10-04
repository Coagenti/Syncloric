import { afterEach, expect, it, vi } from "vitest";
import { calculateCalorieTarget } from "@/server/services/norish/sync";

afterEach(() => vi.useRealTimers());
it.each([
  ["m", 80, 180, "lose", 2260], ["m", 80, 180, "maintain", 2760], ["m", 80, 180, "gain", 3060],
  ["f", 60, 165, "lose", 1540], ["f", 60, 165, "maintain", 2040], ["f", 60, 165, "gain", 2340],
  ["m", 35, 140, "lose", 1500], ["f", 35, 140, "lose", 1200],
] as const)("fixed vector %s/%s/%s/%s = %s", (sex, weightKg, heightCm, goal, expected) => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
  expect(calculateCalorieTarget({ sex, weightKg, heightCm, goal, birthYear: 1996, activityLevel: "moderate" })).toBe(expected);
});
it("uses the TL ADR-0009 female constant and rounds only the final target to 5 kcal", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
  expect(calculateCalorieTarget({ sex: "f", weightKg: 60, heightCm: 165, birthYear: 1996, activityLevel: "moderate", goal: "maintain" })).toBe(2040);
});
