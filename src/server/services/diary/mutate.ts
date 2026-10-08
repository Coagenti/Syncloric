import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/server/http/request-origin";
import { z } from "zod";
import type { Db } from "@/server/db";
import { diaryEntries, foods, recipes, slotEnum } from "@/server/db/schema";
import { normalizeNutrition, scaleNutrition, nutritionColumns, nutritionSchema } from "@/lib/nutrition";

type Context = { params: Promise<{ id: string }> };
type Entry = typeof diaryEntries.$inferSelect;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Loaded = { entry: Entry | null; foodKcal: number | null; recipeKcal: number | null; guard: NextResponse | null };

const amount = z.number({ error: "Indica una quantità numerica positiva." })
  .positive("La quantità deve essere positiva.")
  .max(999999.99, "Quantità troppo grande.")
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001,
    "Usa al massimo due decimali per la quantità.");
const kcal = z.number({ error: "Indica le kcal della voce." })
  .int("Le kcal devono essere intere.").min(0, "Le kcal non possono essere negative.")
  .max(2147483647, "Kcal troppo grandi.");
const patchSchema = z.object({
  date: z.iso.date({ error: "Data non valida: usa YYYY-MM-DD." }).optional(),
  slot: z.enum(slotEnum.enumValues, { error: "Pasto non valido: usa Breakfast, Lunch, Dinner o Snack." }).optional(),
  quantityGrams: amount.optional(),
  kcal: kcal.optional(),
  servings: amount.optional(),
  nutrients: nutritionSchema.optional(),
}).strict()
  .refine((input) => Object.keys(input).length > 0, "Indica almeno un campo da aggiornare.");

const NOT_FOUND = NextResponse.json({ error: "Voce non trovata." }, { status: 404 });
const LOCKED = "Le voci importate sono gestite dalla sincronizzazione Norish e non possono essere modificate o eliminate.";
const NOT_MANUAL = "Puoi modificare o eliminare solo le voci manuali.";

/** Session+ownership-scoped mutations, MANUAL diary rows only (v1).
 * norish_sync rows stay owned by the sync: 403 with a clear message, no
 * conversion. Immutable fields (userId/source/food/recipe refs) are rejected
 * by schema. Recipe PATCH re-derives kcal = kcalPerServing * servings with
 * null preserved; manual-food PATCH keeps a supplied kcal total or re-derives
 * from the catalog food with a second keyed query (FOR UPDATE cannot target
 * the nullable side of the outer join). Guards run inside the transaction.
 */
