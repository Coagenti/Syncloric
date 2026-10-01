import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { makeTestDb, resetTables, closeTestDb, type TestDb } from "./setup";
import { runNorishSync } from "@/server/services/norish/runner";
import type { PlannedRecipe } from "@/server/services/norish/client";

/**
 * Contratto runner sync (§ 5.4 + decisioni utente/TL 30/9, vincolanti):
 * - upsert con seed servings=1 SOLO all'importazione, mai sovrascritto;
 * - kcal = calories PER PORZIONE (round esplicito su colonna int);
 * - conteggio imported (INSERT) vs updated (UPDATE), no spuri quando nulla cambia;
 * - marca norish_deleted SOLO norish_sync stesso utente nella partizione calendario;
 * - payload vuoto senza TZ upstream o fetch parziale → nessuna marca;
 * - owner-override (source='manual') e altri utenti intoccabili;
 * - restore norish_deleted quando l'item torna nel payload.
 */

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const R = "aaaaaaaa-1111-4111-8111-111111111111";
const ITEM = "0f0e6f5e-1111-4aaa-8bbb-000000000001";
const ITEM2 = "0f0e6f5e-1111-4aaa-8bbb-000000000002";

function item(overrides: Partial<PlannedRecipe> = {}): PlannedRecipe {
  return {
    id: ITEM,
    date: "2026-09-30",
    slot: "Breakfast",
    sortOrder: 0,
    recipeId: R,
    version: 1,
    recipeName: "Test recipe",
    recipeImage: null,
    servings: 2,
    calories: 458,
    ...overrides,
  };
}

const recipeDetail = (id: string) => ({
  id,
  name: "Recipe " + id.slice(0, 4),
  servings: 8,
  calories: 458,
  fat: "27.40",
  carbs: "47.80",
  protein: null as string | null,
});

function makeClient(planned: PlannedRecipe[], opts: { recipes?: Record<string, unknown>; failToday?: boolean } = {}) {
  return {
    getPlannedRecipesWeek: async () => planned,
    getPlannedRecipesToday: async () => {
      if (opts.failToday) throw new Error("today fetch failed");
      return [];
    },
    getRecipe: async (id: string): Promise<ReturnType<typeof recipeDetail> | null> => {
      const r = (opts.recipes ?? { [R]: recipeDetail(R) })[id];
      return r === undefined ? null : (r as ReturnType<typeof recipeDetail>);
    },
  };
}

async function insertUser(db: TestDb, id: string): Promise<void> {
  await db.execute(sql`INSERT INTO users (id, username) VALUES (${id}::uuid, ${"user-" + id.slice(0, 8)})`);
}

