import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { diaryEntries, foods, recipes, slotEnum } from "@/server/db/schema";
import { normalizeNutrition, nutritionColumns, scaleNutrition } from "@/lib/nutrition";
import { activeUser, checkOrigin, handle, HttpError, input, json, sessionUserId, type Deps } from "@/server/services/households/common";

const destination = z.object({ date: z.iso.date(), slot: z.enum(slotEnum.enumValues) }).strict();

/** Copy an owned row's displayed totals, without linking the copy to sync or catalog changes. */
export function buildDiaryDuplicateHandlers(deps: Deps) {
  return { POST: (request: Request, context: { params: Promise<{ id: string }> }) => handle(async () => {
    const userId = await sessionUserId(deps, request);
    checkOrigin(request);
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) throw new HttpError("Voce non trovata.", 404);
    const target = await input(request, destination);
    return deps.getDb().transaction(async tx => {
      await activeUser(tx, userId);
      const [owned] = await tx.select({ id: diaryEntries.id }).from(diaryEntries)
        .where(and(eq(diaryEntries.id, id), eq(diaryEntries.userId, userId))).for("update");
      if (!owned) throw new HttpError("Voce non trovata.", 404);
      const [{ entry, foodName, recipeName }] = await tx.select({ entry: diaryEntries, foodName: foods.name, recipeName: recipes.name })
        .from(diaryEntries).leftJoin(foods, eq(diaryEntries.foodId, foods.id)).leftJoin(recipes, eq(diaryEntries.recipeId, recipes.id))
        .where(and(eq(diaryEntries.id, id), eq(diaryEntries.userId, userId)));
      const factor = entry.entryType === "recipe" && entry.source === "norish_sync" ? Number(entry.servings ?? 1) : 1;
      const kcal = entry.kcal === null ? null : Math.round(entry.kcal * factor);
      if (kcal !== null && (!Number.isSafeInteger(kcal) || kcal < 0 || kcal > 2147483647)) throw new HttpError("Kcal fuori dai limiti supportati.");
      const nutrients = scaleNutrition(normalizeNutrition(entry.nutrients, { protein: entry.protein, carbs: entry.carbs, fat: entry.fat }), factor);
      const [copy] = await tx.insert(diaryEntries).values({
        userId, ...target, entryType: entry.entryType, foodId: null, recipeId: null,
        copiedName: entry.copiedName ?? recipeName ?? foodName ?? "Voce senza nome",
        quantityGrams: entry.quantityGrams, servings: entry.servings,
        portionLabel: entry.portionLabel, portionGrams: entry.portionGrams, portionQuantity: entry.portionQuantity,
        kcal, ...nutritionColumns(nutrients), source: "manual", copiedMeal: true, norishItemId: null, norishDeleted: false,
      }).returning({ id: diaryEntries.id });
      return json({ id: copy.id, date: target.date, slot: target.slot }, 201);
    });
  }) };
}
