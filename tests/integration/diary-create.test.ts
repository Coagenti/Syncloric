import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Db } from "@/server/db";
import { buildDiaryCreateHandlers } from "@/server/services/diary/create";
import { buildDiaryFeedHandlers } from "@/server/services/diary/feed";
import { makeTestDb, resetTables, closeTestDb, type TestDb } from "./setup";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const FOOD = "aaaaaaaa-1111-4111-8111-111111111111";
const base = { date: "2026-09-29", slot: "Lunch", entryType: "food", foodId: FOOD, quantityGrams: 150 };

describe("POST diary manual entries", () => {
  let db: TestDb;
  beforeAll(async () => { db = await makeTestDb(); });
  afterAll(closeTestDb);
  beforeEach(async () => {
    await resetTables(db);
    await db.execute(sql`INSERT INTO users (id, username) VALUES (${A}::uuid, 'a'), (${B}::uuid, 'b')`);
    await db.execute(sql`INSERT INTO foods (id, name, kcal_per_100g) VALUES (${FOOD}::uuid, 'Riso', 200)`);
  });
  const deps = (user: string | null = A) => ({ getDb: () => db as unknown as Db, getSession: async () => user ? { user: { id: user } } : null });
  const post = (body: unknown, user: string | null = A) => buildDiaryCreateHandlers(deps(user)).POST(new Request("http://localhost/api/v1/diary", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: JSON.stringify(body) }));
  const feed = async (user = A) => (await buildDiaryFeedHandlers(deps(user)).GET(new Request("http://localhost/api/v1/diary?month=2026-09"))).json();

  it("creates an inline manual food and stores the supplied total kcal", async () => {
    const response = await post({ date: base.date, slot: "Snack", entryType: "food", name: "  Yogurt  ", quantityGrams: 125, kcal: 80 });
    expect(response.status).toBe(201);
    const { entry } = await response.json();
    expect(entry).toMatchObject({ userId: A, source: "manual", kcal: 80 });
    const result = await db.execute(sql`SELECT name, source, created_by, kcal_per_100g FROM foods WHERE id = ${entry.foodId}::uuid`);
    expect(result.rows[0]).toMatchObject({ name: "Yogurt", source: "manual", created_by: A, kcal_per_100g: 64 });
    expect((await feed()).entries).toEqual([expect.objectContaining({ name: "Yogurt", foodId: entry.foodId, recipeId: null, kcal: 80, quantityGrams: 125 })]);
  });

  it("creates a recipe with total kcal for fractional servings without multiplying twice in GET", async () => {
    const recipeId = "bbbbbbbb-1111-4111-8111-111111111111";
    await db.execute(sql`INSERT INTO recipes (id, name, servings, kcal_per_serving, snapshot) VALUES (${recipeId}::uuid, 'Pasta', 4, 320, '{}'::jsonb)`);
    const response = await post({ date: base.date, slot: "Dinner", entryType: "recipe", recipeId, servings: 1.5 });
    expect(response.status).toBe(201);
    const { entry } = await response.json();
    expect(entry).toMatchObject({ entryType: "recipe", recipeId, kcal: 480, source: "manual", quantityGrams: null });
    expect((await feed()).entries).toEqual([expect.objectContaining({ name: "Pasta", servings: 1.5, kcal: 480 })]);
  });

  it("requires a session before parsing JSON or accessing the database", async () => {
    const response = await buildDiaryCreateHandlers({ getDb: () => { throw new Error("DB must not be accessed"); }, getSession: async () => null }).POST(new Request("http://localhost/api/v1/diary", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: "not-json" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Autenticazione richiesta." });
  });

  it.each([
    { ...base, slot: "Brunch" },
    { ...base, entryType: undefined },
    { ...base, entryType: "other" },
    { ...base, date: "2026-02-30" },
    { ...base, quantityGrams: 0 },
    { ...base, quantityGrams: -1 },
    { ...base, quantityGrams: "150" },
    { ...base, foodId: "bad-id" },
    { ...base, foodId: undefined, name: "", kcal: 50 },
    { ...base, foodId: undefined, name: "Pera", kcal: undefined },
    { ...base, foodId: undefined, name: "Pera", kcal: -1 },
    { ...base, foodId: undefined, name: "Pera", quantityGrams: undefined, kcal: 50 },
    { date: base.date, slot: base.slot, entryType: "recipe", recipeId: FOOD },
    null,
  ])("rejects invalid input with a safe 400 and no writes: %j", async (input) => {
    const response = await post(input);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.any(String) });
    expect((await feed()).entries).toEqual([]);
    const result = await db.execute(sql`SELECT count(*)::int AS count FROM foods`);
    expect(result.rows[0].count).toBe(1);
  });

  it.each(["food", "recipe"])("rejects missing local %s references with 400", async (entryType) => {
    const id = "cccccccc-1111-4111-8111-111111111111";
    const response = await post(entryType === "food" ? { ...base, foodId: id } : { date: base.date, slot: base.slot, entryType, recipeId: id, servings: 1 });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: entryType === "food" ? "Alimento non trovato." : "Ricetta non trovata." });
  });

  it("preserves inline total kcal without per-100g rounding drift", async () => {
    const response = await post({ date: base.date, slot: "Snack", entryType: "food", name: "Acqua aromatizzata", quantityGrams: 1000, kcal: 1, userId: B, source: "norish_sync" });
    expect(response.status).toBe(201);
    const { entry } = await response.json();
    expect(entry).toMatchObject({ kcal: 1, userId: A, source: "manual" });
    expect((await feed()).entries[0].kcal).toBe(1);
  });

  it("rolls back inline food creation if diary insertion fails", async () => {
    await db.execute(sql`ALTER TABLE diary_entries ADD CONSTRAINT test_reject CHECK (kcal <> 51)`);
    try {
      const response = await post({ date: base.date, slot: "Snack", entryType: "food", name: "Rollback", quantityGrams: 100, kcal: 51 });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Non è stato possibile salvare la voce. Riprova." });
      const result = await db.execute(sql`SELECT count(*)::int AS count FROM foods`);
      expect(result.rows[0].count).toBe(1);
    } finally {
      await db.execute(sql`ALTER TABLE diary_entries DROP CONSTRAINT test_reject`);
    }
  });

  it.each([
    { ...base, quantityGrams: 999999.99 },
    { date: base.date, slot: base.slot, entryType: "food", name: "Overflow", quantityGrams: 0.01, kcal: 2147483647 },
    { date: base.date, slot: base.slot, entryType: "recipe", recipeId: FOOD, servings: 999999.99 },
  ])("rejects derived kcal overflow with 400 and no partial writes: %j", async (input) => {
    await db.execute(sql`UPDATE foods SET kcal_per_100g = 2147483647 WHERE id = ${FOOD}::uuid`);
    await db.execute(sql`INSERT INTO recipes (id, name, servings, kcal_per_serving, snapshot) VALUES (${FOOD}::uuid, 'Overflow', 1, 2147483647, '{}'::jsonb)`);
    const response = await post(input);
    expect(response.status).toBe(400);
    expect((await feed()).entries).toEqual([]);
    expect((await db.execute(sql`SELECT count(*)::int AS count FROM foods`)).rows[0].count).toBe(1);
  });

  it("retains null recipe kcal rather than treating unknown nutrition as zero", async () => {
    await db.execute(sql`INSERT INTO recipes (id, name, servings, snapshot) VALUES (${FOOD}::uuid, 'Sconosciuta', 2, '{}'::jsonb)`);
    const response = await post({ date: base.date, slot: "Breakfast", entryType: "recipe", recipeId: FOOD, servings: 2 });
    expect(response.status).toBe(201);
    expect((await response.json()).entry.kcal).toBeNull();
    expect((await feed()).entries[0].kcal).toBeNull();
  });

  it("creates food by id with session ownership and total kcal visible only in its feed", async () => {
    const response = await post(base);
    expect(response.status).toBe(201);
    const { entry } = await response.json();
    expect(entry).toMatchObject({ userId: A, source: "manual", kcal: 300, foodId: FOOD });
    expect((await feed()).entries).toEqual([expect.objectContaining({ id: entry.id, name: "Riso", kcal: 300, quantityGrams: 150, source: "manual" })]);
    expect((await feed(B)).entries).toEqual([]);
  });
});
