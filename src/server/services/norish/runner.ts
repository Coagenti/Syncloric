import { sql, type SQL } from "drizzle-orm";
import { upsertDiaryEntry, markDeletedNorishEntries, mirrorRecipe } from "./sync";
import { NorishApiError, type PlannedRecipe, type RecipeDetail } from "./client";
import { normalizeNutrition } from "@/lib/nutrition";

/**
 * Sync engine runner § 5.4 — orchestrates fetch→mirror→upsert→mark per user,
 * in ONE transaction with a per-user advisory xact lock (§ 5.4, scheduler
 * compatibile: stesso spazio di lock `pg_advisory_xact_lock(hashtext(userId))`
 * usato dal tick schedulato → scheduler e manuale si serializzano).
 *
 * Decisioni utente/TL 30/9 (vincolanti):
 * - local servings seed = 1 ALWAYS at import, NEVER overwritten on subsequent syncs;
 * - kcal importati = calories PER PORZIONE così com'è (Math.round esplicito:
 *   colonna int esistente, comportamento intero preservato e documentato);
 * - il totale Syncloric è competenza di sumKcal (kcal × servings locali);
 * - marca norish_deleted SOLO su source='norish_sync', stesso utente, data dentro
 *   la partizione calendario Norish v0.24.0-beta (lun–dom / 1–fine mese),
 *   ancorata a /today oppure alla prima data del payload, mai all'oggi locale;
 * - payload vuoto → nessuna marca salvo TZ upstream esplicita; fetch
 *   parziale/fallito → NESSUNA marca anche con TZ configurata.
 */

export interface SyncPort {
  getPlannedRecipesWeek(): Promise<PlannedRecipe[]>;
  getPlannedRecipesToday(): Promise<PlannedRecipe[]>;
  /** Solo per il backfill manuale (period=month, § 5.4). */
  getPlannedRecipesMonth?(): Promise<PlannedRecipe[]>;
  getRecipe(id: string): Promise<RecipeDetail | null>;
}

/**
 * Contratto DB del runner, driver-agnostico (stesso principio di SqlExecutor
 * nella sync core): postgres.js in produzione, PGlite nei test di integrazione.
 * Il runner esegue solo SQL raw dentro una transazione.
 */
export interface SyncExecutor {
  execute(query: SQL): Promise<unknown>;
  transaction<T>(callback: (tx: SyncExecutor) => Promise<T>): Promise<T>;
}

export interface NorishSyncResult {
  imported: number;
  updated: number;
  skipped: number;
  marked: number;
  /** Presente (true) SOLO su fetch parziale (today fallito, week OK): nessuna marca. */
  partial?: true;
}

export class NorishSyncError extends Error {
  constructor(
    message: string,
    readonly phase: "fetch" | "upsert",
    readonly partial: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "NorishSyncError";
  }
}

/** Norish v0.24.0-beta: inclusive Monday–Sunday / first–last day.
 * Only ISO calendar dates participate; never expand to Syncloric's local today.
 * serverTodayISO is the /today payload anchor (or explicit upstream-TZ fallback).
 */
export function deriveNorishWindow(
  period: "week" | "month", payloadDates: string[], serverTodayISO?: string,
): { start: string; end: string } | null {
  const dates = payloadDates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const anchor = (period === "week" ? serverTodayISO : undefined) ?? dates[0] ?? serverTodayISO;
  if (!anchor) return null;
  const [year, month, day] = anchor.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (period === "month") {
    return {
      start: new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10),
      end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
    };
  }
  const monday = date.getUTCDate() - ((date.getUTCDay() + 6) % 7);
  return {
    start: new Date(Date.UTC(year, month - 1, monday)).toISOString().slice(0, 10),
    end: new Date(Date.UTC(year, month - 1, monday + 6)).toISOString().slice(0, 10),
  };
}

function rows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result;
  return (result as { rows?: Array<Record<string, unknown>> })?.rows ?? [];
}

