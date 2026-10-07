import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { Db } from "@/server/db";
import { buildSyncHandlers } from "@/server/services/norish/http";
import { buildDiaryMutationHandlers } from "@/server/services/diary/mutate";
import { buildDiaryFeedHandlers } from "@/server/services/diary/feed";
import { resetEnvConfigCache } from "@/server/config";
import { norishCredentialKey, saveCredential } from "@/server/services/settings/credentials";
import type { PlannedRecipe } from "@/server/services/norish/client";
import { makeTestDb, resetTables, closeTestDb, type TestDb } from "./setup";
import { PLANNED_RECIPE, RECIPE_DETAIL } from "../fixtures/norish";

/**
 * § 4.5 / ADR-0008 — PATCH (e DELETE) su una voce di tipo `norish_sync` rifiutati
 * a livello API, con upstream Norish mockato (nessuna chiamata reale, nessun segreto).
 *
 * Differenza rispetto a diary-mutate.test.ts: lì la voce nasce manuale (POST) e la
 * `source` viene invertita via SQL — qui la voce norish_sync nasce REALE dal path
 * upstream→mirror→upsert (POST /api/v1/sync con il runner vero), quindi il guard
 * viene provato sulla tipologia di riga che produce davvero la sincronizzazione:
 * source='norish_sync', entry_type='recipe', recipe_id mirato, norish_item_id dell'item
 * pianificato. Il guard deve rispondere 403 con il messaggio LOCKED prima di ogni
 * scrittura e la riga (incluso updated_at) deve restare invariata al di fuori del sync.
 */

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const LOCKED = "Le voci importate sono gestite dalla sincronizzazione Norish e non possono essere modificate o eliminate.";

/** Item pianificato upstream (fixture live 2026-09-29): calories PER PORZIONE § 5.2. */
const PLANNED_KCAL_PER_SERVING = 458;
const RECIPE_NAME = "Sachertorte";
/** Payload /planned-recipes/week mockato: valori della fixture live § 5.2, kcal tipizzate. */
const planned = { ...PLANNED_RECIPE, calories: PLANNED_KCAL_PER_SERVING } as unknown as PlannedRecipe;

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

