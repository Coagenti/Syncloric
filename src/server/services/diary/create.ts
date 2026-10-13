import { isAllowedRequestOrigin } from "@/server/http/request-origin";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Db } from "@/server/db";
import { diaryEntries, foods, recipes, slotEnum } from "@/server/db/schema";
import { normalizeNutrition, scaleNutrition, nutritionColumns, nutritionSchema, per100gSchema } from "@/lib/nutrition";
import { foodPortionsSchema, portionColumns, portionSnapshotSchema, portionTotalGrams } from "@/lib/food-portions";
import { saveFoodPreferences } from "@/server/services/foods/entry-http";

const amount = z.number({ error: "Indica una quantità numerica positiva." })
  .positive("La quantità deve essere positiva.")
  .max(999999.99, "Quantità troppo grande.")
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001,
    "Usa al massimo due decimali per la quantità.");
const kcal = z.number({ error: "Indica le kcal totali della voce." })
  .int("Le kcal devono essere intere.").min(0, "Le kcal non possono essere negative.")
  .max(2147483647, "Kcal troppo grandi.");
const common = z.object({
  date: z.iso.date({ error: "Data non valida: usa YYYY-MM-DD." }),
  slot: z.enum(slotEnum.enumValues, { error: "Pasto non valido: usa Breakfast, Lunch, Dinner o Snack." }),
});
const inputSchema = z.discriminatedUnion("entryType", [
  common.extend({
    entryType: z.literal("food"),
    foodId: z.uuid({ error: "Identificativo alimento non valido." }).optional(),
    name: z.string({ error: "Indica il nome dell'alimento." }).trim()
      .min(1, "Indica il nome dell'alimento.").optional(),
    quantityGrams: amount,
    portion: portionSnapshotSchema.nullable().optional(),
    portions: foodPortionsSchema.optional(),
    kcal: kcal.optional(),
    nutrients: nutritionSchema.optional(),
  }).superRefine((input, ctx) => {
    if (input.portion && portionTotalGrams(input.portion.grams, input.portion.quantity) !== input.quantityGrams) ctx.addIssue({ code: "custom", message: "Porzione e grammi non corrispondono." });
    if (!input.foodId && (!input.name || input.kcal === undefined)) {
      ctx.addIssue({ code: "custom", message: "Per un nuovo alimento indica nome, quantità in grammi e kcal totali." });
    }
  }),
  common.extend({
    entryType: z.literal("recipe"),
    recipeId: z.uuid({ error: "Identificativo ricetta non valido." }),
    servings: amount,
  }),
], { error: "Tipo di voce non valido: usa food o recipe." });

/** Session-owned writes only. Food creation and diary insertion are atomic.
 * Manual kcal snapshots are totals; Norish sync snapshots remain per-serving.
 * Unknown input fields (including userId/source) are stripped by the schema.
 */
export function buildDiaryCreateHandlers(deps: {
  getDb: () => Db;
  getSession: (headers: Headers) => Promise<{ user: { id: string } } | null>;
}) {
  return {
    async POST(request: Request) {
      try {
        const session = await deps.getSession(request.headers);
        if (!session?.user) return NextResponse.json({ error: "Autenticazione richiesta." }, { status: 401 });
        if (!isAllowedRequestOrigin(request)) return NextResponse.json({ error: "Origine della richiesta non consentita." }, { status: 403 });
        const mediaType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
        if (mediaType !== "application/json") return NextResponse.json({ error: "Usa Content-Type application/json." }, { status: 400 });
        let body: unknown;
        try { body = await request.json(); }
        catch { return NextResponse.json({ error: "JSON non valido." }, { status: 400 }); }
        const parsed = inputSchema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dati della voce non validi." }, { status: 400 });
        const input = parsed.data;
        const overflow = () => NextResponse.json({ error: "Quantità e kcal superano i limiti supportati." }, { status: 400 });
        if (input.entryType === "food" && !input.foodId && !kcal.safeParse(Math.round(input.kcal! * 100 / input.quantityGrams)).success) return overflow();
        if (input.entryType === "food" && !input.foodId && !per100gSchema.safeParse(scaleNutrition(normalizeNutrition(input.nutrients), 100 / input.quantityGrams)).success) return NextResponse.json({ error: "Controlla i nutrienti totali rispetto ai grammi inseriti." }, { status: 400 });
        return await deps.getDb().transaction(async (tx) => {
          const commonValues = { userId: session.user.id, date: input.date, slot: input.slot, source: "manual" as const };
          if (input.entryType === "recipe") {
            const [recipe] = await tx.select().from(recipes).where(eq(recipes.id, input.recipeId));
            if (!recipe) return NextResponse.json({ error: "Ricetta non trovata." }, { status: 400 });
            const totalKcal = recipe.kcalPerServing === null ? null : Math.round(recipe.kcalPerServing * input.servings);
            if (totalKcal !== null && !kcal.safeParse(totalKcal).success) return overflow();
            const [entry] = await tx.insert(diaryEntries).values({
              ...commonValues, entryType: "recipe", recipeId: recipe.id,
              servings: String(input.servings), kcal: totalKcal,
              ...nutritionColumns(scaleNutrition(normalizeNutrition(recipe.nutrientsPerServing, { protein: recipe.proteinPerServing, fat: recipe.fatPerServing, carbs: recipe.carbsPerServing }), input.servings)),
            }).returning();
            return NextResponse.json({ entry }, { status: 201 });
          }
          const [food] = input.foodId
            ? await tx.select().from(foods).where(eq(foods.id, input.foodId))
            : await tx.insert(foods).values({
              // Refinement requires both fields for inline foods.
              name: input.name!, kcalPer100g: Math.round(input.kcal! * 100 / input.quantityGrams),
              source: "manual", createdBy: session.user.id,
              nutrientsPer100g: scaleNutrition(normalizeNutrition(input.nutrients), 100 / input.quantityGrams),
            }).returning();
          if (!food) return NextResponse.json({ error: "Alimento non trovato." }, { status: 400 });
          const totalKcal = input.foodId ? Math.round(food.kcalPer100g * input.quantityGrams / 100) : input.kcal!;
          if (!kcal.safeParse(totalKcal).success) return overflow();
          if (input.portions) await saveFoodPreferences(tx, session.user.id, food.id, input.portions);
          const [entry] = await tx.insert(diaryEntries).values({
            ...commonValues, entryType: "food", foodId: food.id,
            quantityGrams: String(input.quantityGrams), kcal: totalKcal,
            ...portionColumns(input.portion),
            ...nutritionColumns(input.foodId ? scaleNutrition(normalizeNutrition(food.nutrientsPer100g, { protein: food.proteinPer100g, fat: food.fatPer100g, carbs: food.carbsPer100g }), input.quantityGrams / 100) : normalizeNutrition(input.nutrients)),
          }).returning();
          return NextResponse.json({ entry }, { status: 201 });
        });
      } catch (error) {
        if (error instanceof Error && error.message === "Nutrition overflow") return NextResponse.json({ error: "Quantità e nutrienti superano i limiti supportati." }, { status: 400 });
        return NextResponse.json({ error: "Non è stato possibile salvare la voce. Riprova." }, { status: 500 });
      }
    },
  };
}
