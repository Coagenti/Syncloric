import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Db } from "@/server/db";
import { buildDiaryCatalogHandlers } from "@/server/services/diary/catalog";
import { makeTestDb, resetTables, closeTestDb, type TestDb } from "./setup";

describe("local diary catalog", () => {
  let db: TestDb;
  beforeAll(async () => { db = await makeTestDb(); });
  afterAll(closeTestDb);
  beforeEach(async () => {
    await resetTables(db);
    await db.execute(sql`INSERT INTO foods (name, kcal_per_100g, serving_grams, serving_label, source) VALUES ('Riso', 200, 125, 'ciotola', 'manual'), ('Riso integrale', 180, null, null, 'barcode_off'), ('Pasta', 350, null, null, 'manual'), ('R%_\\iso', 100, null, null, 'manual')`);
    await db.execute(sql`INSERT INTO recipes (name, servings, kcal_per_serving, snapshot) VALUES ('Zuppa', 4, null, '{}'::jsonb), ('Pasta', 2, 320, '{}'::jsonb)`);
  });
  const get = (query = "") => buildDiaryCatalogHandlers({ getDb: () => db as unknown as Db, getSession: async () => ({ user: { id: "session" } }) }).GET(new Request(`http://localhost/api/v1/diary/catalog${query}`));
  it("returns shared foods with numeric grams and complete ordered recipes", async () => {
    const response = await get("?query=ri&limit=1");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.foods).toEqual([expect.objectContaining({ name: "Riso", brand: null, kcalPer100g: 200, servingGrams: 125, servingLabel: "ciotola", source: "manual" })]);
    expect(body.recipes).toEqual([expect.objectContaining({ name: "Pasta", servings: 2, kcalPerServing: 320 }), expect.objectContaining({ name: "Zuppa", kcalPerServing: null })]);
  });
  it("escapes literal LIKE metacharacters and uses case-insensitive prefixes", async () => {
    expect((await (await get("?query=R%25_%5C")).json()).foods.map((f: { name: string }) => f.name)).toEqual(["R%_\\iso"]);
    expect((await (await get("?query=ISO")).json()).foods).toEqual([]);
    expect((await (await get("?query=RISO")).json()).foods).toHaveLength(2);
  });
  it.each(["0", "51", "abc", "1.5", "", "1e1"])("rejects invalid limit %s", async (limit) => {
    const response = await get(`?limit=${limit}`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Limite non valido." });
  });
});
