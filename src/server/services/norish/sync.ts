import { eq } from "drizzle-orm";
import { and } from "drizzle-orm";
import { desc } from "drizzle-orm";
import { sql, type SQL } from "drizzle-orm";
import type { PgTable, PgColumn } from "drizzle-orm/pg-core";
import type { Db } from "@/server/db";
import { diaryEntries, norishSyncRuns, profiles, recipes } from "@/server/db/schema";
import type { RecipeDetail } from "./client";
import type { DiarySlot } from "@/lib/types/diary";

/**
 * Sync engine § 5.4 con idempotenza per coppia utente/item (ADR-0008):
 * - upsert su diary_entries con conflict target la coppia (user_id, norish_item_id)
 *   sull'indice univoco parziale WHERE norish_item_id IS NOT NULL;
 * - date/slot aggiornati (fuori dalla chiave: cambiano upstream);
 * - kcal/servings aggiornati solo se cambiati;
 * - le voci marcate norish_sync non vengono più toccate se l'utente le ha
 *   modificate a mano (owner-override, § 5.4);
 * - nessuna cancellazione: item assenti dal payload → norish_deleted=true (§ 5.4).
 */

export interface UpsertTarget {
  user_id: string;
  norish_item_id: string;
}

/**
 * Contratto minimo per le funzioni sync core: esecuzione SQL raw su QUALSIASI
 * client drizzle (postgres.js in app, PGlite nei test) — la tipizzazione full
 * Db lega le funzioni al solo driver postgres.js e incompatibilizza PGlite.
 */
export interface SqlExecutor {
  execute(query: SQL): Promise<unknown>;
}

export interface SyncResult {
  upserted: number;
  skippedNoCalories: number;
}

/**
 * Insert … ON CONFLICT (user_id, norish_item_id) WHERE norish_item_id IS NOT NULL
 * (ADR-0008) con semantica kcal DECISIONE UTENTE 30/9:
 * - kcal = EXCLUDED.kcal PER PORZIONE, già arrotondate dal runner; le servings
 *   locali sono applicate solo al totale in sumKcal (mai due volte);
 * - servings NON compaiono nella SET-list: il sync non tocca MAI le porzioni
 *   locali (seed 1 solo all'import, l'utente può averle frazionarie es. 0.5);
 * - norish_deleted torna false appena l'item è nel payload (restore);
 * - il guard IS DISTINCT FROM salta interamente l'update se nessun dato cambia
 *   (idempotenza: niente bump di updated_at, niente spuri nel conteggio).
 */
export async function upsertDiaryEntry(
  db: SqlExecutor,
  params: {
    user_id: string;
    norish_item_id: string;
    date: string;
    slot: DiarySlot;
    recipe_id?: string | null;
    servings: number | null;
    kcal: number | null;
  },
): Promise<void> {
  const { user_id, norish_item_id, date, slot, recipe_id, servings, kcal } = params;
  await db.execute(sql`
    INSERT INTO diary_entries
      (id, user_id, date, slot, entry_type, recipe_id, servings, kcal, source, norish_item_id, norish_deleted)
    VALUES
      (gen_random_uuid(), ${user_id}::uuid, ${date}::date, ${slot}::slot, 'recipe',
       ${recipe_id}::uuid, ${servings}::numeric, ${kcal}::int, 'norish_sync', ${norish_item_id}::uuid, false)
    ON CONFLICT (user_id, norish_item_id) WHERE norish_item_id IS NOT NULL
    DO UPDATE SET
      date = EXCLUDED.date,
      slot = EXCLUDED.slot,
      kcal = EXCLUDED.kcal,
      recipe_id = EXCLUDED.recipe_id,
      norish_deleted = false,
      updated_at = now()
    WHERE diary_entries.source = 'norish_sync'
      AND (diary_entries.kcal, diary_entries.recipe_id, diary_entries.date, diary_entries.slot,
           diary_entries.norish_deleted) IS DISTINCT FROM
          (EXCLUDED.kcal, EXCLUDED.recipe_id, EXCLUDED.date, EXCLUDED.slot, false)
  `);
}

