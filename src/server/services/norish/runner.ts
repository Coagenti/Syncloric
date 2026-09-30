import { sql, type SQL } from "drizzle-orm";
import { upsertDiaryEntry, markDeletedNorishEntries, mirrorRecipe } from "./sync";
import type { PlannedRecipe, RecipeDetail } from "./client";

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
 *   la finestra della sincronizzazione fornita: l'API non espone boundary/timezone
 *   espliciti, quindi la finestra è la min/max data OSSERVATA nel payload valido,
 *   estesa conservativamente a includere "oggi" (mai finestre inventate);
 * - payload vuoto o fetch parziale/fallito → NESSUNA marca.
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

function observedWindow(items: PlannedRecipe[]): { start: string; end: string } | null {
  const dates = items
    .map((i) => i.date)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  if (dates.length === 0) return null;
  return { start: dates[0], end: dates[dates.length - 1] };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
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
}): Promise<NorishSyncResult> {
  const { db, userId, client, period = "week" } = options;
  return db.transaction(async (tx) => {
    // Lock advisory XACT per utente DENTRO la transazione (stessa connessione,
    // auto-release al commit): due run concorrenti dello stesso utente si
    // serializzano; utenti diversi procedono in parallelo (§ 5.4).
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId})) AS acquired`);

    let payload: PlannedRecipe[];
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
          payload = [...week, ...(await client.getPlannedRecipesToday())];
        } catch {
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

    const window = observedWindow(payload);
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
        SELECT kcal, recipe_id, date::text AS date_y, slot, norish_deleted AS deleted, source
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
        (prev.recipe_id ?? null) !== (recipeLocalId ?? null) ||
        prev.date_y !== planned.date ||
        prev.slot !== planned.slot ||
        prev.deleted === true // restore dell'item rientrato nel payload
      ) {
        result.updated += 1;
      }
    }
    // Marcatura SOLO se payload valido e completo: finestra osservata min/max
    // del payload estesa a oggi (l'API non espone boundary/fuso espliciti).
    if (window !== null && !partial) {
      result.marked = await markDeletedNorishEntries(tx, userId, payload.map((i) => i.id), {
        windowStart: window.start,
        windowEnd: window.end < today() ? today() : window.end,
      });
    }
    return result;
  });
}