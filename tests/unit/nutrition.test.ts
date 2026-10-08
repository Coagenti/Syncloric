import { describe, it, expect } from "vitest";
import { normalizeOffNutrients } from "@/server/services/foods/lookup";
import { normalizeNutrition, nutritionTotals, scaleNutrition } from "@/lib/nutrition";
import { parseLabel } from "@/server/services/ai/extract";
describe("nutrition quantities and missing data", () => {
  it("converts OFF normalized grams to mg/µg without trusting label units or inventing missing values", () => {
    expect(normalizeOffNutrients({ proteins_100g: 8, fiber_100g: 0, calcium_100g: .12, 'vitamin-c_100g': .08, 'vitamin-d_100g': .0000025, 'vitamin-d_unit': 'IU', iron_100g: -1, zinc_100g: "2", selenium_100g: null })).toEqual({ protein: 8, fiber: 0, calcium: 120, vitaminD: 2.5, vitaminC: 80 });
  });
  it("preserves explicit zeros, distinguishes partial totals and scales fractional amounts once", () => {
    const entries = [{ nutrients: { protein: 0, vitaminC: 10 } }, { nutrients: { protein: 20 } }, { nutrients: {} }];
    expect(nutritionTotals(entries).find(n => n.key === "protein")).toMatchObject({ value: 20, known: 2, count: 3 });
    expect(nutritionTotals(entries).find(n => n.key === "vitaminC")).toMatchObject({ value: 10, known: 1 });
    expect(nutritionTotals(entries).find(n => n.key === "vitaminD")).toMatchObject({ value: null, known: 0 });
    expect(scaleNutrition({ protein: 27.4, vitaminD: 2.5 }, .5)).toEqual({ protein: 13.7, vitaminD: 1.25 });
    expect(normalizeNutrition({ protein: null }, { protein: "30" })).toEqual({});
    expect(normalizeNutrition({ protein: ".5", vitaminC: "1e1" })).toEqual({ protein: .5, vitaminC: 10 });
  });
  it("accepts readable label micronutrients with canonical units and rejects unrecognized units/negative values", () => {
    const label = { name: "Latte", per100g: { kcal: 50, fat: 2, carbs: 5, protein: 3, vitaminC: 12, vitaminD: 2.5, calcium: 120 } };
    expect(parseLabel(JSON.stringify(label)).per100g.vitaminD).toBe(2.5);
    expect(() => parseLabel(JSON.stringify({ ...label, per100g: { ...label.per100g, vitaminDIU: 100 } }))).toThrow();
    expect(() => parseLabel(JSON.stringify({ ...label, per100g: { ...label.per100g, calcium: -1 } }))).toThrow();
  });
});
