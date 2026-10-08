import { asc, ilike } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { Db } from "@/server/db";
import { foods, recipes } from "@/server/db/schema";

/** Read-only shared local catalog; authentication precedes validation and DB access. */
export function buildDiaryCatalogHandlers(deps: {
  getDb: () => Db;
  getSession: (headers: Headers) => Promise<{ user: { id: string } } | null>;
}) {
  const headers = { "Cache-Control": "private, no-store" };
  return { async GET(request: Request) {
    try {
      const session = await deps.getSession(request.headers);
      if (!session?.user) return NextResponse.json({ error: "Autenticazione richiesta." }, { status: 401, headers });
      const params = new URL(request.url).searchParams;
      const rawLimit = params.get("limit") ?? "20";
      const limit = Number(rawLimit);
      if (!/^\d+$/.test(rawLimit) || limit < 1 || limit > 50) return NextResponse.json({ error: "Limite non valido." }, { status: 400, headers });
      const prefix = (params.get("query") ?? "").trim().replace(/[\\%_]/g, "\\$&");
      const db = deps.getDb();
      const [foodRows, recipeRows] = await Promise.all([
        db.select({ id: foods.id, name: foods.name, brand: foods.brand, kcalPer100g: foods.kcalPer100g, nutrientsPer100g: foods.nutrientsPer100g, protein: foods.proteinPer100g, fat: foods.fatPer100g, carbs: foods.carbsPer100g, servingGrams: foods.servingGrams, servingLabel: foods.servingLabel, source: foods.source }).from(foods)
          .where(prefix ? ilike(foods.name, `${prefix}%`) : undefined).orderBy(asc(foods.name), asc(foods.id)).limit(limit),
        db.select({ id: recipes.id, name: recipes.name, servings: recipes.servings, kcalPerServing: recipes.kcalPerServing, nutrientsPerServing: recipes.nutrientsPerServing }).from(recipes).orderBy(asc(recipes.name), asc(recipes.id)),
      ]);
      return NextResponse.json({ foods: foodRows.map(food => ({ ...food, servingGrams: food.servingGrams === null ? null : Number(food.servingGrams) })), recipes: recipeRows }, { headers });
    } catch {
      return NextResponse.json({ error: "Non è stato possibile caricare il catalogo. Riprova." }, { status: 500, headers });
    }
  } };
}
