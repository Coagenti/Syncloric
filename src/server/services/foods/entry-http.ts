import { and, asc, desc, eq, ilike, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db";
import { diaryEntries, foodPreferences, foods } from "@/server/db/schema";
import { normalizeNutrition, nutritionColumns, per100gSchema, scaleNutrition } from "@/lib/nutrition";
import { decimalAmount, foodPortionsSchema, legacyFoodPortions, portionColumns, portionSnapshotSchema, portionTotalGrams } from "@/lib/food-portions";
import { DIARY_SLOTS } from "@/lib/types/diary";
import { activeUser, checkOrigin, handle, HttpError, input, json, sessionUserId, type Deps } from "@/server/services/households/common";
import { FoodSearchBusy, searchFoods } from "./search";
import { getBarcodeEnabled } from "@/server/db/repositories/barcode-settings";
import { lookupBarcode } from "./lookup";

const productShape = {
  name: z.string().trim().min(1).max(200), brand: z.string().trim().max(200).nullable(),
  barcode: z.string().regex(/^\d{8,14}$/).nullable().optional(),
  kcalPer100g: z.number().int().min(0).max(10000), nutrientsPer100g: per100gSchema,
  portions: foodPortionsSchema,
};
const createSchema = z.object({ ...productShape, date: z.iso.date(), slot: z.enum(DIARY_SLOTS), quantityGrams: decimalAmount, portion: portionSnapshotSchema.nullable().optional() }).strict()
  .refine(v => !v.portion || portionTotalGrams(v.portion.grams, v.portion.quantity) === v.quantityGrams, "Porzione e grammi non corrispondono.");
const editSchema = z.object({ portions: foodPortionsSchema, product: z.object({ name: productShape.name, brand: productShape.brand, kcalPer100g: productShape.kcalPer100g, nutrientsPer100g: productShape.nutrientsPer100g }).strict().optional() }).strict();
function projection(food: typeof foods.$inferSelect, userId: string, portions = legacyFoodPortions(food)) {
  return { id: food.id, name: food.name, brand: food.brand, barcode: food.barcode, kcalPer100g: food.kcalPer100g, nutrientsPer100g: normalizeNutrition(food.nutrientsPer100g, { protein: food.proteinPer100g, fat: food.fatPer100g, carbs: food.carbsPer100g }), portions, source: food.source, canEdit: food.createdBy === userId };
}
export async function saveFoodPreferences(tx: Db | Parameters<Parameters<Db["transaction"]>[0]>[0], userId: string, foodId: string, portions: z.infer<typeof foodPortionsSchema>) {
  await tx.insert(foodPreferences).values({ userId, foodId, portions }).onConflictDoUpdate({ target: [foodPreferences.userId, foodPreferences.foodId], set: { portions, updatedAt: new Date() } });
}
/** All preferences, usage ranks and diary writes are owned by the live session. */
export function buildFoodEntryHandlers(deps: Deps & { search?: typeof searchFoods; lookup?: typeof lookupBarcode }) {
  async function owner(request: Request) { const id = await sessionUserId(deps, request); await activeUser(deps.getDb(), id); return id; }
  return {
    SEARCH: (request: Request) => handle(async () => {
      const userId = await owner(request); const params = new URL(request.url).searchParams;
      const parsed = z.object({ query: z.string().trim().min(2).max(100), page: z.coerce.number().int().min(1).max(20).default(1), country: z.enum(["it", "all"]).default("it") }).strict().safeParse(Object.fromEntries(params));
      if (!parsed.success) throw new HttpError("Scrivi almeno due caratteri per cercare.");
      const { query, page, country } = parsed.data; const db = deps.getDb();
      const local = page === 1 ? await db.select({ food: foods, portions: foodPreferences.portions }).from(foods).leftJoin(foodPreferences, and(eq(foodPreferences.foodId, foods.id), eq(foodPreferences.userId, userId)))
        .where(ilike(foods.name, `%${query.replace(/[\\%_]/g, "\\$&")}%`)).orderBy(asc(foods.name), asc(foods.id)).limit(20) : [];
      const localFoods = local.map(({ food, portions }) => projection(food, userId, portions ?? legacyFoodPortions(food)));
      if (!await getBarcodeEnabled(db)) return json({ local: localFoods, foods: [], hasMore: false, disabled: true });
      try { const result = await (deps.search ?? searchFoods)(query, page, country); return json({ local: localFoods, ...result }); }
      catch (error) {
        if (error instanceof FoodSearchBusy) return json({ local: localFoods, foods: [], hasMore: false, retryAfter: error.retryAfter, error: "Attendi qualche secondo e riprova la ricerca Open Food Facts." }, 429);
        return json({ local: localFoods, foods: [], hasMore: false, error: "Open Food Facts non è disponibile. Puoi usare il catalogo o inserire un alimento." }, 502);
      }
    }),
    FREQUENT: (request: Request) => handle(async () => {
      const userId = await owner(request); const slot = z.enum(DIARY_SLOTS).safeParse(new URL(request.url).searchParams.get("slot"));
      if (!slot.success) throw new HttpError("Pasto non valido.");
      const db = deps.getDb();
      const ranks = db.select({ foodId: diaryEntries.foodId, uses: sql<number>`count(*)::int`.as("uses"), recent: sql<string>`max(${diaryEntries.createdAt})`.as("recent") }).from(diaryEntries)
        .where(and(eq(diaryEntries.userId, userId), eq(diaryEntries.slot, slot.data), eq(diaryEntries.norishDeleted, false)))
        .groupBy(diaryEntries.foodId).as("ranks");
      const rows = await db.select({ food: foods, portions: foodPreferences.portions, uses: ranks.uses }).from(ranks).innerJoin(foods, eq(foods.id, ranks.foodId))
        .leftJoin(foodPreferences, and(eq(foodPreferences.foodId, foods.id), eq(foodPreferences.userId, userId)))
        .orderBy(desc(ranks.uses), desc(ranks.recent), asc(foods.id)).limit(20);
      return json({ foods: rows.map(({ food, portions, uses }) => ({ ...projection(food, userId, portions ?? legacyFoodPortions(food)), uses })) });
    }),
    GET: (request: Request, id: string) => handle(async () => {
      const userId = await owner(request); if (!z.uuid().safeParse(id).success) throw new HttpError("Alimento non trovato.", 404);
      const [row] = await deps.getDb().select({ food: foods, portions: foodPreferences.portions }).from(foods)
        .leftJoin(foodPreferences, and(eq(foodPreferences.foodId, foods.id), eq(foodPreferences.userId, userId))).where(eq(foods.id, id));
      if (!row) throw new HttpError("Alimento non trovato.", 404);
      return json({ food: projection(row.food, userId, row.portions ?? legacyFoodPortions(row.food)) });
    }),
    PATCH: (request: Request, id: string) => handle(async () => {
      const userId = await owner(request); checkOrigin(request); if (!z.uuid().safeParse(id).success) throw new HttpError("Alimento non trovato.", 404);
      const data = await input(request, editSchema);
      return deps.getDb().transaction(async tx => {
        const [food] = await tx.select().from(foods).where(eq(foods.id, id)).for("update"); if (!food) throw new HttpError("Alimento non trovato.", 404);
        if (data.product && food.createdBy !== userId) throw new HttpError("Puoi modificare i dati soltanto degli alimenti creati da te. Le tue porzioni sono sempre modificabili.", 403);
        if (data.product) await tx.update(foods).set({ ...data.product, nutrientsPer100g: normalizeNutrition(data.product.nutrientsPer100g), proteinPer100g: data.product.nutrientsPer100g.protein?.toFixed(2) ?? null, fatPer100g: data.product.nutrientsPer100g.fat?.toFixed(2) ?? null, carbsPer100g: data.product.nutrientsPer100g.carbs?.toFixed(2) ?? null, updatedAt: new Date() }).where(eq(foods.id, id));
        await saveFoodPreferences(tx, userId, id, data.portions);
        return json({ food: projection({ ...food, ...data.product, nutrientsPer100g: normalizeNutrition(data.product?.nutrientsPer100g ?? food.nutrientsPer100g) }, userId, data.portions) });
      });
    }),
    POST: (request: Request) => handle(async () => {
      const userId = await owner(request); checkOrigin(request); const data = await input(request, createSchema); const db = deps.getDb();
      const [existing] = data.barcode ? await db.select().from(foods).where(eq(foods.barcode, data.barcode)).limit(1) : [];
      const upstream = data.barcode && !existing && await getBarcodeEnabled(db) ? await (deps.lookup ?? lookupBarcode)(data.barcode).catch(() => null) : null;
      return db.transaction(async tx => {
        let food = existing;
        if (!food) {
          const inserted = await tx.insert(foods).values({ name: data.name, brand: data.brand, barcode: data.barcode, kcalPer100g: data.kcalPer100g, nutrientsPer100g: normalizeNutrition(data.nutrientsPer100g), portions: data.portions, source: upstream ? "barcode_off" : "manual", createdBy: userId })
            .onConflictDoNothing({ target: foods.barcode, where: sql`${foods.barcode} IS NOT NULL` }).returning();
          food = inserted[0]; if (!food && data.barcode) [food] = await tx.select().from(foods).where(eq(foods.barcode, data.barcode));
        }
        if (!food) throw new HttpError("Alimento non disponibile.", 409);
        await saveFoodPreferences(tx, userId, food.id, data.portions);
        const [entry] = await tx.insert(diaryEntries).values({ userId, date: data.date, slot: data.slot, entryType: "food", foodId: food.id, source: "manual", quantityGrams: String(data.quantityGrams), kcal: Math.round(food.kcalPer100g * data.quantityGrams / 100), ...portionColumns(data.portion), ...nutritionColumns(scaleNutrition(normalizeNutrition(food.nutrientsPer100g, { protein: food.proteinPer100g, fat: food.fatPer100g, carbs: food.carbsPer100g }), data.quantityGrams / 100)) }).returning({ id: diaryEntries.id });
        return json({ entry, food: projection(food, userId, data.portions) }, 201);
      });
    }),
  };
}
