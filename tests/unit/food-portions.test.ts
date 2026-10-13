import { describe, expect, it } from "vitest";
import { foodPortionsSchema, parseFoodAmount, portionTotalGrams, portionSnapshotSchema, legacyFoodPortions } from "@/lib/food-portions";
const biscuit = { id: "11111111-1111-4111-8111-111111111111", label: "Biscotto", grams: 6, defaultQuantity: 4 };
describe("food portions", () => {
  it("supports comma decimals and computes fractional units without changing unit weight", () => {
    expect(parseFoodAmount("1,5")).toBe(1.5); expect(parseFoodAmount("1.50")).toBe(1.5);
    expect(portionTotalGrams(6, 1.5)).toBe(9); expect(portionTotalGrams(6.25, 1.5)).toBe(9.38);
  });
  it.each(["", "1,000.5", "-1", "Infinity", "1e3", "1.001"])("rejects ambiguous amount %s", value => expect(Number.isNaN(parseFoodAmount(value))).toBe(true));
  it("validates multiple portions, unique IDs and positive bounded amounts", () => {
    expect(foodPortionsSchema.safeParse([biscuit, { ...biscuit, id: "22222222-2222-4222-8222-222222222222", label: "Pacchetto", grams: 50 }]).success).toBe(true);
    expect(foodPortionsSchema.safeParse([biscuit, biscuit]).success).toBe(false);
    expect(foodPortionsSchema.safeParse([{ ...biscuit, grams: 0 }]).success).toBe(false);
    expect(foodPortionsSchema.safeParse([{ ...biscuit, grams: 1.001 }]).success).toBe(false);
    expect(portionSnapshotSchema.safeParse({ label: "Pacco", grams: 999999, quantity: 2 }).success).toBe(false);
  });
  it("preserves existing single servings and respects explicit multi-portion definitions", () => {
    expect(legacyFoodPortions({ servingGrams: 6.25, servingLabel: "Biscotto" })[0].grams).toBe(6.25);
    expect(legacyFoodPortions({ portions: [biscuit], servingGrams: 100 })).toEqual([biscuit]);
  });
});
