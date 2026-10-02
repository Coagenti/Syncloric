import { z } from "zod";

/**
 * Lookup cibi (§ 3 services/foods): ricerca barcode su OPEN FOOD FACTS.
 * La UI non parla direttamente con l'esterno: solo lookup server-side, con
 * caching della risposta (§ 6.6, evita rate-limit del servizio pubblico).
 */

const offProductSchema = z.object({
  code: z.string().optional(),
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
export type OffProductPayload = Partial<OffProduct>;

/** Missing nutrients remain unknown, never fabricated as zero. */
export function normalizeOffProduct(product: OffProductPayload) {
  const nutrient = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  const kcal = nutrient(product.nutriments?.["energy-kcal_100g"]);
  return {
    name: product.product_name?.trim() || "",
    brand: product.brands?.split(",")[0]?.trim() || null,
    kcalPer100g: kcal === null ? null : Math.round(kcal),
    proteinPer100g: nutrient(product.nutriments?.proteins_100g),
    fatPer100g: nutrient(product.nutriments?.fat_100g),
    carbsPer100g: nutrient(product.nutriments?.carbohydrates_100g),
    servingGrams: parseServingGrams(product.serving_size),
  };
}

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
class PermanentLookupError extends Error {}
let queue: Promise<void> = Promise.resolve();
let nextRequest = 0;

/** One request start per second per instance, including retries/concurrent callers. */
async function throttle() {
  const turn = queue.then(async () => {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, nextRequest - Date.now())));
    nextRequest = Date.now() + 1000;
  });
  queue = turn.catch(() => {});
  await turn;
}

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

  if (!/^\d{8,14}$/.test(barcode)) throw new Error("Invalid barcode");
  for (let attempt = 0; attempt < 2; attempt++) {
    await throttle();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
    const response = await fetchImpl(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`,
      { method: "GET", headers: { Accept: "application/json", "User-Agent": "Syncloric/1.0 (self-hosted calorie diary)" }, signal: controller.signal },
    );
    if (response.status === 404) {
      cache.set(barcode, { result: null, expiresAt: Date.now() + CACHE_TTL_MS });
      return null;
    }
    if (!response.ok) {
      if (attempt === 0 && (response.status === 429 || response.status >= 500)) continue;
      throw new PermanentLookupError(`Open Food Facts: HTTP ${response.status}`);
    }
    const json = (await response.json()) as { status?: number; product?: unknown };
    // status 0 = prodotto non trovato (risposta 200 con status flag)
    if (json.status === 0 || !json.product) {
      cache.set(barcode, { result: null, expiresAt: Date.now() + CACHE_TTL_MS });
      return null;
    }
    const parsed = offProductSchema.parse(json.product);
    const result: FoodLookupResult = {
      barcode,
      ...normalizeOffProduct(parsed),
      raw: parsed,
    };
    cache.set(barcode, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
    } catch (error) {
      if (attempt === 1 || error instanceof z.ZodError || error instanceof PermanentLookupError) throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Lookup unavailable");
}