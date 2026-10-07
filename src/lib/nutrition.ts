import { z } from "zod";

export const nutrientSpecs = [
  { key: "protein", label: "Proteine", unit: "g", group: "macro" },
  { key: "carbs", label: "Carboidrati", unit: "g", group: "macro" },
  { key: "fat", label: "Grassi", unit: "g", group: "macro" },
  { key: "saturatedFat", label: "Grassi saturi", unit: "g", group: "other" },
  { key: "sugars", label: "Zuccheri", unit: "g", group: "other" },
  { key: "fiber", label: "Fibre", unit: "g", group: "other" },
  { key: "salt", label: "Sale", unit: "g", group: "other" },
  { key: "sodium", label: "Sodio", unit: "mg", group: "mineral" },
  { key: "potassium", label: "Potassio", unit: "mg", group: "mineral" },
  { key: "calcium", label: "Calcio", unit: "mg", group: "mineral" },
  { key: "magnesium", label: "Magnesio", unit: "mg", group: "mineral" },
  { key: "phosphorus", label: "Fosforo", unit: "mg", group: "mineral" },
  { key: "iron", label: "Ferro", unit: "mg", group: "mineral" },
  { key: "zinc", label: "Zinco", unit: "mg", group: "mineral" },
  { key: "copper", label: "Rame", unit: "mg", group: "mineral" },
  { key: "manganese", label: "Manganese", unit: "mg", group: "mineral" },
  { key: "selenium", label: "Selenio", unit: "µg", group: "mineral" },
  { key: "iodine", label: "Iodio", unit: "µg", group: "mineral" },
  { key: "vitaminA", label: "Vitamina A", unit: "µg", group: "vitamin" },
  { key: "vitaminD", label: "Vitamina D", unit: "µg", group: "vitamin" },
  { key: "vitaminE", label: "Vitamina E", unit: "mg", group: "vitamin" },
  { key: "vitaminK", label: "Vitamina K", unit: "µg", group: "vitamin" },
  { key: "vitaminC", label: "Vitamina C", unit: "mg", group: "vitamin" },
  { key: "vitaminB1", label: "Vitamina B1", unit: "mg", group: "vitamin" },
  { key: "vitaminB2", label: "Vitamina B2", unit: "mg", group: "vitamin" },
  { key: "vitaminB3", label: "Vitamina B3", unit: "mg", group: "vitamin" },
  { key: "vitaminB5", label: "Vitamina B5", unit: "mg", group: "vitamin" },
  { key: "vitaminB6", label: "Vitamina B6", unit: "mg", group: "vitamin" },
  { key: "vitaminB7", label: "Vitamina B7", unit: "µg", group: "vitamin" },
  { key: "vitaminB9", label: "Vitamina B9", unit: "µg", group: "vitamin" },
  { key: "vitaminB12", label: "Vitamina B12", unit: "µg", group: "vitamin" },
  { key: "cholesterol", label: "Colesterolo", unit: "mg", group: "other" },
] as const;
export type NutrientKey = typeof nutrientSpecs[number]["key"];
export type Nutrition = Partial<Record<NutrientKey, number>>;
const keys = nutrientSpecs.map(spec => spec.key) as [NutrientKey, ...NutrientKey[]];
export const nutritionSchema = z.partialRecord(z.enum(keys), z.number().finite().min(0).max(1e12).nullable());
export const per100gSchema = nutritionSchema.refine(value => nutrientSpecs.every(spec => value[spec.key] == null || value[spec.key]! <= (spec.unit === "g" ? 100 : spec.unit === "mg" ? 100000 : 100000000)), "Valori per 100 g fuori intervallo.");

/** Zero is known; absent/null is unknown. Never infer energy or micronutrients. */
export function normalizeNutrition(value: unknown, legacy: Record<string, unknown> = {}): Nutrition {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(nutrientSpecs.flatMap(({ key }) => {
    const raw = Object.hasOwn(input, key) ? input[key] : legacy[key];
    const number = typeof raw === "number" ? raw : typeof raw === "string" && /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim()) ? Number(raw) : NaN;
    return Number.isFinite(number) && number >= 0 && number <= 1e12 ? [[key, number]] : [];
  })) as Nutrition;
}
export function scaleNutrition(value: Nutrition, factor: number): Nutrition {
  if (!Number.isFinite(factor) || factor < 0) return {};
  return Object.fromEntries(Object.entries(value).map(([key, amount]) => [key, Math.round(amount * factor * 1e6) / 1e6])) as Nutrition;
}
export function nutritionColumns(value: Nutrition) {
  if (!nutritionSchema.safeParse(value).success || [value.protein, value.carbs, value.fat].some(n => n !== undefined && n > 999999.99)) throw new Error("Nutrition overflow");
  return { nutrients: value, protein: value.protein?.toFixed(2) ?? null, fat: value.fat?.toFixed(2) ?? null, carbs: value.carbs?.toFixed(2) ?? null };
}
export function nutritionTotals(entries: { nutrients?: Nutrition; protein?: number | null; fat?: number | null; carbs?: number | null }[]) {
  return nutrientSpecs.map(spec => {
    const known = entries.map(entry => normalizeNutrition(entry.nutrients, { protein: entry.protein, fat: entry.fat, carbs: entry.carbs })[spec.key]).filter((n): n is number => n !== undefined);
    return { ...spec, value: known.length ? Math.round(known.reduce((sum, n) => sum + n, 0) * 1e6) / 1e6 : null, known: known.length, count: entries.length };
  });
}
