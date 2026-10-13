import { z } from "zod";
import { nutrientSpecs, type Nutrition } from "@/lib/nutrition";

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
    }).catchall(z.unknown())
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
    nutrientsPer100g: normalizeOffNutrients(product.nutriments ?? {}),
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
  nutrientsPer100g?: Nutrition;
  servingGrams: number | null;
  raw: OffProduct;
}

const offKeys: Record<string, string> = { protein: "proteins", carbs: "carbohydrates", fat: "fat", saturatedFat: "saturated-fat", sugars: "sugars", fiber: "fiber", salt: "salt", sodium: "sodium", potassium: "potassium", calcium: "calcium", magnesium: "magnesium", phosphorus: "phosphorus", iron: "iron", zinc: "zinc", copper: "copper", manganese: "manganese", selenium: "selenium", iodine: "iodine", vitaminA: "vitamin-a", vitaminD: "vitamin-d", vitaminE: "vitamin-e", vitaminK: "vitamin-k", vitaminC: "vitamin-c", vitaminB1: "vitamin-b1", vitaminB2: "vitamin-b2", vitaminB3: "vitamin-pp", vitaminB5: "pantothenic-acid", vitaminB6: "vitamin-b6", vitaminB7: "biotin", vitaminB9: "folates", vitaminB12: "vitamin-b12", cholesterol: "cholesterol" };
/** OFF _100g mass values are normalized grams, independent of the label's _unit. */
export function normalizeOffNutrients(values: Record<string, unknown>): Nutrition {
  return Object.fromEntries(nutrientSpecs.flatMap(spec => {
    const raw = values[`${offKeys[spec.key]}_100g`];
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 100) return [];
    return [[spec.key, Math.round(raw * (spec.unit === "g" ? 1 : spec.unit === "mg" ? 1000 : 1000000) * 1e6) / 1e6]];
  })) as Nutrition;
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
  const match = /([0-9]+(?:[.,][0-9]+)?)\s*g\b/i.exec(servingSize);
  const grams = match ? Math.round(Number(match[1].replace(",", ".")) * 100) / 100 : 0;
  return grams > 0 && grams <= 999999.99 ? grams : null;
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
