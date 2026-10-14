import { afterEach, expect, it, vi } from "vitest";
import { calculateGoal } from "@/server/services/profile/goals";
import { defaultMacroSettings, macroGoals, macroSettingsSchema } from "@/lib/goal-targets";
const now = new Date("2026-10-14T12:00:00Z");
const person = { sex: "m" as const, heightCm: 180, weightKg: 100, birthYear: 1996, activityLevel: "moderate" as const, goal: "lose" as const };
afterEach(() => vi.useRealTimers());
it("supports an optional gradual deadline and retains the existing untimed calculation", () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const ordinary = calculateGoal(person, now);
  expect(ordinary.appliedDeficitKcal).toBe(500);
  const result = calculateGoal({ ...person, weightGoal: { targetWeightKg: 95, targetDate: "2027-04-14" } }, now);
  expect(result.status).toBe("timeline"); expect(result.appliedDeficitKcal).toBeGreaterThan(0); expect(result.appliedDeficitKcal).toBeLessThan(500);
  expect(result.calculatedTargetKcal % 5).toBe(0);
});
it("does not turn a short deadline into an extreme deficit and suggests a feasible later date", () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const result = calculateGoal({ ...person, weightGoal: { targetWeightKg: 90, targetDate: "2026-11-14" } }, now);
  expect(result.status).toBe("limited"); expect(result.appliedDeficitKcal).toBeLessThanOrEqual(Math.min(500, result.maintenanceKcal * .2)); expect(result.calculatedTargetKcal).toBeGreaterThanOrEqual(1500);
  expect(result.suggestedDate).not.toBeNull();
  expect(calculateGoal({ ...person, weightGoal: { targetWeightKg: 90, targetDate: result.suggestedDate! } }, now).status).toBe("timeline");
});
it.each([{ birthYear: 2012 }, { weightKg: 70, weightGoal: { targetWeightKg: 66.5, targetDate: "2027-04-14" } }, { weightGoal: { targetWeightKg: 85, targetDate: "2027-04-14" } }])("limits the population for the timeline approximation", changes => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  expect(calculateGoal({ ...person, weightGoal: { targetWeightKg: 95, targetDate: "2027-04-14" }, ...changes }, now).status).toBe("unavailable");
});
it("expired or reached deadlines return to maintenance without escalating the restriction", () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  for (const plan of [{ targetWeightKg: 95, targetDate: "2026-10-14" }, { targetWeightKg: 100, targetDate: "2027-04-14" }]) {
    const result = calculateGoal({ ...person, weightGoal: plan }, now); expect(result.appliedDeficitKcal).toBe(0); expect(result.calculatedTargetKcal).toBe(result.maintenanceKcal);
  }
});
it("macro targets convert kcal percentages to grams while preserving custom proportions", () => {
  expect(macroGoals(null, defaultMacroSettings)).toBeNull();
  expect(macroGoals(2000, defaultMacroSettings)?.grams).toEqual({ carbs: 275, protein: 75, fat: 66.67 });
  expect(macroGoals(2000, defaultMacroSettings, "lose")?.percentages).toEqual({ carbs: 50, protein: 20, fat: 30 });
  expect(macroGoals(2000, { ...defaultMacroSettings, mode: "custom", carbs: 50, protein: 25, fat: 25 })?.grams).toEqual({ carbs: 250, protein: 125, fat: 55.56 });
  expect(macroSettingsSchema.safeParse({ ...defaultMacroSettings, carbs: 60 }).success).toBe(false);
});
