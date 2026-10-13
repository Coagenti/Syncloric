import { describe, expect, it, vi } from "vitest";
import { createFoodSearch, FoodSearchBusy } from "@/server/services/foods/search";
describe("Open Food Facts name search", () => {
  const payload = { count: 21, hits: [{ code: "8076809514064", product_name: "Biscuits", product_name_it: "Biscotti", brands: ["Marca"], serving_size: "6,25 g", nutriments: { "energy-kcal_100g": 450, proteins_100g: 7, "vitamin-c_100g": 0.01 } }, { code: "123", product_name: "Invalid" }, { code: "8001234567890", product_name: "Unknown energy" }] };
  it("uses official full-text search, market filter and minimal fields; preserves unknown nutrients", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(payload));
    const result = await createFoodSearch(fetcher as typeof fetch)("biscotti");
    const url = new URL(fetcher.mock.calls[0][0] as unknown as string);
    expect(url.href).toBe("https://search.openfoodfacts.org/search"); const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string); expect(body.q).toBe('biscotti AND countries_tags:"en:italy"'); expect(body.fields).toContain('nutriments');
    expect(result.hasMore).toBe(true); expect(result.foods).toHaveLength(2);
    expect(result.foods[0]).toMatchObject({ name: "Biscotti", nutrientsPer100g: { protein: 7, vitaminC: 10 }, portions: [{ grams: 6.25 }] });
    expect(result.foods[1].kcalPer100g).toBe(null); expect(result.foods[1].nutrientsPer100g).toEqual({});
  });
  it("coalesces requests, caches public results and throttles different searches", async () => {
    let now = 0; const fetcher = vi.fn<typeof fetch>(async () => Response.json(payload)); const search = createFoodSearch(fetcher as typeof fetch, () => now);
    await Promise.all([search("biscotti"), search("biscotti")]); expect(fetcher).toHaveBeenCalledTimes(1);
    await search("BISCOTTI"); expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(search("pasta")).rejects.toBeInstanceOf(FoodSearchBusy);
    now = 6000; await search("pasta", 1, "all"); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("backs off on upstream 429 and never caches failures", async () => {
    let now = 0; const fetcher = vi.fn(async () => new Response("", { status: 429 })); const search = createFoodSearch(fetcher as typeof fetch, () => now);
    await expect(search("pasta")).rejects.toMatchObject({ retryAfter: 60 }); now = 6000;
    await expect(search("pasta")).rejects.toMatchObject({ retryAfter: 54 }); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
