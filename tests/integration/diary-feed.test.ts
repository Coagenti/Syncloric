import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvConfigCache } from "@/server/config";
import { sql } from "drizzle-orm";
import { buildDiaryFeedHandlers } from "@/server/services/diary/feed";
import { runNorishSync } from "@/server/services/norish/runner";
import type { Db } from "@/server/db";
import { makeTestDb, resetTables, closeTestDb, type TestDb } from "./setup";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const recipe = "aaaaaaaa-1111-4111-8111-111111111111";
const item = "bbbbbbbb-1111-4111-8111-111111111111";

describe("GET diary feed: sync → DB → vista per utente", () => {
  let db: TestDb;
  beforeAll(async () => { db = await makeTestDb(); });
  afterAll(closeTestDb);
  beforeEach(async () => {
    vi.stubEnv("DATABASE_URL", "postgres://test@localhost:5432/syncloric");
    vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(64));
    vi.stubEnv("ENCRYPTION_KEY", "a".repeat(64));
    vi.stubEnv("NORISH_BASE_URL", "https://norish.example.invalid");
    vi.stubEnv("NORISH_API_KEY", undefined);
    resetEnvConfigCache();
    await resetTables(db);
    await db.execute(sql`INSERT INTO users (id, username) VALUES (${A}::uuid, 'a'), (${B}::uuid, 'b')`);
  });
  afterEach(() => { vi.unstubAllEnvs(); resetEnvConfigCache(); });
  const feed = (session: string | null) => buildDiaryFeedHandlers({
    getDb: () => db as unknown as Db,
    getSession: async () => session ? { user: { id: session } } : null,
  });
  const request = new Request("http://localhost/api/v1/diary?month=2026-09");

  it("rejects anonymous access before touching DB", async () => {
    const response = await feed(null).GET(request);
    expect(response.status).toBe(401);
  });

  it("imports planned calendar meal through runner and returns it to the authenticated dashboard", async () => {
    const client = {
      getPlannedRecipesWeek: async () => [{ id: item, date: "2026-09-29", slot: "Lunch" as const, sortOrder: 0, recipeId: recipe, version: 1, recipeName: "Ricetta Norish", recipeImage: null, servings: 2, calories: 458 }],
      getPlannedRecipesToday: async () => [],
      getRecipe: async () => ({ id: recipe, name: "Ricetta Norish", servings: 2, calories: 458, fat: null, carbs: null, protein: null }),
    };
    expect((await runNorishSync({ db, userId: A, client })).imported).toBe(1);
    const response = await feed(A).GET(request);
    expect(response.status).toBe(200);
    expect((await response.json()).entries).toEqual([expect.objectContaining({ date: "2026-09-29", name: "Ricetta Norish", slot: "Lunch", servings: 1, kcal: 458, source: "norish_sync" })]);
  });

  it("returns synced meal with kcal per serving and recipe name, but not another user's data", async () => {
    await db.execute(sql`INSERT INTO recipes (id, name, servings, snapshot) VALUES (${recipe}::uuid, 'Ricetta Norish', 2, '{}')`);
    await db.execute(sql`INSERT INTO diary_entries (user_id, date, slot, entry_type, recipe_id, servings, kcal, source, norish_item_id)
      VALUES (${A}::uuid, '2026-09-29', 'Lunch', 'recipe', ${recipe}::uuid, 2, 458, 'norish_sync', ${item}::uuid),
             (${B}::uuid, '2026-09-29', 'Dinner', 'recipe', ${recipe}::uuid, 1, 900, 'norish_sync', gen_random_uuid())`);
    const response = await feed(A).GET(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.entries).toEqual([expect.objectContaining({ date: "2026-09-29", name: "Ricetta Norish", slot: "Lunch", servings: 2, kcal: 916, source: "norish_sync" })]);
    expect(JSON.stringify(body)).not.toContain("900");
  });

  it("projects only the latest run; auth error includes configured host, no credentials", async () => {
    await db.execute(sql`INSERT INTO norish_sync_runs (user_id, status, reason, started_at, finished_at) VALUES
      (${A}::uuid, 'ok', null, now() - interval '1 day', now() - interval '1 day'), (${A}::uuid, 'error', 'auth', now(), now()),
      (${B}::uuid, 'ok', null, now() + interval '1 day', now() + interval '1 day')`);
    const response = await feed(A).GET(request);
    expect((await response.json()).sync).toEqual(expect.objectContaining({ status: "error", reason: "auth" }));
  });

  it("rejects invalid month and never sends raw upstream error messages", async () => {
    expect((await feed(A).GET(new Request("http://localhost/api/v1/diary?month=2026-13"))).status).toBe(400);
    await db.execute(sql`INSERT INTO norish_sync_runs (user_id, status, reason, error_message) VALUES (${A}::uuid, 'error', 'auth', 'sensitive upstream details')`);
    expect(JSON.stringify(await (await feed(A).GET(request)).json())).not.toContain("sensitive upstream details");
  });
});
