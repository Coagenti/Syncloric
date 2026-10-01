import { expect, it } from "vitest";
import { sumKcal } from "@/server/services/norish/sync";
it("totals recipe kcal with local fractional servings, leaving food totals unchanged", () => {
  expect(sumKcal([
    { kcal: 459, entryType: "recipe", servings: "0.50" },
    { kcal: 100, entryType: "food", servings: "3" },
    { kcal: null, entryType: "recipe", servings: "2" },
  ])).toBe(329.5);
});
