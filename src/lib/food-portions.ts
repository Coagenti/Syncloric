import { z } from "zod";

export const decimalAmount = z.number().finite().min(0.01).max(999999.99)
  .refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001, "Usa al massimo due decimali.");
export const foodPortionSchema = z.object({
  id: z.uuid(), label: z.string().trim().min(1).max(60), grams: decimalAmount,
  defaultQuantity: decimalAmount.max(10000).default(1),
}).strict();
export const foodPortionsSchema = z.array(foodPortionSchema).max(20)
  .refine(values => new Set(values.map(v => v.id)).size === values.length, "Porzioni duplicate.");
export const portionSnapshotSchema = z.object({
  label: z.string().trim().min(1).max(60), grams: decimalAmount, quantity: decimalAmount.max(10000),
}).strict().refine(v => portionTotalGrams(v.grams, v.quantity) <= 999999.99, "Quantità troppo grande.");
export type FoodPortion = z.infer<typeof foodPortionSchema>;
export type PortionSnapshot = z.infer<typeof portionSnapshotSchema>;
export function newPortionId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function portionTotalGrams(grams: number, quantity: number) {
  return Math.round(grams * quantity * 100) / 100;
}
/** Italian decimal input accepts either separator, never thousands/grouping. */
export function parseFoodAmount(value: string) {
  const text = value.trim();
  return /^\d+(?:[.,]\d{1,2})?$/.test(text) ? Number(text.replace(",", ".")) : NaN;
}
export function portionColumns(portion?: PortionSnapshot | null) {
  return { portionLabel: portion?.label ?? null, portionGrams: portion ? String(portion.grams) : null, portionQuantity: portion ? String(portion.quantity) : null };
}
export function legacyFoodPortions(food: { portions?: FoodPortion[]; servingGrams?: number | null; servingLabel?: string | null }): FoodPortion[] {
  if (food.portions?.length) return food.portions;
  return food.servingGrams && food.servingGrams > 0 ? [{ id: "00000000-0000-4000-8000-000000000001", label: food.servingLabel?.trim().slice(0, 60) || "Porzione", grams: food.servingGrams, defaultQuantity: 1 }] : [];
}
