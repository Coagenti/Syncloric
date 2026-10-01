import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { makeTestDb, resetTables, type TestDb } from "./setup";
import { upsertDiaryEntry, markDeletedNorishEntries } from "@/server/services/norish/sync";

/**
 * Contratto dati della migrazione iniziale (§ 4.5 + ADR-0008), verificato sulle
 * STESSSE migrazioni drizzle dell'app (PGlite = Postgres in-process):
 * 1. nessuna UNIQUE globale su diary_entries.norish_item_id;
 * 2. UNIQUE parziale (user_id, norish_item_id) WHERE norish_item_id IS NOT NULL;
 * 3. l'indice (user_id, date, slot, norish_item_id) è un semplice indice di query;
 * 4. upsert sync conflict-target = coppia (user_id, norish_item_id).
 */

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const ITEM = "0f0e6f5e-1111-4aaa-8bbb-000000000001"; // stesso item upstream

async function insertUser(db: TestDb, id: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO users (id, username) VALUES (${id}::uuid, ${"user-" + id.slice(0, 8)})
  `);
}

describe("migrazione iniziale — contratto dati (ADR-0008)", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await makeTestDb();
    await resetTables(db);
  });

  afterEach(async () => {
    await resetTables(db);
  });

  it("non esiste alcun vincolo UNIQUE globale su norish_item_id", async () => {
    // Esclusa la PK (_pkey su id, unica per costruzione): ogni altro indice
    // UNIQUE su diary_entries deve coinvolgere user_id (ADR-0008).
    const res = await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM pg_indexes
      WHERE tablename = 'diary_entries'
        AND indexdef LIKE '%UNIQUE%'
        AND indexname NOT LIKE '%_pkey'
        AND indexdef NOT LIKE '%user_id%'
    `);
    const row = Array.isArray(res) ? res[0] : (res as { rows: Array<Record<string, unknown>> }).rows[0];
    expect(Number(row?.n)).toBe(0);
  });

  it("esiste l'indice univoco PARZIALE (user_id, norish_item_id) con predicate", async () => {
    const res = await db.execute(sql`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'diary_entries'
        AND indexname = 'diary_entries_user_norish_item_unique'
    `);
    const row = Array.isArray(res) ? res[0] : (res as { rows: Array<Record<string, unknown>> }).rows[0];
    const def = String(row?.indexdef ?? "");
    expect(def).toContain("UNIQUE INDEX");
    expect(def).toContain("user_id");
    expect(def).toContain("norish_item_id");
    expect(def.toLowerCase()).toContain("where");
  });

  it("consente lo STESSO norish_item_id in diari di utenti diversi", async () => {
    await insertUser(db, U1);
    await insertUser(db, U2);
    await upsertDiaryEntry(db, {
      user_id: U1, norish_item_id: ITEM, date: "2026-09-29", slot: "Breakfast",
      recipe_id: null, servings: 1, kcal: 458,
    });
    // non deve lanciare: coppia (user_id, item) diversa
    await upsertDiaryEntry(db, {
      user_id: U2, norish_item_id: ITEM, date: "2026-09-29", slot: "Breakfast",
      recipe_id: null, servings: 2, kcal: 916,
    });
    const res = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM diary_entries WHERE norish_item_id = ${ITEM}::uuid
    `);
    const row = Array.isArray(res) ? res[0] : (res as { rows: Array<Record<string, unknown>> }).rows[0];
    expect(Number(row?.n)).toBe(2);
  });

  it("idempotente per coppia: l'upsert aggiorna e NON duplica (§ 5.4)", async () => {
    await insertUser(db, U1);
    const params = {
      user_id: U1, norish_item_id: ITEM, date: "2026-09-29", slot: "Lunch" as const,
      recipe_id: null, servings: 1, kcal: 458,
    };
    await upsertDiaryEntry(db, params);
    await upsertDiaryEntry(db, { ...params, servings: 2, kcal: 916, date: "2026-09-30" });
    const res = await db.execute(sql`
      SELECT date::text AS d, servings::text AS s, kcal FROM diary_entries
      WHERE user_id = ${U1}::uuid AND norish_item_id = ${ITEM}::uuid
    `);
    const row = Array.isArray(res) ? res[0] : (res as { rows: Array<Record<string, unknown>> }).rows[0];
    expect(String(row?.d)).toBe("2026-09-30"); // date/slot aggiornati (fuori dalla chiave)
    expect(Number(row?.s)).toBe(1); // local servings survive upstream updates
    expect(Number(row?.kcal)).toBe(916);
  });

  it("le voci manuali con norish_item_id NULL restano ammesse in numero arbitrario", async () => {
    await insertUser(db, U1);
    for (const slot of ["Breakfast", "Lunch", "Dinner"] as const) {
      await db.execute(sql`
        INSERT INTO diary_entries (user_id, date, slot, entry_type, kcal, source)
        VALUES (${U1}::uuid, '2026-09-29'::date, ${slot}::slot, 'food', 100, 'manual')
      `);
    }
    const res = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM diary_entries
      WHERE user_id = ${U1}::uuid AND norish_item_id IS NULL
    `);
    const row = Array.isArray(res) ? res[0] : (res as { rows: Array<Record<string, unknown>> }).rows[0];
    expect(Number(row?.n)).toBe(3);
  });

  it("empty payload never marks missing entries", async () => {
    await insertUser(db, U1);
    await upsertDiaryEntry(db, {
      user_id: U1, norish_item_id: ITEM, date: "2026-09-29", slot: "Snack",
      recipe_id: null, servings: 1, kcal: 100,
    });
    const marked = await markDeletedNorishEntries(db, U1, []);
    expect(marked).toBe(0);
  });

  it("markDeleted con payload NON tocca le voci ancora presenti", async () => {
    await insertUser(db, U1);
    await upsertDiaryEntry(db, {
      user_id: U1, norish_item_id: ITEM, date: "2026-09-29", slot: "Snack",
      recipe_id: null, servings: 1, kcal: 100,
    });
    const marked = await markDeletedNorishEntries(db, U1, [ITEM]);
    expect(marked).toBe(0);
  });
});