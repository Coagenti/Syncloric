import type { Nutrition } from "./nutrition";
import type { Slot } from "./diary";
import type { PortionSnapshot } from "./food-portions";

/** Deliberately excludes catalog references, upstream payloads and account credentials. */
export type SharedMealEntry = {
  id: string; name: string; entryType: "food" | "recipe";
  quantityGrams: number | null; servings: number | null; kcal: number | null; nutrients: Nutrition;
  portion?: PortionSnapshot | null;
};
export type SharedMeal = { date: string; slot: Slot; entries: SharedMealEntry[] };
export type Household = {
  id: string; name: string; ownerId: string; currentUserId: string; joinCodeExpiresAt: string | null;
  members: { id: string; username: string; isOwner: boolean; banned: boolean }[];
};