/** Marca come rimosse le voci sync dell'utente non più presenti nel payload (§ 5.4, no-autodelete). */
export async function markDeletedNorishEntries(
  db: SqlExecutor,
  userId: string,
  norishItemIds: string[],
  options: { windowStart?: string; windowEnd?: string } = {},
): Promise<number> {
  // Empty upstream windows are not evidence of removal.
  if (norishItemIds.length === 0) return 0;
  const placeholders = sql.join(
    norishItemIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const windowFilter =
    options.windowStart !== undefined
      ? sql` AND date >= ${options.windowStart}::date`
      : sql``;
  const windowEndFilter =
    options.windowEnd !== undefined
      ? sql` AND date <= ${options.windowEnd}::date`
      : sql``;
  const marked = await db.execute(sql`
    UPDATE diary_entries
    SET norish_deleted = true, updated_at = now()
    WHERE user_id = ${userId}::uuid
      AND source = 'norish_sync'
      AND norish_deleted = false
      AND norish_item_id NOT IN (${placeholders})${windowFilter}${windowEndFilter}
    RETURNING id
  `);
  return countRows(marked);
}

/** Conta le righe di un result: postgres.js ritorna un array, altri driver { rows }. */
function countRows(result: unknown): number {
  if (Array.isArray(result)) return result.length;
  const withRows = result as { rows?: unknown[] } | undefined;
  return withRows?.rows?.length ?? 0;
}

/**
 * Contratto minimo per mirrorRecipe: insert/update drizzle core (query builder)
 * su QUALSIASI client drizzle — full Db lega al solo driver postgres.js e
 * incompatibilizza PGlite (stesso principio di SqlExecutor sopra).
 */
export interface MirrorExecutor {
  insert(table: PgTable): {
    values(values: Record<string, unknown>): {
      onConflictDoUpdate(config: {
        target: PgColumn;
        set: Record<string, unknown>;
      }): {
        returning(fields: Record<string, PgColumn>): Promise<Array<Record<string, unknown>>>;
      };
    };
  };
}

/** Mirror della ricetta norish: snapshot JSONB completo, idempotente su norish_recipe_id (ADR-0005). */
export async function mirrorRecipe(
  db: MirrorExecutor,
  recipe: RecipeDetail,
  kcalPerServingFallback: number | null,
): Promise<string | null> {
  const values = {
    name: recipe.name,
    servings: recipe.servings,
    kcalPerServing: recipe.calories ?? kcalPerServingFallback,
    proteinPerServing: recipe.protein ?? null,
    fatPerServing: recipe.fat ?? null,
    carbsPerServing: recipe.carbs ?? null,
    snapshot: recipe,
    fetchedAt: new Date(),
    updatedAt: new Date(),
  };
  // Upsert su norish_recipe_id (indice univoco): atomico, niente race tra sync
  // concorrenti (select-then-insert poteva violare l'indice univoco).
  const upserted = await db
    .insert(recipes)
    .values({ ...values, norishRecipeId: recipe.id })
    .onConflictDoUpdate({
      target: recipes.norishRecipeId,
      set: values,
    })
    .returning({ id: recipes.id });
  const first = upserted[0] as { id?: unknown } | undefined;
  return typeof first?.id === "string" ? first.id : null;
}

/** Avvia un run sync per audit/circuit-breaker (§ 5.5): restituisce l'id del run. */
export async function startSyncRun(db: Db, userId: string): Promise<string> {
  const inserted = await db
    .insert(norishSyncRuns)
    .values({ userId, status: "partial" })
    .returning({ id: norishSyncRuns.id });
  return inserted[0].id;
}

/** Chiude il run di sync con esito e contatore. */
export async function finishSyncRun(
  db: Db,
  runId: string,
  status: "ok" | "error" | "partial",
  itemsUpserted: number,
  errorMessage: string | null,
  reason: "auth" | null = null,
): Promise<void> {
  await db
    .update(norishSyncRuns)
    .set({ status, itemsUpserted, errorMessage, reason, finishedAt: new Date() })
    .where(eq(norishSyncRuns.id, runId));
}

/** Calcolo del target calorico (§ 4.3 Mifflin-St Jeor). */
export const ACTIVITY_FACTORS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
} as const;
export type ActivityLevel = keyof typeof ACTIVITY_FACTORS;

/**
 * Target calorico: BMR (Mifflin-St Jeor) → TDEE (fattore attività) → aggiustamento
 * per obiettivo (lose −500, maintain 0, gain +300) → clamp di sicurezza (§ 4.3):
 * min 1200 kcal (f) / 1500 kcal (m).
 */
export function calculateCalorieTarget(input: {
  sex: "f" | "m";
  heightCm: number;
  weightKg: number;
  birthYear: number;
  activityLevel: ActivityLevel;
  goal: "lose" | "maintain" | "gain";
}): number {
  const currentYear = new Date().getFullYear();
  const age = Math.min(Math.max(currentYear - input.birthYear, 10), 100);
  // TL ADR-0009 (card target): female offset −166; round only the final result.
  const bmr = 10 * input.weightKg + 6.25 * input.heightCm - 5 * age + (input.sex === "m" ? 5 : -166);
  const tdee = bmr * ACTIVITY_FACTORS[input.activityLevel];
  const perGoal =
    input.goal === "lose" ? tdee - 500 : input.goal === "gain" ? tdee + 300 : tdee;
  const floor = input.sex === "f" ? 1200 : 1500;
  return Math.round(Math.max(perGoal, floor) / 5) * 5;
}

/** Ultimo profilo noto dell'utente (per il fallback kcal mancanti di § 4.4). */
export async function loadProfile(db: Db, userId: string) {
  const rows = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return rows[0] ?? null;
}

/** Elenco voci sincronizzate recenti per l'utente (utilità: dashboard/tests). */
export async function listSyncedEntries(db: Db, userId: string, limit = 50) {
  return db
    .select()
    .from(diaryEntries)
    .where(and(eq(diaryEntries.userId, userId), eq(diaryEntries.source, "norish_sync")))
    .orderBy(desc(diaryEntries.updatedAt))
    .limit(limit);
}

export function sumKcal(entries: { kcal: number | null; entryType?: string; servings?: string | number | null }[]): number {
  return entries.reduce((total, entry) => total + (entry.kcal ?? 0) *
    (entry.entryType === "recipe" ? Number(entry.servings ?? 1) : 1), 0);
}