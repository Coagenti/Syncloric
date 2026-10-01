import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NorishClient, plannedRecipeSchema, recipeDetailSchema } from "@/server/services/norish/client";
import { PLANNED_RECIPE, RECIPE_DETAIL } from "../fixtures/norish";

/**
 * Resilience e segreto-sicurezza del client norish (§ 5.5, contratto § 6):
 * retry limitato 3 con backoff 2s/4s/8s su 429/5xx, timeout/network/timeout-body,
 * niente retry su 401/403 e 4xx di validazione; mai la apiKey nell'URL, negli
 * header sbagliati o nei messaggi d'errore. Zero rete: fetch iniettata.
 */

const KEY = "synthetic-secret-for-resilience";
const ID = String(RECIPE_DETAIL.id);

function setup() {
  const fetchImpl = vi.fn<typeof fetch>();
  const client = new NorishClient({ baseUrl: "https://upstream.invalid", apiKey: KEY, fetchImpl });
  return { client, fetchImpl };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("Norish resilience (strict TDD)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("retries HTTP 429/5xx for planned meals and recipe detail, three times after 2s, 4s, 8s", async () => {
    for (const status of [429, 500, 501, 502, 503, 504, 599]) {
      for (const recipe of [false, true]) {
        const { client, fetchImpl } = setup();
        fetchImpl.mockImplementation(async () => json({}, status));
        const result = (recipe ? client.getRecipe(ID) : client.getPlannedRecipesToday()).catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(13_999);
        expect(fetchImpl).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchImpl).toHaveBeenCalledTimes(4);
        expect(await result).toBeInstanceOf(Error);
        expect(vi.getTimerCount()).toBe(0);
      }
    }
  });

  it("retries network failures exactly three times after 2s, 4s, 8s", async () => {
    const { client, fetchImpl } = setup();
    fetchImpl.mockRejectedValue(new Error("ECONNREFUSED"));
    const result = client.getPlannedRecipesWeek().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    for (const [delay, count] of [[2000, 2], [4000, 3], [8000, 4]] as const) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(fetchImpl).toHaveBeenCalledTimes(count - 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchImpl).toHaveBeenCalledTimes(count);
    }
    expect(await result).toBeInstanceOf(Error);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not retry 401 and 403 (auth errors are not transient)", async () => {
    for (const status of [401, 403]) {
      for (const recipe of [false, true]) {
        const { client, fetchImpl } = setup();
        fetchImpl.mockImplementation(async () => json({}, status));
        const result = (recipe ? client.getRecipe(ID) : client.getPlannedRecipesToday()).catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(0);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        await vi.runAllTimersAsync();
        expect(await result).toBeInstanceOf(Error);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
      }
    }
  });

  it("does not retry 400 (validation is not transient)", async () => {
    for (const recipe of [false, true]) {
      const { client, fetchImpl } = setup();
      fetchImpl.mockImplementation(async () => json({}, 400));
      const result = (recipe ? client.getRecipe(ID) : client.getPlannedRecipesToday()).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await vi.runAllTimersAsync();
      expect(await result).toBeInstanceOf(Error);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it.each(["headers", "body"])("times out stalled %s at 10s per attempt, retries three times, surfaces TIMEOUT", async (phase) => {
    const { client, fetchImpl } = setup();
    const signals: AbortSignal[] = [];
    fetchImpl.mockImplementation(async (_url, init) => {
      signals.push(init!.signal as AbortSignal);
      if (phase === "headers") return new Promise<Response>(() => {}); // never resolves
      return new Response(new ReadableStream({ start() { /* never emits */ } }));
    });
    const result = client.getRecipe(ID).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(9999);
    expect(signals[0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // body deadline fired, no retry yet
    await vi.advanceTimersByTimeAsync(44_000);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const error = (await result) as { status?: number; code?: string };
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(0);
    expect(error.code).toBe("TIMEOUT");
    if (phase === "headers") expect(signals.every((s) => s.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not include apiKey in the outbound URL, headers, or message when the upstream echoes it", async () => {
    const { client, fetchImpl } = setup();
    fetchImpl.mockImplementation(async (url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(url).not.toContain(KEY);
      expect(headers["x-api-key"]).toBe(KEY);
      expect(headers.Authorization).toBeUndefined();
      return json({ message: `upstream echoed: ${KEY}` }, 401);
    });
    const result = client.getPlannedRecipesToday().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    const error = (await result) as Error;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain(KEY);
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // 401: no retries
  });

  it("does not expose apiKey in error message even when payload validation fails", async () => {
    const { client, fetchImpl } = setup();
    fetchImpl.mockImplementation(async () => json([{ id: "x", slot: "Lunch" }]));
    const result = client.getPlannedRecipesWeek().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    const error = (await result) as Error;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain(KEY);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers after one transient 503 with backoff", async () => {
    const { client, fetchImpl } = setup();
    let calls = 0;
    fetchImpl.mockImplementation(async () => {
      calls += 1;
      return calls === 1 ? json({}, 503) : json([PLANNED_RECIPE]);
    });
    const result = client.getPlannedRecipesToday();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toBe(2);
    expect(await result).toEqual([PLANNED_RECIPE]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns an empty array as a nominal 200 [] payload (contratto § 3)", async () => {
    const { client, fetchImpl } = setup();
    fetchImpl.mockImplementation(async () => json([]));
    expect(await client.getPlannedRecipesWeek()).toEqual([]);
    expect(await client.getPlannedRecipesToday()).toEqual([]);
    expect(await client.getPlannedRecipesMonth()).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("preserves GET-only contract and manual redirects", async () => {
    const { client, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(new Response(null, { status: 302, headers: { Location: "https://other.invalid/admin" } }));
    await client.request("GET", "/api/v1/health");
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(
      "https://upstream.invalid/api/v1/health",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("rejects non-GET methods before any transport (regression)", async () => {
    const { client, fetchImpl } = setup();
    await expect(client.request("POST", "/api/v1/health")).rejects.toThrow(/read-only/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts fractional servings and calories in planned and recipe schemas", () => {
    const planned = plannedRecipeSchema.parse({ ...PLANNED_RECIPE, servings: 2.5, calories: 458.5 });
    expect(planned.servings).toBe(2.5);
    expect(planned.calories).toBe(458.5);
    const detail = recipeDetailSchema.parse({ ...RECIPE_DETAIL, servings: 2.5, calories: 458.5 });
    expect(detail.servings).toBe(2.5);
    expect(detail.calories).toBe(458.5);
  });
});