import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import fixture from "../fixtures/openfoodfacts-product.json";
import newFood from "../fixtures/new-food-payload.json";
import { lookupBarcode } from "@/server/services/foods/lookup";
import type { Db } from "@/server/db";
import { buildBarcodeHandlers } from "@/server/services/foods/http";
import { makeTestDb, closeTestDb, resetTables, type TestDb } from "./setup";
const userId = "11111111-1111-4111-8111-111111111111";
let db: TestDb;
beforeAll(async () => { db = await makeTestDb(); });
afterAll(closeTestDb);
beforeEach(async () => {
  await resetTables(db);
  await db.execute(sql`INSERT INTO users (id, username) VALUES (${userId}::uuid, 'barcode-user')`);
});
const lookup = vi.fn(async () => null);
const handlers = () => buildBarcodeHandlers({ getDb: () => db as unknown as Db, getSession: async () => ({ user: { id: userId } }), lookup });
const get = () => new Request("http://localhost/api/v1/barcode?code=8001234567890");
const post = () => new Request("http://localhost/api/v1/barcode", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ barcode: "8001234567890", name: "Snack", kcalPer100g: 400, proteinPer100g: 10, grams: 25, date: "2026-10-01", slot: "Snack" }) });
it("unknown barcode offers new product; confirmation persists proportional kcal and next lookup is local", async () => {
  lookup.mockClear();
  expect(await (await handlers().GET(get())).json()).toMatchObject({ origin: "unknown", food: null });
  expect((await handlers().POST(post())).status).toBe(201);
  const rows = await db.execute(sql`SELECT kcal, protein, source, user_id FROM diary_entries`);
  expect(rows.rows[0]).toMatchObject({ kcal: 100, protein: "2.50", source: "manual", user_id: userId });
  lookup.mockClear();
  expect(await (await handlers().GET(get())).json()).toMatchObject({ origin: "local", food: { name: "Snack" } });
  expect(lookup).not.toHaveBeenCalled();
  expect((await handlers().POST(post())).status).toBe(201);
  expect((await db.execute(sql`SELECT count(*)::int AS n FROM foods`)).rows[0].n).toBe(1);
});
it("rejects anonymous access and cross-origin writes", async () => {
  const anonymous = buildBarcodeHandlers({ getDb: () => db as unknown as Db, getSession: async () => null, lookup });
  expect((await anonymous.GET(get())).status).toBe(401);
  const req = post(); req.headers.set("origin", "https://evil.invalid");
  expect((await handlers().POST(req)).status).toBe(403);
  const plain = post(); plain.headers.set("content-type", "text/plain");
  expect((await handlers().POST(plain)).status).toBe(400);
});
it("provider error is structured and does not expose upstream details", async () => {
  lookup.mockRejectedValueOnce(new Error("sensitive-provider-detail"));
  const response = await handlers().GET(get());
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain("sensitive-provider-detail");
});
it("barcode migration is idempotent and unique only for non-null codes", async () => {
  const migration = await readFile("drizzle/0002_barcode_partial.sql", "utf8");
  for (let run = 0; run < 2; run++) {
    for (const statement of migration.split("--> statement-breakpoint")) await db.execute(sql.raw(statement));
  }
  const index = await db.execute(sql`SELECT indexdef FROM pg_indexes WHERE indexname = 'foods_barcode_unique'`);
  expect(index.rows[0].indexdef).toContain("WHERE (barcode IS NOT NULL)");
});
it("OFF HTTP fixture prefill and confirmation persist provenance then bypass the provider", async () => {
  const fetcher = vi.fn(async () => Response.json({ status: 1, product: fixture }));
  const httpLookup = vi.fn((code: string) => lookupBarcode(code, fetcher));
  const api = buildBarcodeHandlers({ getDb: () => db as unknown as Db, getSession: async () => ({ user: { id: userId } }), lookup: httpLookup });
  const url = "http://localhost/api/v1/barcode?code=8000000000099";
  expect(await (await api.GET(new Request(url))).json()).toMatchObject({ origin: "off", food: { name: fixture.product_name, kcalPer100g: 539, proteinPer100g: 6.3 } });
  const response = await api.POST(new Request("http://localhost/api/v1/barcode", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ ...newFood, barcode: "8000000000099", name: fixture.product_name, kcalPer100g: 539 }) }));
  expect(response.status).toBe(201);
  expect((await db.execute(sql`SELECT source FROM foods`)).rows[0].source).toBe("barcode_off");
  expect((await db.execute(sql`SELECT kcal FROM diary_entries`)).rows[0].kcal).toBe(431);
  httpLookup.mockClear();
  expect(await (await api.GET(new Request(url))).json()).toMatchObject({ origin: "local" });
  expect(httpLookup).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1);
});
