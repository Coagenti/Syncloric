/**
 * Parsing e forma del payload Open Food Facts v2 (fixture archiviata in
 * tests/fixtures/openfoodfacts-product.json), servizio-side (§ 6.6).
 * Zero rete: la fetch è sempre iniettata; il lookup stesso è già testato
 * nell'unit della lib; qui si testa la proiezione del service.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { normalizeOffProduct, type OffProductPayload } from "@/server/services/foods/lookup";

const fixturePath = path.join(process.cwd(), "tests/fixtures/openfoodfacts-product.json");

describe("normalizzazione payload Open Food Facts", () => {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as OffProductPayload;

  it("proietta nome, brand, kcal-per-100g e macro dal payload reale", () => {
    expect(normalizeOffProduct(fixture)).toEqual({
      name: "Nutella Ferrero",
      brand: "Ferrero",
      kcalPer100g: 539,
      proteinPer100g: 6.3,
      fatPer100g: 30.9,
      carbsPer100g: 57.5,
      nutrientsPer100g: { protein: 6.3, carbs: 57.5, fat: 30.9, fiber: 3.4, salt: 0.265, sodium: 107, sugars: 56.3 },
      servingGrams: 15,
    });
  });

  it("arrotta kcal e macro alla precisione della colonna (int / numerica)", () => {
    const normalized = normalizeOffProduct({
      product_name: "  Snack  ",
      brands: "Brand A, Brand B",
      serving_size: "40.6 g",
      nutriments: { "energy-kcal_100g": 123.7, proteins_100g: 2.51, fat_100g: 0.49, carbohydrates_100g: 99.95 },
    });
    expect(normalized.name).toBe("Snack");
    expect(normalized.brand).toBe("Brand A");
    expect(normalized.kcalPer100g).toBe(124);
    expect(normalized.proteinPer100g).toBe(2.51);
    expect(normalized.fatPer100g).toBe(0.49);
    expect(normalized.carbsPer100g).toBe(99.95);
    expect(normalized.servingGrams).toBe(40.6);
  });

  it("kcal mancanti o malformate vengono fuori come NULL, non come zero", () => {
    const normalized = normalizeOffProduct({ product_name: "Misteriosa" });
    expect(normalized).toEqual({
      name: "Misteriosa",
      brand: null,
      kcalPer100g: null,
      proteinPer100g: null,
      fatPer100g: null,
      carbsPer100g: null,
      nutrientsPer100g: {},
      servingGrams: null,
    });
  });
});