describe("PATCH/DELETE su voce norish_sync (sync reale, upstream mockato)", () => {
  let db: TestDb;
  beforeAll(async () => { db = await makeTestDb(); });
  afterAll(async () => { await closeTestDb(); });
  beforeEach(async () => {
    await resetTables(db);
    vi.stubEnv("DATABASE_URL", "postgres://localhost/test");
    vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(64));
    vi.stubEnv("ENCRYPTION_KEY", "a".repeat(64));
    vi.stubEnv("NORISH_API_KEY", "test-only-sync-key");
    vi.stubEnv("NORISH_BASE_URL", "https://norish-mock.example");
    vi.stubEnv("NORISH_UPSTREAM_TZ", undefined);
    resetEnvConfigCache();
    await db.execute(sql`INSERT INTO users (id, username) VALUES (${USER}::uuid, 'a'), (${OTHER}::uuid, 'b')`);
    await saveCredential(db as never, norishCredentialKey(USER), "test-only-sync-key");
    // Upstream mockato: solo la settimana con l'item pianificato, /today vuoto,
    // dettaglio ricetta per il mirror. Nessun altro path upstream è previsto:
    // un fetch inatteso risponde 404 e il sync fallirebbe (fail loud).
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/api/v1/planned-recipes/week")) return jsonResponse([planned]);
      if (path.endsWith("/api/v1/planned-recipes/today")) return jsonResponse([]);
      if (path.startsWith("/api/v1/recipes/")) return jsonResponse(RECIPE_DETAIL);
      return jsonResponse({ message: "upstream non atteso nel test" }, 404);
    }));
  });

  const sessionOf = (user: string | null) => async () => (user ? { user: { id: user } } : null);
  const deps = (user: string | null = USER) => ({
    getDb: () => db as unknown as Db,
    getSession: sessionOf(user),
  });
  const request = (path: string, body?: unknown) => new Request(`https://syncloric.example${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://syncloric.example" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });

  /** Esegue il sync reale (runner + mirror + upsert) e restituisce la riga norish_sync creata. */
  const importRealSyncRow = async () => {
    // Il mock e l'attesa kcal devono restare agganciate: se cambia il payload, fallisce qui.
    expect(planned.calories).toBe(PLANNED_KCAL_PER_SERVING);
    const response = await buildSyncHandlers({ getDb: () => db as unknown as Db, getSession: sessionOf(USER) })
      .POST(request("/api/v1/sync"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", reason: null });
    const result = await db.execute(sql`
      SELECT id, source, entry_type, recipe_id, norish_item_id, norish_deleted, kcal,
             servings::text AS servings, date::text AS date_y, slot
      FROM diary_entries WHERE user_id = ${USER}::uuid
    `);
    const rows = (result as { rows: Record<string, unknown>[] }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "norish_sync", entry_type: "recipe" as const, norish_deleted: false,
      kcal: PLANNED_KCAL_PER_SERVING, servings: "1.00", date_y: planned.date, slot: planned.slot });
    expect(rows[0].norish_item_id).toBe(planned.id);
    expect(rows[0].recipe_id).not.toBeNull();
    return rows[0].id as string;
  };

  /** Snapshot grezzo della riga: valori serializzati in modo deterministico, updated_at incluso. */
  const loadRow = async (id: string) => {
    const result = await db.execute(sql`
      SELECT id, user_id, date::text AS date, slot, entry_type, food_id, recipe_id,
             quantity_grams::text AS quantity_grams, servings::text AS servings, kcal,
             protein::text AS protein, fat::text AS fat, carbs::text AS carbs, source,
             norish_item_id, norish_deleted, created_at, updated_at
      FROM diary_entries WHERE id = ${id}::uuid
    `);
    const rows = (result as { rows: Record<string, unknown>[] }).rows;
    expect(rows).toHaveLength(1);
    return Object.fromEntries(Object.entries(rows[0]).map(([key, value]) =>
      [key, value instanceof Date ? value.toISOString() : String(value)]));
  };

  const patch = (id: string, body: unknown, user: string | null = USER) =>
    buildDiaryMutationHandlers(deps(user)).PATCH(
      new Request(`https://syncloric.example/api/v1/diary/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Origin: "https://syncloric.example" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    );
  const del = (id: string, user: string | null = USER) =>
    buildDiaryMutationHandlers(deps(user)).DELETE(
      new Request(`https://syncloric.example/api/v1/diary/${id}`, { headers: { Origin: "https://syncloric.example" } }),
      { params: Promise.resolve({ id }) },
    );
  const feed = async (user: string | null = USER) =>
    (await buildDiaryFeedHandlers(deps(user)).GET(new Request("https://syncloric.example/api/v1/diary?month=2026-09"))).json();

  /** La riga deve restare identica a ogni iterazione, incluso updated_at (nessuna scrittura fuori dal sync). */
  const expectSameRowAs = async (id: string, before: Record<string, string>) => {
    expect(await loadRow(id)).toEqual(before);
  };

  it.each([
    [{ kcal: 123 }],
    [{ servings: 2.5 }],
    [{ slot: "Dinner" }],
    [{ date: "2026-09-30" }],
    [{ kcal: 1, date: "2026-09-30", slot: "Snack", servings: 3 }],
  ])("rifiuta PATCH con 403 LOCKED su ogni combinazione di campi senza mutare la riga: %j", async (body) => {
    const id = await importRealSyncRow();
    const before = await loadRow(id);
    const response = await patch(id, body);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: LOCKED });
    await expectSameRowAs(id, before);
  });

  it("rifiuta DELETE con 403 LOCKED e mantiene la riga norish_sync", async () => {
    const id = await importRealSyncRow();
    const before = await loadRow(id);
    const response = await del(id);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: LOCKED });
    await expectSameRowAs(id, before);
  });

  it("appiattisce l'accesso incrociato a 404 e lascia la voce intatta nella proiezione del feed", async () => {
    const id = await importRealSyncRow();
    const before = await loadRow(id);
    const crossResponse = await patch(id, { kcal: 999 }, OTHER);
    expect(crossResponse.status).toBe(404);
    await expectSameRowAs(id, before);
    const diary = await feed();
    expect(diary.entries).toHaveLength(1);
    expect(diary.entries[0]).toMatchObject({
      id, source: "norish_sync", norishDeleted: false, name: RECIPE_NAME,
      date: planned.date, slot: planned.slot,
      servings: 1, kcal: PLANNED_KCAL_PER_SERVING, // tot = kcal per porzione × servings (§ 5.2)
    });
    expect(diary.entries[0].kcal).toBe(PLANNED_KCAL_PER_SERVING);
    expect((await feed(OTHER)).entries).toEqual([]);
  });
});
