import { expect, it, vi } from "vitest";
import fixture from "../fixtures/openfoodfacts-product.json";
import { lookupBarcode } from "@/server/services/foods/lookup";
it("parses OFF without product.code and reuses cached response", async () => {
  const fetcher = vi.fn(async () => Response.json({ status: 1, product: fixture }));
  const result = await lookupBarcode("8000000000001", fetcher);
  expect(result).toMatchObject({ barcode: "8000000000001", kcalPer100g: 539 });
  await lookupBarcode("8000000000001", fetcher);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("returns null for 404 and retries transient HTTP errors with spaced GET calls", async () => {
  const times: number[] = [];
  const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    times.push(Date.now()); expect(init?.method).toBe("GET");
    return new Response(null, { status: times.length === 1 ? 503 : 404 });
  });
  expect(await lookupBarcode("8000000000002", fetcher)).toBeNull();
  expect(times[1] - times[0]).toBeGreaterThanOrEqual(950);
});
it("does not retry permanent HTTP errors", async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 400 }));
  await expect(lookupBarcode("8000000000003", fetcher)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("times out and retries with a fresh abort signal", async () => {
  vi.useFakeTimers();
  try {
    const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    const pending = expect(lookupBarcode("8000000000004", fetcher)).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(25000); await pending;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1]?.signal).not.toBe(fetcher.mock.calls[1][1]?.signal);
  } finally { vi.useRealTimers(); }
});
