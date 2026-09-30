import cron from "node-cron";
import { sql } from "drizzle-orm";
import { getDb, type Db } from "@/server/db";
import { logger } from "@/server/logging";
import { decryptSecret } from "./norish/crypto";
import { loadEnvConfig, norishBaseUrl, NORISH_SETTINGS_KEY, type SyncloricConfig } from "@/server/config";
import { getAdminSetting } from "@/server/db/repositories/settings";
import { buildAdminSettingsOverride } from "./settings/norish-url";
import { NorishClient, NorishApiError } from "./norish/client";
import { runNorishSync, NorishSyncError } from "./norish/runner";
import { finishSyncRun, startSyncRun } from "./norish/sync";

const SYNC_CRON = "*/30 * * * *";

const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 30 * 60_000;
type Status = "ok" | "error" | "partial";
type Reason = "auth" | null;

interface SchedulerDeps {
  migrationsReady(db: Db): Promise<boolean>;
  resolveBaseUrl(db: Db): Promise<string>;
  listUserIds(db: Db): Promise<string[]>;
  isBreakerOpen(db: Db, userId: string, now: Date): Promise<boolean>;
  acquireLock(tx: unknown, userId: string): Promise<boolean>;
  startSyncRun(db: Db, userId: string): Promise<string>;
  finishSyncRun(db: Db, runId: string, status: Status, items: number, message: string | null, reason?: Reason): Promise<void>;
  resolveClient(config: SyncloricConfig, userId: string, db: Db): Promise<NorishClient | null>;
  runNorishSync(options: { db: Db; userId: string; client: NorishClient }): Promise<{ imported: number; updated: number; skipped: number; marked: number; partial?: true }>;
}

function rows(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? result : (result as { rows?: Record<string, unknown>[] })?.rows ?? [];
}

/** Il fallback demo è assegnato solo all'utente bootstrap, mai a tutti gli utenti. */
export function resolveNorishClient(config: SyncloricConfig, setting: { key: string; value: unknown } | undefined): NorishClient | null {
  if (setting !== undefined) {
    const encrypted = setting.value as { ciphertext?: string } | null;
    if (typeof encrypted?.ciphertext !== "string") return null;
    return new NorishClient({ baseUrl: config.NORISH_BASE_URL, apiKey: decryptSecret(encrypted.ciphertext, config.ENCRYPTION_KEY) });
  }
  return config.NORISH_API_KEY ? new NorishClient({ baseUrl: config.NORISH_BASE_URL, apiKey: config.NORISH_API_KEY }) : null;
}

const defaults: SchedulerDeps = {
  async migrationsReady(db) {
    // Guard before any read/write of application tables, including when migrateLatest failed.
    const result = rows(await db.execute(sql`SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'norish_sync_runs' AND column_name = 'reason'
    ) AS ready`));
    return result[0]?.ready === true;
  },
  async resolveBaseUrl(db) {
    const saved = await getAdminSetting<string>(db, NORISH_SETTINGS_KEY);
    return norishBaseUrl(buildAdminSettingsOverride(saved ?? undefined));
  },
  async listUserIds(db) {
    // Il primo account è il destinatario del bootstrap demo (se presente).
    // Altri account richiedono una propria chiave cifrata, mai fanout env.
    const result = rows(await db.execute(sql`SELECT id AS user_id FROM users
      WHERE id = (SELECT id FROM users ORDER BY created_at, id LIMIT 1)
      OR EXISTS (SELECT 1 FROM admin_settings WHERE key = 'norish.key.' || users.id::text)`));
    return [...new Set(result.map((row) => String(row.user_id)))];
  },
  async isBreakerOpen(db, userId, now) {
    const recent = rows(await db.execute(sql`SELECT status, finished_at FROM norish_sync_runs
      WHERE user_id = ${userId}::uuid ORDER BY started_at DESC, id DESC LIMIT ${BREAKER_THRESHOLD}`));
    if (recent.length < BREAKER_THRESHOLD || !recent.every((r) => r.status === "error")) return false;
    const finished = recent[0].finished_at;
    return !!finished && now.getTime() - new Date(String(finished)).getTime() < BREAKER_COOLDOWN_MS;
  },
  async acquireLock(tx, userId) {
    const result = rows(await (tx as Db).execute(sql`SELECT pg_try_advisory_xact_lock(hashtext(${userId})) AS acquired`));
    return result[0]?.acquired === true;
  },
  startSyncRun,
  finishSyncRun,
  async resolveClient(config, userId, db) {
    const result = rows(await db.execute(sql`SELECT key, value FROM admin_settings WHERE key = ${`norish.key.${userId}`} LIMIT 1`));
    if (result.length) return resolveNorishClient(config, result[0] as { key: string; value: unknown });
    const first = rows(await db.execute(sql`SELECT id FROM users ORDER BY created_at, id LIMIT 1`))[0]?.id;
    return first === userId ? resolveNorishClient(config, undefined) : null;
  },
  runNorishSync: (options) => runNorishSync(options),
};

