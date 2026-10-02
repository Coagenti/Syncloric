import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Db } from "@/server/db";
import { buildDiaryCreateHandlers } from "@/server/services/diary/create";
import { buildDiaryFeedHandlers } from "@/server/services/diary/feed";
import { buildDiaryMutationHandlers } from "@/server/services/diary/mutate";
import { makeTestDb, resetTables, closeTestDb, type TestDb } from "./setup";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const FOOD = "aaaaaaaa-1111-4111-8111-111111111111";
const RECIPE = "bbbbbbbb-1111-4111-8111-111111111111";
const MISSING = "cccccccc-1111-4111-8111-111111111111";
const base = { date: "2026-09-29", slot: "Lunch", entryType: "food", foodId: FOOD, quantityGrams: 150 };

describe("manual diary PATCH/DELETE", () => {
  let db: TestDb;
  beforeAll(async () => { db = await makeTestDb(); });
  afterAll(closeTestDb);
  beforeEach(async () => {
    await resetTables(db);
    await db.execute(sql`INSERT INTO users (id, username) VALUES (${A}::uuid, 'a'), (${B}::uuid, 'b')`);
    await db.execute(sql`INSERT INTO foods (id, name, kcal_per_100g) VALUES (${FOOD}::uuid, 'Riso', 200)`);
    await db.execute(sql`INSERT INTO recipes (id, name, servings, kcal_per_serving, snapshot) VALUES (${RECIPE}::uuid, 'Pasta', 4, 320, '{}'::jsonb)`);
  });
  const deps = (user: string | null = A) => ({ getDb: () => db as unknown as Db, getSession: async () => user ? { user: { id: user } } : null });
  const post = async (body: unknown = base) => {
    const response = await buildDiaryCreateHandlers(deps()).POST(new Request("http://localhost/api/v1/diary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    expect(response.status).toBe(201);
    return (await response.json()).entry;
  };
  const patch = (id: string, body: unknown, user: string | null = A) => buildDiaryMutationHandlers(deps(user)).PATCH(new Request(`http://localhost/api/v1/diary/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
  const del = (id: string, user: string | null = A) => buildDiaryMutationHandlers(deps(user)).DELETE(new Request(`http://localhost/api/v1/diary/${id}`, { method: "DELETE", headers: { Origin: "http://localhost" } }), { params: Promise.resolve({ id }) });
  const feed = async (user = A) => (await buildDiaryFeedHandlers(deps(user)).GET(new Request("http://localhost/api/v1/diary?month=2026-09"))).json();

  it.each(["norish_sync", "barcode", "ai_label"])("refuses PATCH for nonmanual source %s without changing the row", async (source) => {
    const entry = await post();
    await db.execute(sql`UPDATE diary_entries SET source = ${source}::diary_source WHERE id = ${entry.id}::uuid`);
    const response = await patch(entry.id, { kcal: 999 });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: source === "norish_sync" ? "Le voci importate sono gestite dalla sincronizzazione Norish e non possono essere modificate o eliminate." : "Puoi modificare o eliminare solo le voci manuali." });
    expect((await feed()).entries[0]).toMatchObject({ kcal: 300, source });
  });

  it.each([B, null])("guards ownership/session for PATCH: %s", async (user) => {
    const entry = await post();
    const response = await patch(entry.id, { kcal: 999 }, user);
    expect(response.status).toBe(user ? 404 : 401);
    expect((await feed()).entries[0].kcal).toBe(300);
  });

  it("returns 404 for a missing entry", async () => {
    expect((await patch(MISSING, { slot: "Dinner" })).status).toBe(404);
  });

  it.each([{}, null, { quantityGrams: 0 }, { quantityGrams: 0.001 }, { kcal: -1 }, { date: "2026-02-30" }, { slot: "Brunch" }, { userId: B }, { source: "manual" }, { foodId: FOOD }, { entryType: "recipe" }, { servings: 1 }])("rejects invalid/immutable/type-incompatible PATCH without mutation: %j", async (input) => {
    const entry = await post();
    const response = await patch(entry.id, input);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.any(String) });
    expect((await feed()).entries[0]).toMatchObject({ kcal: 300, quantityGrams: 150 });
  });

  it("updates a POST-created manual food quantity, total kcal, slot and date in GET", async () => {
    const entry = await post();
    const response = await patch(entry.id, { quantityGrams: 125, kcal: 99, slot: "Snack", date: "2026-09-30" });
    expect(response.status).toBe(200);
    expect((await response.json()).entry).toMatchObject({ id: entry.id, source: "manual", userId: A, quantityGrams: "125.00", kcal: 99, slot: "Snack", date: "2026-09-30" });
    expect((await feed()).entries).toEqual([expect.objectContaining({ id: entry.id, quantityGrams: 125, kcal: 99, slot: "Snack", date: "2026-09-30" })]);
    expect((await feed(B)).entries).toEqual([]);
  });

  it.each([{ servings: 2.5, date: "2026-09-30", slot: "Dinner" }, { servings: 2.5, date: "2026-09-30" }])("recalculates recipe kcal atomically with date/slot: %j", async (input) => {
    const entry = await post({ date: "2026-09-29", slot: "Lunch", entryType: "recipe", recipeId: RECIPE, servings: 1 });
    const response = await patch(entry.id, input);
    expect(response.status).toBe(200);
    expect((await response.json()).entry).toMatchObject({ kcal: 800, servings: "2.50", date: input.date });
    expect((await feed()).entries[0]).toMatchObject({ kcal: 800, servings: 2.5 });
  });

  it("deletes a POST-created manual entry from its feed only", async () => {
    const entry = await post();
    const response = await del(entry.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const result = await db.execute(sql`SELECT count(*)::int AS count FROM diary_entries`);
    expect(result.rows[0].count).toBe(0);
    expect((await feed()).entries).toEqual([]);
  });

  it.each([["norish_sync", 403, "Le voci importate sono gestite dalla sincronizzazione Norish e non possono essere modificate o eliminate."], ["barcode", 403, "Puoi modificare o eliminare solo le voci manuali."], ["ai_label", 403, "Puoi modificare o eliminare solo le voci manuali."]])("refuses DELETE for nonmanual source %s", async (source, status, error) => {
    const entry = await post();
    await db.execute(sql`UPDATE diary_entries SET source = ${source}::diary_source WHERE id = ${entry.id}::uuid`);
    const response = await del(entry.id);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
    expect((await feed()).entries[0].id).toBe(entry.id);
  });

  it.each([B, null])("guards ownership/session for DELETE: %s", async (user) => {
    const entry = await post();
    const response = await del(entry.id, user);
    expect(response.status).toBe(user ? 404 : 401);
    expect((await feed()).entries[0].id).toBe(entry.id);
  });

  it("returns 404 for a missing entry on DELETE", async () => {
    expect((await del(MISSING)).status).toBe(404);
  });

  it.each(["../../etc/passwd", "", "not-a-uuid"])("treats malformed ids as not found on PATCH and DELETE: %s", async (raw) => {
    expect((await patch(raw, { kcal: 5 })).status).toBe(404);
    expect((await del(raw)).status).toBe(404);
    expect((await db.execute(sql`SELECT count(*)::int AS count FROM diary_entries`)).rows[0].count).toBe(0);
  });
});