export async function runNorishSync(options: {
  db: SyncExecutor;
  userId: string;
  client: SyncPort;
  /** Backfill: finestra = endpoint month, solo endpoint mese (§ 5.4). */
  period?: "week" | "month";
  /** Validated env-only upstream timezone, injected by scheduler/CLI. */
  upstreamTimeZone?: string;
  /** Clock used only for the explicit empty-payload timezone fallback. */
  now?: () => Date;
}): Promise<NorishSyncResult> {
  const { db, userId, client, period = "week" } = options;
  return db.transaction(async (tx) => {
    // Lock advisory XACT per utente DENTRO la transazione (stessa connessione,
    // auto-release al commit): due run concorrenti dello stesso utente si
    // serializzano; utenti diversi procedono in parallelo (§ 5.4).
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId})) AS acquired`);

    let payload: PlannedRecipe[];
    let serverTodayISO: string | undefined;
    let partial = false;
    try {
      if (period === "month") {
        if (!client.getPlannedRecipesMonth) {
          throw new Error("backfill richiede getPlannedRecipesMonth");
        }
        payload = await client.getPlannedRecipesMonth(); // solo mese, nessun week/today
      } else {
        const week = await client.getPlannedRecipesWeek();
        try {
          const todayPayload = await client.getPlannedRecipesToday();
          serverTodayISO = todayPayload[0]?.date;
          payload = [...week, ...todayPayload];
        } catch (error) {
          // Auth non è un fetch parziale recuperabile: deve arrivare al run
          // come reason=auth anche se /week aveva già risposto 200.
          if (error instanceof NorishApiError && (error.status === 401 || error.status === 403)) throw error;
          // fetch parziale: i dati settimana restano validi, ma NON è un payload
          // completo → nessuna marca norish_deleted su questo run (§ 5.5).
          partial = true;
          payload = week;
        }
      }
    } catch (error) {
      throw new NorishSyncError(
        error instanceof Error ? error.message : "fetch failed",
        "fetch",
        partial,
        { cause: error },
      );
    }

    if (!partial && payload.length === 0 && options.upstreamTimeZone) {
      const parts = new Intl.DateTimeFormat("en", {
        timeZone: options.upstreamTimeZone, year: "numeric", month: "2-digit", day: "2-digit",
      }).formatToParts(options.now?.() ?? Date.now());
      const part = (type: string) => parts.find((p) => p.type === type)!.value;
      serverTodayISO = `${part("year")}-${part("month")}-${part("day")}`;
    }
    const window = deriveNorishWindow(period, payload.map((i) => i.date), serverTodayISO);
    const result: NorishSyncResult = { imported: 0, updated: 0, skipped: 0, marked: 0 };
    if (partial) {
      result.partial = true as const;
    }
    for (const planned of payload) {
      const recipe = await client.getRecipe(planned.recipeId); // null → 404, skip di batch (§ 5.5)
      if (recipe === null) {
        result.skipped += 1;
        continue;
      }
      const recipeLocalId = await mirrorRecipe(tx as unknown as Parameters<typeof mirrorRecipe>[0], recipe, planned.calories ?? null);
      const kcal =
        planned.calories === null || planned.calories === undefined
          ? null
          : Math.round(planned.calories);
      // Stato pre-upsert: base del conteggio imported vs updated (niente spuri
      // quando la riga esiste già e nulla cambia: il guard IS DISTINCT FROM
      // della upsert non tocca i dati e qui il confronto non conta l'update).
      // Incluse source e norish_deleted: una riga owner-override
      // (source='manual', § 5.4) NON è né import né update — la upsert la
      // salta (guard source='norish_sync') e i conteggi devono rifletterlo.
      const before = await tx.execute(sql`
        SELECT kcal, nutrients, recipe_id, date::text AS date_y, slot, norish_deleted AS deleted, source
        FROM diary_entries
        WHERE user_id = ${userId}::uuid AND norish_item_id = ${planned.id}::uuid
        LIMIT 1
      `);
      const existed = rows(before).length > 0;
      const prev = rows(before)[0] ?? {};
      const syncOwned = prev.source === "norish_sync";
      // servings: seed 1 SOLO all'import; i sync successivi non toccano MAI il
      // valore locale (l'utente può averlo a 0.5): la SET-list non contiene
      // servings e il guard IS DISTINCT FROM salta le righe invariate.
      await upsertDiaryEntry(tx, {
        user_id: userId,
        norish_item_id: planned.id,
        date: planned.date,
        slot: planned.slot,
        recipe_id: recipeLocalId,
        servings: 1,
        kcal,
        nutrients: normalizeNutrition({}, { protein: recipe.protein, fat: recipe.fat, carbs: recipe.carbs }),
      });
      if (existed && !syncOwned) {
        // Owner-override: la voce appartiene all'utente (source='manual'):
        // nessun import né update — la upsert non la tocca (§ 5.4).
        continue;
      }
      if (!existed) {
        result.imported += 1;
      } else if (
        prev.kcal !== kcal ||
        JSON.stringify(normalizeNutrition(prev.nutrients)) !== JSON.stringify(normalizeNutrition({}, { protein: recipe.protein, fat: recipe.fat, carbs: recipe.carbs })) ||
        (prev.recipe_id ?? null) !== (recipeLocalId ?? null) ||
        prev.date_y !== planned.date ||
        prev.slot !== planned.slot ||
        prev.deleted === true // restore dell'item rientrato nel payload
      ) {
        result.updated += 1;
      }
    }
    // Only a complete fetch authorizes reconciliation of the calendar partition.
    if (window !== null && !partial) {
      result.marked = await markDeletedNorishEntries(tx, userId, payload.map((i) => i.id), {
        windowStart: window.start,
        windowEnd: window.end,
      });
    }
    return result;
  });
}
