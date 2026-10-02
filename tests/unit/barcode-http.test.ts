import { expect, it, vi } from "vitest";
import { buildBarcodeHandlers } from "@/server/services/foods/http";
import payload from "../fixtures/new-food-payload.json";
it("rejects impossible per-100g macros before touching the database", async () => {
  const getDb = vi.fn(() => { throw new Error("must not query"); });
  const api = buildBarcodeHandlers({ getDb, getSession: async () => ({ user: { id: "test" } }) });
  const response = await api.POST(new Request("http://localhost/api/v1/barcode", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ ...payload, barcode: "8001234567890", proteinPer100g: 10000 }) }));
  expect(response.status).toBe(400); expect(getDb).not.toHaveBeenCalled();
});
it.each([0.001, 1.234])("rejects grams outside DB precision: %s", async grams => {
  const getDb = vi.fn(() => { throw new Error("must not query"); });
  const api = buildBarcodeHandlers({ getDb, getSession: async () => ({ user: { id: "test" } }) });
  const response = await api.POST(new Request("http://localhost/api/v1/barcode", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, barcode: "8001234567890", grams }) }));
  expect(response.status).toBe(400); expect(getDb).not.toHaveBeenCalled();
});
it.each(["GET", "POST"] as const)("sanitizes rejected session dependency for %s", async method => {
  const api = buildBarcodeHandlers({ getDb: () => { throw new Error("must not query"); }, getSession: async () => { throw new Error("private-session-failure"); } });
  const response = await api[method](new Request("http://localhost/api/v1/barcode?code=8001234567890", { method }));
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.text()).not.toContain("private-session-failure");
});