export function buildDiaryMutationHandlers(deps: {
  getDb: () => Db;
  getSession: (headers: Headers) => Promise<{ user: { id: string } } | null>;
}) {
  const load = async (tx: Tx, userId: string, id: string): Promise<Loaded> => {
    const [row] = await tx.select({ entry: diaryEntries, foodKcal: foods.kcalPer100g, recipeKcal: recipes.kcalPerServing })
      .from(diaryEntries)
      .leftJoin(foods, eq(diaryEntries.foodId, foods.id))
      .leftJoin(recipes, eq(diaryEntries.recipeId, recipes.id))
      .where(and(eq(diaryEntries.id, id), eq(diaryEntries.userId, userId)));
    if (!row) return { entry: null, foodKcal: null, recipeKcal: null, guard: NOT_FOUND };
    if (row.entry.source !== "manual") {
      return { entry: null, foodKcal: null, recipeKcal: null,
        guard: NextResponse.json({ error: row.entry.source === "norish_sync" ? LOCKED : NOT_MANUAL }, { status: 403 }) };
    }
    return { entry: row.entry, foodKcal: row.foodKcal, recipeKcal: row.recipeKcal, guard: null };
  };
  const lock = async (tx: Tx, id: string) => {
    await tx.select({ id: diaryEntries.id }).from(diaryEntries).where(eq(diaryEntries.id, id)).for("update");
  };
  const overflow = () => NextResponse.json({ error: "Kcal troppo grandi." }, { status: 400 });
  return {
    async PATCH(request: Request, context: Context) {
      try {
        const session = await deps.getSession(request.headers);
        if (!session?.user) return NextResponse.json({ error: "Autenticazione richiesta." }, { status: 401 });
        if (!isAllowedRequestOrigin(request)) return NextResponse.json({ error: "Origine non consentita." }, { status: 403 });
        const { id } = await context.params;
        if (!z.uuid({ error: "Identificativo voce non valido." }).safeParse(id).success) return NOT_FOUND;
        const mediaType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
        if (mediaType !== "application/json") return NextResponse.json({ error: "Usa Content-Type application/json." }, { status: 400 });
        let body: unknown;
        try { body = await request.json(); }
        catch { return NextResponse.json({ error: "JSON non valido." }, { status: 400 }); }
        const parsed = patchSchema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dati della voce non validi." }, { status: 400 });
        const input = parsed.data;
        return await deps.getDb().transaction(async (tx) => {
          const loaded = await load(tx, session.user.id, id);
          if (loaded.guard) return loaded.guard;
          const entry = loaded.entry!;
          await lock(tx, id);
          const updates: Record<string, unknown> = { updatedAt: new Date() };
          if (input.date !== undefined) updates.date = input.date;
          if (input.slot !== undefined) updates.slot = input.slot;
          if (input.quantityGrams !== undefined) updates.quantityGrams = String(input.quantityGrams);
          if (input.kcal !== undefined) updates.kcal = input.kcal;
          if (input.servings !== undefined) updates.servings = String(input.servings);
          if (entry.entryType === "food") {
            if (input.nutrients !== undefined) Object.assign(updates, nutritionColumns(normalizeNutrition(input.nutrients)));
            else if (input.quantityGrams !== undefined) Object.assign(updates, nutritionColumns(scaleNutrition(normalizeNutrition(entry.nutrients, { protein: entry.protein, fat: entry.fat, carbs: entry.carbs }), input.quantityGrams / Number(entry.quantityGrams ?? input.quantityGrams))));
            if (input.servings !== undefined) return NextResponse.json({ error: "Le porzioni si applicano solo alle ricette." }, { status: 400 });
            if (input.quantityGrams !== undefined && input.kcal === undefined) {
              const basis = entry.copiedMeal ? entry.kcal : loaded.foodKcal;
              const factor = entry.copiedMeal ? input.quantityGrams / Number(entry.quantityGrams ?? input.quantityGrams) : input.quantityGrams / 100;
              const total = basis === null ? null : Math.round(basis * factor);
              if (total !== null && !kcal.safeParse(total).success) return overflow();
              updates.kcal = total;
            }
          } else {
            if (input.nutrients !== undefined) return NextResponse.json({ error: "I nutrienti della ricetta vengono ricalcolati dalle porzioni." }, { status: 400 });
            if (input.quantityGrams !== undefined) return NextResponse.json({ error: "I grammi si applicano solo agli alimenti." }, { status: 400 });
            if (input.kcal !== undefined) return NextResponse.json({ error: "Le kcal della ricetta vengono ricalcolate dalle porzioni." }, { status: 400 });
            if (input.servings !== undefined) {
              const basis = entry.copiedMeal ? entry.kcal : loaded.recipeKcal;
              const factor = entry.copiedMeal ? input.servings / Number(entry.servings ?? 1) : input.servings;
              const total = basis === null ? null : Math.round(basis * factor);
              if (total !== null && !kcal.safeParse(total).success) return overflow();
              updates.kcal = total;
              if (entry.copiedMeal) Object.assign(updates, nutritionColumns(scaleNutrition(normalizeNutrition(entry.nutrients, { protein: entry.protein, fat: entry.fat, carbs: entry.carbs }), factor)));
              else {
                const [recipe] = await tx.select().from(recipes).where(eq(recipes.id, entry.recipeId!));
                Object.assign(updates, nutritionColumns(scaleNutrition(normalizeNutrition(recipe?.nutrientsPerServing, { protein: recipe?.proteinPerServing, fat: recipe?.fatPerServing, carbs: recipe?.carbsPerServing }), factor)));
              }
            }
          }
          const [updated] = await tx.update(diaryEntries).set(updates).where(eq(diaryEntries.id, id)).returning();
          return NextResponse.json({ entry: updated });
        });
      } catch (error) {
        if (error instanceof Error && error.message === "Nutrition overflow") return NextResponse.json({ error: "Quantità e nutrienti superano i limiti supportati." }, { status: 400 });
        return NextResponse.json({ error: "Non è stato possibile aggiornare la voce. Riprova." }, { status: 500 });
      }
    },
    async DELETE(request: Request, context: Context) {
      try {
        const session = await deps.getSession(request.headers);
        if (!session?.user) return NextResponse.json({ error: "Autenticazione richiesta." }, { status: 401 });
        if (!isAllowedRequestOrigin(request)) return NextResponse.json({ error: "Origine non consentita." }, { status: 403 });
        const { id } = await context.params;
        if (!z.uuid({ error: "Identificativo voce non valido." }).safeParse(id).success) return NOT_FOUND;
        return await deps.getDb().transaction(async (tx) => {
          const loaded = await load(tx, session.user.id, id);
          if (loaded.guard) return loaded.guard;
          await lock(tx, id);
          await tx.delete(diaryEntries).where(eq(diaryEntries.id, id));
          return NextResponse.json({ ok: true });
        });
      } catch {
        return NextResponse.json({ error: "Non è stato possibile eliminare la voce. Riprova." }, { status: 500 });
      }
    },
  };
}
