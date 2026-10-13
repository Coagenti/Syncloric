import { z } from "zod";
import type { EntryFood } from "@/lib/food-entry";
import { normalizeOffProduct } from "./lookup";
import { per100gSchema } from "@/lib/nutrition";

const TTL = 10 * 60 * 1000;
export class FoodSearchBusy extends Error { constructor(public retryAfter = 6) { super("Search rate limit"); } }
const productSchema = z.object({ code: z.string(), product_name: z.string().nullish(), product_name_it: z.string().nullish(), brands: z.union([z.string(), z.array(z.string())]).nullish(), serving_size: z.string().nullish(), nutriments: z.record(z.string(), z.unknown()).nullish() });
/** OFF Search-a-licious supports full text; v2 search does not.
 * Cache public results only; coalesce equal requests and start at most 10/minute.
 * Limits are per server process (multi-replica deployments need a shared limiter).
 */
export function createFoodSearch(fetchImpl: typeof fetch = fetch, now = Date.now) {
  const cache = new Map<string, { value: { foods: EntryFood[]; hasMore: boolean }; expires: number }>();
  const pending = new Map<string, Promise<{ foods: EntryFood[]; hasMore: boolean }>>();
  let nextRequest = 0;
  return async function search(query: string, page = 1, country: "it" | "all" = "it") {
    const key = JSON.stringify([query.trim().toLocaleLowerCase("it"), page, country]);
    const cached = cache.get(key);
    if (cached && cached.expires > now()) return cached.value;
    if (pending.has(key)) return pending.get(key)!;
    if (now() < nextRequest) throw new FoodSearchBusy(Math.ceil((nextRequest - now()) / 1000));
    nextRequest = now() + 6000;
    const task = (async () => {
      // A plain food name, never user-supplied Lucene operators or field filters.
      const terms = query.toLocaleLowerCase("it").match(/[\p{L}\p{N}]+/gu)?.join(" ") ?? "";
      if (!terms) throw new Error("Empty search terms");
      const q = `${terms}${country === "it" ? ' AND countries_tags:"en:italy"' : ""}`;
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetchImpl("https://search.openfoodfacts.org/search", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "Syncloric/0.1 (https://github.com/Coagenti/Syncloric)" }, body: JSON.stringify({ q, langs: ["it", "en"], page, page_size: 20, fields: ["code", "product_name", "product_name_it", "brands", "nutriments", "serving_size"] }), signal: controller.signal });
        if (response.status === 429) { nextRequest = now() + 60000; throw new FoodSearchBusy(60); }
        if (!response.ok) throw new Error("OFF unavailable");
        // Bound even chunked responses rather than buffering an unbounded JSON body.
        const reader = response.body?.getReader(); if (!reader) throw new Error("Empty OFF response");
        let size = 0; const chunks: Uint8Array[] = [];
        try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 2 * 1024 * 1024) throw new Error("OFF response too large"); chunks.push(value); } }
        finally { await reader.cancel(); }
        const data = z.object({ hits: z.array(z.unknown()), count: z.number().optional() }).parse(JSON.parse(Buffer.concat(chunks).toString()));
        const seen = new Set<string>();
        const foods = data.hits.slice(0, 20).flatMap(raw => {
          const parsed = productSchema.safeParse(raw); if (!parsed.success || !/^\d{8,14}$/.test(parsed.data.code) || seen.has(parsed.data.code)) return [];
          const product = parsed.data;
          const normalized = normalizeOffProduct({ ...product, brands: Array.isArray(product.brands) ? product.brands.join(",") : product.brands, product_name: product.product_name_it || product.product_name });
          if (!normalized.name || normalized.kcalPer100g !== null && normalized.kcalPer100g > 10000 || !per100gSchema.safeParse(normalized.nutrientsPer100g).success) return [];
          seen.add(product.code);
          return [{ barcode: product.code, name: normalized.name.slice(0, 200), brand: normalized.brand?.slice(0, 200) ?? null, kcalPer100g: normalized.kcalPer100g, nutrientsPer100g: normalized.nutrientsPer100g, source: "barcode_off", portions: normalized.servingGrams ? [{ id: "00000000-0000-4000-8000-000000000001", label: "Porzione", grams: normalized.servingGrams, defaultQuantity: 1 }] : [] } satisfies EntryFood];
        });
        const value = { foods, hasMore: page < 20 && (data.count !== undefined ? page * 20 < data.count : data.hits.length === 20) };
        if (cache.size >= 200) cache.delete(cache.keys().next().value!);
        cache.set(key, { value, expires: now() + TTL }); return value;
      } finally { clearTimeout(timer); }
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  };
}
export const searchFoods = createFoodSearch();
