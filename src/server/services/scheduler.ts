import cron from "node-cron";
import { desc, eq, sql } from "drizzle-orm";
import { getDb, type Db } from "@/server/db";
import { logger } from "@/server/logging";
import { norishSyncRuns } from "@/server/db/schema";
import { finishSyncRun, startSyncRun } from "./norish/sync";

/**
 * Scheduler in-process (ADR-0004, § 5.4): node-cron, un job per run, ogni 30
 * minuti. Serializzato su Postgres con advisory lock XACT per utente dentro una
 * transazione — niente Redis in v1. Il lock a livello di transazione evita la
 * trappola del pool postgres.js: con pg_try_advisory_lock di SESSIONE il lock
 * e l'unlock possono finire su connessioni diverse (lock mai rilasciato).
 * Circuit breaker § 5.5: 3 sync consecutive fallite → pausa 30 min
 * (stato dedotto da norish_sync_runs).
 *
 * Avvio: src/instrumentation.ts (bootstrap Next). La sync reale per-utente
 * (decrypt chiavi, client, upsert) è work della card feature t_849137b2:
 * qui ossatura del job, lock e audit.
 */

const SYNC_CRON = "*/30 * * * *"; // ogni 30 minuti (§ 5.4)
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 30 * 60 * 1_000;

export interface SchedulerHandle {
  stop: () => void;
}

export function startScheduler(): SchedulerHandle {
  const task = cron.schedule(SYNC_CRON, () => {
    void runSchedulerTick();
  });
  logger.info({ cron: SYNC_CRON }, "[scheduler] sync norish avviata (§ 5.4)");
  return { stop: () => task.stop() };
}

export async function runSchedulerTick(now: Date = new Date()): Promise<string[]> {
  const db = getDb();
  const runIds: string[] = [];
  // NOTA: SELECT DISTINCT non ammette ORDER BY su colonne fuori dalla select
  // list (SQL invalido su Postgres): la dedup è comunque fatta lato JS sotto.
  const rows = await db
    .selectDistinct({ userId: norishSyncRuns.userId })
    .from(norishSyncRuns)
    .limit(100);
  const distinctUserIds = [...new Set(rows.map((r) => r.userId))];
  for (const userId of distinctUserIds) {
    if (await isBreakerOpen(db, userId, now)) {
      logger.warn({ user_id: userId }, "[scheduler] circuit breaker aperto: pausa 30 min");
      continue;
    }
    try {
      // Lock transaction-scoped: acquisito e rilasciato sulla STESSA connessione
      // riservata dalla transazione (auto-release al commit/rollback).
      await db.transaction(async (tx) => {
        const locked = await firstRow(
          tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext(${userId})) AS acquired`),
        );
        if (!locked?.acquired) {
          logger.info({ user_id: userId }, "[scheduler] run già in corso: skip");
          return;
        }
        const runId = await startSyncRun(tx as unknown as Db, userId);
        try {
          // Card feature t_849137b2: qui il lavoro concreto per-utente (fetch + upsert).
          await finishSyncRun(tx as unknown as Db, runId, "ok", 0, null);
          logger.info({ user_id: userId, run_id: runId }, "[scheduler] tick completato");
        } catch (error) {
          await finishSyncRun(
            tx as unknown as Db,
            runId,
            "error",
            0,
            error instanceof Error ? error.message : String(error),
          );
          logger.error({ user_id: userId, run_id: runId }, "[scheduler] tick fallito");
        }
        runIds.push(runId);
      });
    } catch (error) {
      logger.error({
        user_id: userId,
        err: error instanceof Error ? error.message : String(error),
      }, "[scheduler] transazione tick fallita");
    }
  }
  return runIds;
}

/** Circuit breaker § 5.5: le ultime N sync dell'utente sono fallite entro la finestra. */
async function isBreakerOpen(db: Db, userId: string, now: Date): Promise<boolean> {
  const rows = await db
    .select({ status: norishSyncRuns.status, finishedAt: norishSyncRuns.finishedAt })
    .from(norishSyncRuns)
    .where(eq(norishSyncRuns.userId, userId))
    .orderBy(desc(norishSyncRuns.startedAt))
    .limit(BREAKER_THRESHOLD);
  if (rows.length < BREAKER_THRESHOLD) return false;
  const allFailed = rows.every((row) => row.status === "error");
  if (!allFailed) return false;
  const last = rows[0].finishedAt;
  if (!last) return false;
  return now.getTime() - last.getTime() < BREAKER_COOLDOWN_MS;
}

/**
 * Estrae la prima riga di un result di db.execute che cambia forma a seconda
 * del driver (postgres.js: RowList-array; altri: { rows }).
 */
async function firstRow(
  result: Promise<unknown> | unknown,
): Promise<Record<string, unknown> | undefined> {
  const resolved = await result;
  if (Array.isArray(resolved)) {
    return resolved[0] as Record<string, unknown> | undefined;
  }
  const withRows = resolved as { rows?: unknown[] };
  return withRows?.rows?.[0] as Record<string, unknown> | undefined;
}