describe("runNorishSync — runner engine (§ 5.4, decisioni 30/9)", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await makeTestDb();
  });
  afterAll(async () => {
    await resetTables(db);
    await closeTestDb();
  });
  beforeEach(async () => {
    await resetTables(db);
    await insertUser(db, U1);
    await insertUser(db, U2);
  });

  async function rows(q: Awaited<ReturnType<TestDb["execute"]>>): Promise<Array<Record<string, unknown>>> {
    return (q as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? (q as unknown as Array<Record<string, unknown>>);
  }

  it("gap antico: removal of Monday is marked even when only Thursday remains", async () => {
    await runNorishSync({ db, userId: U1, client: makeClient([
      item({ date: "2026-09-28" }), item({ id: ITEM2, date: "2026-10-01" }),
    ]) });
    const result = await runNorishSync({ db, userId: U1, client: makeClient([
      item({ id: ITEM2, date: "2026-10-01" }),
    ]) });
    expect(result.marked).toBe(1);
  });

  it("imports week payload, seeds servings=1, imports kcal per serving, mirrors recipe", async () => {
    const res = await runNorishSync({
      db,
      userId: U1,
      client: makeClient([item()], { recipes: { [R]: recipeDetail(R) } }),
    });
    expect(res).toEqual({ imported: 1, updated: 0, skipped: 0, marked: 0 });
    const q = await db.execute(sql`
      SELECT servings::text AS s, kcal, norish_deleted AS deleted, recipe_id FROM diary_entries
      WHERE user_id = ${U1}::uuid AND norish_item_id = ${ITEM}::uuid
    `);
    const row = (await rows(q))[0];
    expect(Number(row.s)).toBe(1); // local seed ALWAYS 1 at first import
    expect(row.kcal).toBe(458); // kcal PER PORZIONE così com'è
    expect(row.deleted).toBe(false);
    const rec = await db.execute(sql`SELECT kcal_per_serving, snapshot->>'name' AS name FROM recipes WHERE norish_recipe_id = ${R}::uuid`);
    const recRow = (await rows(rec))[0];
    expect(recRow).toBeDefined(); // mirror ADR-0005
    expect(recRow["name"]).toBe("Recipe " + R.slice(0, 4));
  });

  it("idempotent: same payload again → no spurious updated, no duplicate rows", async () => {
    const client = makeClient([item(), item({ id: ITEM2, date: "2026-10-01", calories: null })], {
      recipes: { [R]: recipeDetail(R) },
    });
    await runNorishSync({ db, userId: U1, client });
    const second = await runNorishSync({ db, userId: U1, client });
    expect(second).toEqual({ imported: 0, updated: 0, skipped: 0, marked: 0 });
    const q = await db.execute(sql`SELECT COUNT(*)::int AS n FROM diary_entries WHERE user_id = ${U1}::uuid`);
    expect(Number((await rows(q))[0].n)).toBe(2);
    const kcalQ = await db.execute(sql`SELECT kcal FROM diary_entries WHERE user_id = ${U1}::uuid AND norish_item_id = ${ITEM2}::uuid`);
    expect((await rows(kcalQ))[0].kcal).toBeNull(); // calories null → kcal NULL (no invented number)
  });

  it("counts updated only when something actually changed (date/slot moved)", async () => {
    const base = makeClient([item()], { recipes: { [R]: recipeDetail(R) } });
    await runNorishSync({ db, userId: U1, client: base });
    const changed = await runNorishSync({
      db,
      userId: U1,
      client: makeClient([item({ date: "2026-10-05", slot: "Dinner" })]),
    });
    expect(changed).toEqual({ imported: 0, updated: 1, skipped: 0, marked: 0 });
  });

  it("updates kcal-only changes and remains idempotent with fractional local servings", async () => {
    await runNorishSync({ db, userId: U1, client: makeClient([item()]) });
    await db.execute(sql`UPDATE diary_entries SET servings = 0.5 WHERE user_id = ${U1}::uuid AND norish_item_id = ${ITEM}::uuid`);
    const changed = makeClient([item({ calories: 500 })]);
    expect((await runNorishSync({ db, userId: U1, client: changed })).updated).toBe(1);
    const before = await db.execute(sql`SELECT kcal, servings::text AS s, updated_at FROM diary_entries WHERE user_id = ${U1}::uuid AND norish_item_id = ${ITEM}::uuid`);
    expect((await rows(before))[0].kcal).toBe(500); // kcal per porzione, non × servings
    const again = await runNorishSync({ db, userId: U1, client: changed });
    expect(again.updated).toBe(0);
    const after = await db.execute(sql`SELECT kcal, servings::text AS s, updated_at FROM diary_entries WHERE user_id = ${U1}::uuid AND norish_item_id = ${ITEM}::uuid`);
    expect((await rows(after))[0]).toEqual((await rows(before))[0]);
  });

  it("marks only when payload CHANGED from prior state (norish_deleted restore counts as updated)", async () => {
    await runNorishSync({ db, userId: U1, client: makeClient([item()], { recipes: { [R]: recipeDetail(R) } }) });
    // item disappears from a NON-EMPTY later payload → marked
    const other = "0f0e6f5e-1111-4aaa-8bbb-000000000009";
    const otherRecipe = "aaaaaaaa-1111-4111-8111-111111111119";
    const markedRun = await runNorishSync({
      db,
      userId: U1,
      client: makeClient([item({ id: other, recipeId: otherRecipe, date: "2026-09-29" })], {
        recipes: { [otherRecipe]: recipeDetail(otherRecipe) },
      }),
    });
    expect(markedRun.marked).toBe(1);
    const delQ = await db.execute(sql`SELECT norish_deleted AS deleted FROM diary_entries WHERE user_id = ${U1}::uuid AND norish_item_id = ${ITEM}::uuid`);
    expect((await rows(delQ))[0].deleted).toBe(true);
    // item reappears in payload → restored and counted as updated
    const restored = await runNorishSync({ db, userId: U1, client: makeClient([item()]) });
    expect(restored.updated).toBe(1);
    const delQ2 = await db.execute(sql`SELECT norish_deleted AS deleted FROM diary_entries WHERE user_id = ${U1}::uuid AND norish_item_id = ${ITEM}::uuid`);
    expect((await rows(delQ2))[0].deleted).toBe(false);
  });

  it("today payload anchors the week rather than an older observed date", async () => {
    await runNorishSync({ db, userId: U1, client: makeClient([item({ date: "2026-09-28" })]) });
    const result = await runNorishSync({ db, userId: U1, client: {
      ...makeClient([item({ id: ITEM2, date: "2026-09-20" })]),
      getPlannedRecipesToday: async () => [item({ id: "0f0e6f5e-1111-4aaa-8bbb-000000000003", date: "2026-10-01" })],
    } });
    expect(result.marked).toBe(1);
  });

  it("empty UTC payload marks the entire upstream week, not dates outside it", async () => {
    await runNorishSync({ db, userId: U1, client: makeClient([
      item({ date: "2026-09-28" }), item({ id: ITEM2, date: "2026-10-04" }),
    ]) });
    const result = await runNorishSync({ db, userId: U1, client: makeClient([]), upstreamTimeZone: "UTC", now: () => new Date("2026-10-01T23:30:00Z") });
    expect(result.marked).toBe(2);
  });

  it("empty payload: no marking, zero counts", async () => {
    const res = await runNorishSync({
      db,
      userId: U1,
      client: { getPlannedRecipesWeek: async () => [], getPlannedRecipesToday: async () => [], getRecipe: async () => null },
    });
    expect(res).toEqual({ imported: 0, updated: 0, skipped: 0, marked: 0 });
  });

  it("failed/partial fetch → no marking at all", async () => {
    await runNorishSync({ db, userId: U1, client: makeClient([item()], { recipes: { [R]: recipeDetail(R) } }) });
    const fail = await runNorishSync({
      db,
      userId: U1,
      client: {
        getPlannedRecipesWeek: async () => {
          throw new Error("upstream down");
        },
        getPlannedRecipesToday: async () => [],
        getRecipe: async () => null,
      },
    }).catch((e) => e);
    expect(fail).toBeInstanceOf(Error);
    const q = await db.execute(sql`SELECT COUNT(*)::int AS n FROM diary_entries WHERE user_id = ${U1}::uuid AND norish_deleted = true`);
    expect(Number((await rows(q))[0].n)).toBe(0);
  });

  it("preserve local fractional servings on later syncs, kcal recalculated after user edit", async () => {
    await runNorishSync({ db, userId: U1, client: makeClient([item()], { recipes: { [R]: recipeDetail(R) } }) });
    await db.execute(sql`
      UPDATE diary_entries SET servings = 0.5, kcal = 229
      WHERE user_id = ${U1}::uuid AND norish_item_id = ${ITEM}::uuid
    `);
    const res = await runNorishSync({ db, userId: U1, client: makeClient([item({ date: "2026-10-02" })]) });
    expect(res.updated).toBe(1); // date moved, servings/kcal untouched
    const q = await db.execute(sql`SELECT servings::text AS s, kcal FROM diary_entries WHERE user_id = ${U1}::uuid AND norish_item_id = ${ITEM}::uuid`);
    const row = (await rows(q))[0];
    expect(Number(row.s)).toBe(0.5);
    expect(row.kcal).toBe(458);
  });

  it("owner-override entries (source='manual') untouched", async () => {
    await db.execute(sql`
      INSERT INTO diary_entries (user_id, date, slot, entry_type, kcal, source, norish_item_id, servings)
      VALUES (${U1}::uuid, '2026-09-30'::date, 'Breakfast'::slot, 'recipe', 999, 'manual', ${ITEM}::uuid, 3)
    `);
    const res = await runNorishSync({
      db,
      userId: U1,
      client: makeClient([item({ calories: 111 })], { recipes: { [R]: recipeDetail(R) } }),
    });
    expect(res).toEqual({ imported: 0, updated: 0, skipped: 0, marked: 0 });
    const q = await db.execute(sql`SELECT kcal, servings::text AS s FROM diary_entries WHERE user_id = ${U1}::uuid AND norish_item_id = ${ITEM}::uuid`);
    const row = (await rows(q))[0];
    expect(row.kcal).toBe(999);
    expect(Number(row.s)).toBe(3);
  });

  it("cross-user entries unaffected by marking", async () => {
    const other = "0f0e6f5e-1111-4aaa-8bbb-00000000000a";
    await db.execute(sql`
      INSERT INTO diary_entries (user_id, date, slot, entry_type, kcal, source, norish_item_id)
      VALUES (${U2}::uuid, '2026-09-30'::date, 'Lunch'::slot, 'recipe', 100, 'norish_sync', ${other}::uuid)
    `);
    await runNorishSync({ db, userId: U1, client: makeClient([item()], { recipes: { [R]: recipeDetail(R) } }) });
    const q = await db.execute(sql`SELECT norish_deleted AS deleted FROM diary_entries WHERE user_id = ${U2}::uuid AND norish_item_id = ${other}::uuid`);
    expect((await rows(q))[0].deleted).toBe(false);
    // the run for U2 only sees U2's own entries
    const res2 = await runNorishSync({
      db,
      userId: U2,
      client: { getPlannedRecipesWeek: async () => [], getPlannedRecipesToday: async () => [], getRecipe: async () => null },
    });
    expect(res2.marked).toBe(0); // empty payload: no marking, even own entries
  });

  it("rounds fractional upstream calories per Math.round (DB int preserved)", async () => {
    const res = await runNorishSync({
      db,
      userId: U1,
      client: makeClient([item({ calories: 458.6 })], { recipes: { [R]: recipeDetail(R) } }),
    });
    expect(res.imported).toBe(1);
    const q = await db.execute(sql`SELECT kcal FROM diary_entries WHERE user_id = ${U1}::uuid AND norish_item_id = ${ITEM}::uuid`);
    expect(Number((await rows(q))[0].kcal)).toBe(459);
  });

  it("skips unreachable recipes (404) without aborting the batch", async () => {
    const res = await runNorishSync({
      db,
      userId: U1,
      client: makeClient([item({ recipeId: "aaaaaaaa-1111-4111-8111-1111111111ff" })], { recipes: {} }),
    });
    expect(res).toEqual({ imported: 0, updated: 0, skipped: 1, marked: 0 });
  });

  it("backfill (period=month): month endpoint only, week endpoint never called", async () => {
    let weekCalls = 0;
    let monthCalls = 0;
    const res = await runNorishSync({
      db,
      userId: U1,
      period: "month",
      client: {
        getPlannedRecipesWeek: async () => {
          weekCalls += 1;
          return [];
        },
        getPlannedRecipesMonth: async () => {
          monthCalls += 1;
          return [item({ id: ITEM2, date: "2026-09-10" })];
        },
        getPlannedRecipesToday: async () => {
          throw new Error("today must not be called on backfill");
        },
        getRecipe: async (id: string) => recipeDetail(id) ?? null,
      },
    });
    expect(weekCalls).toBe(0);
    expect(monthCalls).toBe(1);
    expect(res.imported).toBe(1);
    expect(res.marked).toBe(0); // no item disappeared within month window
  });

  it("partial today-failure: week data still imported, run signals partial fetch (no marking)", async () => {
    const res = await runNorishSync({
      db,
      userId: U1,
      client: { ...makeClient([item()], { recipes: { [R]: recipeDetail(R) } }), getPlannedRecipesToday: async () => { throw new Error("timeout"); } },
    });
    expect(res.imported).toBe(1);
    expect(res.partial).toBe(true);
  });

  it("advisory lock token derives per user: concurrent same-user run serializes (token stable)", async () => {
    // smoke: token is a positive small int derived deterministically —
    // run twice; if the advisory lock conflicted with itself across txs the
    // second run would block → the suite would hang (timeout fails it).
    const first = await runNorishSync({ db, userId: U1, client: makeClient([item()], { recipes: { [R]: recipeDetail(R) } }) });
    const second = await runNorishSync({ db, userId: U1, client: makeClient([item()], { recipes: { [R]: recipeDetail(R) } }) });
    expect(first.imported).toBe(1);
    expect(second.updated + second.imported).toBe(0);
  });
});