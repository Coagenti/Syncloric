import { isAllowedRequestOrigin } from "@/server/http/request-origin";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { NextResponse } from "next/server";
import type { Db } from "@/server/db";
import { foods, diaryEntries } from "@/server/db/schema";
import { lookupBarcode } from "./lookup";
import { getBarcodeEnabled } from "@/server/db/repositories/barcode-settings";
import { normalizeNutrition, per100gSchema, scaleNutrition, nutritionColumns } from "@/lib/nutrition";

const barcode = z.string().regex(/^\d{8,14}$/);
const nutrient = z.number().finite().min(0).max(100).nullable().optional();
const input = z.object({
  barcode, name: z.string().trim().min(1).max(200), brand: z.string().trim().max(200).nullable().optional(),
  kcalPer100g: z.number().int().min(0).max(10000), proteinPer100g: nutrient, fatPer100g: nutrient, carbsPer100g: nutrient,
  nutrientsPer100g: per100gSchema.optional(),
  grams: z.number().finite().min(0.01).max(100000).multipleOf(0.01),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d => { const date = new Date(d); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === d; }),
  slot: z.enum(["Breakfast", "Lunch", "Snack", "Dinner"]),
});
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/** Session-scoped diary writes, shared catalog, GET-only upstream access. */
export function buildBarcodeHandlers(deps: {
  getDb: () => Db;
  getSession: (headers: Headers) => Promise<{ user: { id: string } } | null>;
  lookup?: typeof lookupBarcode;
}) {
  const lookup = deps.lookup ?? lookupBarcode;
  return {
    async GET(request: Request) {
      let session: Awaited<ReturnType<typeof deps.getSession>>;
      try { session = await deps.getSession(request.headers); }
      catch { return json({ error: "Accesso temporaneamente non disponibile. Riprova." }, 503); }
      if (!session?.user) return json({ error: "Autenticazione richiesta." }, 401);
      const code = barcode.safeParse(new URL(request.url).searchParams.get("code"));
      if (!code.success) return json({ error: "Codice non valido: usa da 8 a 14 cifre." }, 400);
      try {
        const [local] = await deps.getDb().select().from(foods).where(eq(foods.barcode, code.data)).limit(1);
        if (local) return json({ origin: "local", food: local });
        const product = await getBarcodeEnabled(deps.getDb()) ? await lookup(code.data) : null;
        return json({ origin: product ? "off" : "unknown", food: product });
      } catch { return json({ error: "Ricerca non disponibile. Riprova o registra il prodotto manualmente." }, 502); }
    },
    async POST(request: Request) {
      let session: Awaited<ReturnType<typeof deps.getSession>>;
      try { session = await deps.getSession(request.headers); }
      catch { return json({ error: "Accesso temporaneamente non disponibile. Riprova." }, 503); }
      if (!session?.user) return json({ error: "Autenticazione richiesta." }, 401);
      if (!isAllowedRequestOrigin(request)) return json({ error: "Origine non consentita." }, 403);
      if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return json({ error: "Invia dati JSON." }, 400);
      let body: unknown;
      try { body = await request.json(); } catch { return json({ error: "Dati non validi." }, 400); }
      const parsed = input.safeParse(body);
      if (!parsed.success) return json({ error: "Controlla codice, nome, nutrienti, data e grammi." }, 400);
      const data = parsed.data;
      try {
        const db = deps.getDb();
        const [existing] = await db.select().from(foods).where(eq(foods.barcode, data.barcode)).limit(1);
        // Provenance is resolved on the server, not trusted from client input.
        const product = existing || !await getBarcodeEnabled(db) ? null : await lookup(data.barcode).catch(() => null);
        const result = await db.transaction(async tx => {
          const decimal = (n: number | null | undefined) => n == null ? null : n.toFixed(2);
          await tx.insert(foods).values({
            barcode: data.barcode, name: data.name, brand: data.brand || null,
            kcalPer100g: data.kcalPer100g, proteinPer100g: decimal(data.proteinPer100g),
            fatPer100g: decimal(data.fatPer100g), carbsPer100g: decimal(data.carbsPer100g),
            nutrientsPer100g: normalizeNutrition(data.nutrientsPer100g, { protein: data.proteinPer100g, fat: data.fatPer100g, carbs: data.carbsPer100g }),
            source: product ? "barcode_off" : "manual", createdBy: session.user.id,
          }).onConflictDoNothing({ target: foods.barcode, where: sql`${foods.barcode} IS NOT NULL` });
          const [food] = await tx.select().from(foods).where(eq(foods.barcode, data.barcode)).limit(1);
          const [entry] = await tx.insert(diaryEntries).values({
            userId: session.user.id, date: data.date, slot: data.slot, entryType: "food", foodId: food.id,
            quantityGrams: data.grams.toFixed(2), kcal: Math.round(food.kcalPer100g * data.grams / 100),
            source: "manual",
            ...nutritionColumns(scaleNutrition(normalizeNutrition(food.nutrientsPer100g, { protein: food.proteinPer100g, fat: food.fatPer100g, carbs: food.carbsPer100g }), data.grams / 100)),
          }).returning({ id: diaryEntries.id });
          return entry;
        });
        return json(result, 201);
      } catch { return json({ error: "Non è stato possibile salvare. Riprova." }, 500); }
    },
  };
}
