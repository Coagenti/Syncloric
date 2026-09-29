import { z } from "zod";

/**
 * Lookup cibi (§ 3 services/foods): ricerca barcode su OPEN FOOD FACTS.
 * La UI non parla direttamente con l'esterno: solo lookup server-side, con
 * caching della risposta (§ 6.6, evita rate-limit del servizio pubblico).
 */

const offProductSchema = z.object({
  code: z.string(),
  product_name: z.string().nullish(),
  brands: z.string().nullish(),
  serving_size: z.string().nullish(),
  nutriments: z
    .object({
      "energy-kcal_100g": z.number().nullish(),
      proteins_100g: z.number().nullish(),
      fat_100g: z.number().nullish(),
      carbohydrates_100g: z.number().nullish(),
    })
    .nullish(),
});
export type OffProduct = z.infer<typeof offProductSchema>;

export interface FoodLookupResult {
  barcode: string;
  name: string;
  brand: string | null;
  kcalPer100g: number | null;
  proteinPer100g: number | null;
  fatPer100g: number | null;
  carbsPer100g: number | null;
  servingGrams: number | null;
  raw: OffProduct;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1_000; // 24h: risposta pubblica, serve a limitare le chiamate (§ 6.6)

const cache = new Map<string, { result: FoodLookupResult | null; expiresAt: number }>();

function parseServingGrams(servingSize: string | null | undefined): number | null {
  if (!servingSize) return null;
  const match = /([0-9]+(?:\.[0-9]+)?)\s*g/i.exec(servingSize);
  return match ? Math.round(parseFloat(match[1])) : null;
}

/**
 * Lookup barcode su Open Food Facts (v2 del prodotto). Ritorna NULL se il
 * prodotto non esiste (404) — il chiamante proporrà il flusso "crea cibo".
 */
export async function lookupBarcode(
  barcode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FoodLookupResult | null> {
  const cached = cache.get(barcode);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImpl(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`,
      { headers: { Accept: "application/json" }, signal: controller.signal },
    );
    if (response.status === 404) {
      cache.set(barcode, { result: null, expiresAt: Date.now() + CACHE_TTL_MS });
      return null;
    }
    if (!response.ok) {
      throw new Error(`Open Food Facts: HTTP ${response.status}`);
    }
    const json = (await response.json()) as { status?: number; product?: unknown };
    // status 0 = prodotto non trovato (risposta 200 con status flag)
    if (json.status === 0 || !json.product) {
      cache.set(barcode, { result: null, expiresAt: Date.now() + CACHE_TTL_MS });
      return null;
    }
    const parsed = offProductSchema.parse(json.product);
    const nutriments = parsed.nutriments ?? {};
    const result: FoodLookupResult = {
      barcode: parsed.code,
      name: parsed.product_name?.trim() || "Prodotto senza nome",
      brand: parsed.brands?.split(",")[0]?.trim() ?? null,
      kcalPer100g: nutriments["energy-kcal_100g"] ?? null,
      proteinPer100g: nutriments.proteins_100g ?? null,
      fatPer100g: nutriments.fat_100g ?? null,
      carbsPer100g: nutriments.carbohydrates_100g ?? null,
      servingGrams: parseServingGrams(parsed.serving_size),
      raw: parsed,
    };
    cache.set(barcode, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } finally {
    clearTimeout(timer);
  }
}