/** La callback cron non può produrre una unhandled rejection. L'URL si risolve a ogni tick. */
export function startScheduler(): { stop: () => void } {
  const task = cron.schedule(SYNC_CRON, () => {
    void runSchedulerTick().catch(() => logger.error("[scheduler] tick fallito prima della run; verificare migrazioni/DB"));
  });
  logger.info({ cron: SYNC_CRON }, "[scheduler] attivo; Norish abilitato per tick");
  return { stop: () => task.stop() };
}

function authError(error: unknown): boolean {
  if (error instanceof NorishApiError) return error.status === 401 || error.status === 403;
  if (error instanceof NorishSyncError && error.cause) return authError(error.cause);
  return false;
}

/** Solo diagnostica controllata: mai propagare testo upstream, key, URL o eccezioni SQL. */
function safeError(error: unknown): string {
  if (authError(error)) return "Norish authentication failed (HTTP 401/403)";
  if (error instanceof NorishApiError) return `Norish API HTTP ${error.status}`;
  if (error instanceof NorishSyncError) return `Norish ${error.phase} failed`;
  return "Norish sync failed";
}

export async function runSchedulerTick(now: Date = new Date(), options?: { deps?: Partial<SchedulerDeps>; db?: Db }): Promise<string[]> {
  const deps = { ...defaults, ...options?.deps };
  const fullyInjected = options?.deps && Object.keys(defaults).every((key) => key in options.deps!);
  const db = options?.db ?? (fullyInjected ? ({} as Db) : getDb());
  try {
    if (!(await deps.migrationsReady(db))) {
      logger.warn("[scheduler] migrazioni non applicate: tick saltato");
      return [];
    }
    const baseUrl = await deps.resolveBaseUrl(db);
    if (!baseUrl) {
      logger.info("[scheduler] Norish disabilitato: nessun URL configurato; tick saltato");
      return [];
    }
    const config = { ...loadEnvConfig(), NORISH_BASE_URL: baseUrl };
    const runIds: string[] = [];
    for (const userId of await deps.listUserIds(db)) {
      try {
        if (await deps.isBreakerOpen(db, userId, now)) continue;
        const work = async (tx: Db) => {
          if (!(await deps.acquireLock(tx, userId))) return;
          // Risolvere la chiave prima di aprire la run: nessuna run fittizia per utenti non configurati.
          let client: NorishClient | null;
          try {
            client = await deps.resolveClient(config, userId, tx);
          } catch {
            logger.error({ user_id: userId }, "[scheduler] chiave cifrata non utilizzabile");
            return;
          }
          if (!client) return;
          const runId = await deps.startSyncRun(tx, userId);
          try {
            const result = await deps.runNorishSync({ db: tx, userId, client });
            await deps.finishSyncRun(tx, runId, result.partial ? "partial" : "ok", result.imported + result.updated, null);
            logger.info({ user_id: userId, run_id: runId, imported: result.imported, updated: result.updated }, "[scheduler] tick completato");
          } catch (error) {
            const message = safeError(error);
            await deps.finishSyncRun(tx, runId, "error", 0, message, authError(error) ? "auth" : null);
            logger.error({ user_id: userId, run_id: runId, reason: authError(error) ? "auth" : "sync" }, "[scheduler] tick fallito");
          }
          runIds.push(runId);
        };
        if (fullyInjected && !options?.db) await work({} as Db);
        else await db.transaction(async (tx) => work(tx as unknown as Db));
      } catch {
        logger.error({ user_id: userId }, "[scheduler] transazione tick fallita");
      }
    }
    return runIds;
  } catch {
    logger.warn("[scheduler] database non disponibile o migrazioni non applicate: tick saltato");
    return [];
  }
}
