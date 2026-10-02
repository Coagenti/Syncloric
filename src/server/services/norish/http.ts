import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { Db } from "@/server/db";
import { loadEnvConfig, norishBaseUrl, norishUpstreamTimeZone, NORISH_SETTINGS_KEY, type SyncloricConfig } from "@/server/config";
import { getAdminSetting } from "@/server/db/repositories/settings";
import { buildAdminSettingsOverride } from "@/server/services/settings/norish-url";
import { resolveNorishClient } from "@/server/services/scheduler";
import { NorishApiError } from "./client";
import { startSyncRun, finishSyncRun } from "./sync";
import { runNorishSync, NorishSyncError, type SyncPort } from "./runner";

function rows(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? result : (result as { rows?: Record<string, unknown>[] })?.rows ?? [];
}

// Shared by handler instances, only for immediate same-process duplicate rejection.
// The transaction advisory lock is authoritative across workers and the scheduler.
const inFlight = new Set<string>();
const json = (payload: unknown, status = 200) => NextResponse.json(payload, {
  status, headers: { "Cache-Control": "private, no-store" },
});
const busy = () => json({ error: "Sincronizzazione già in corso." }, 503);
const unavailable = () => json({ error: "Sincronizzazione non disponibile. Verifica la configurazione Norish." }, 503);

async function resolveClient(config: SyncloricConfig, userId: string, db: Db): Promise<SyncPort | null> {
  const key = `norish.key.${userId}`;
  const setting = rows(await db.execute(sql`SELECT key, value FROM admin_settings WHERE key = ${key} LIMIT 1`))[0] as { key: string; value: unknown } | undefined;
  const first = rows(await db.execute(sql`SELECT id FROM users ORDER BY created_at,id LIMIT 1`))[0]?.id;
  // Preserve the scheduler's encrypted per-user key policy; env demo only for first account.
  return resolveNorishClient(config, setting, first === userId);
}

function isAuthError(error: unknown): boolean {
  if (error instanceof NorishApiError) return error.status === 401 || error.status === 403;
  return error instanceof NorishSyncError && !!error.cause && isAuthError(error.cause);
}

export interface SyncRouteDeps {
  getDb: () => Db;
  getSession: (headers: Headers) => Promise<{ user: { id: string } } | null>;
  acquireLock?: (tx: Db, userId: string) => Promise<boolean>;
  resolveClient?: typeof resolveClient;
  runSync?: typeof runNorishSync;
}

/** Session-scoped on-demand sync. No upstream diagnostics or credentials leave this boundary. */
export function buildSyncHandlers(deps: SyncRouteDeps) {
  return {
    async POST(request: Request) {
      const session = await deps.getSession(request.headers);
      if (!session?.user) return json({ error: "Autenticazione richiesta." }, 401);
      const origin = request.headers.get("origin");
      if (origin !== null && origin !== new URL(request.url).origin) {
        return json({ error: "Origine non consentita." }, 403);
      }
      if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
        return json({ error: "Content-Type application/json richiesto." }, 400);
      }
      const userId = session.user.id;
      if (inFlight.has(userId)) return busy();
      inFlight.add(userId);
      try {
        const db = deps.getDb();
        const saved = await getAdminSetting<string>(db, NORISH_SETTINGS_KEY);
        const baseUrl = norishBaseUrl(buildAdminSettingsOverride(saved ?? undefined));
        if (!baseUrl) return unavailable();
        const config = { ...loadEnvConfig(), NORISH_BASE_URL: baseUrl };
        return await db.transaction(async (tx) => {
          const database = tx as unknown as Db;
          // Same namespace as scheduler/runner; nested runner savepoint uses this connection.
          const acquired = deps.acquireLock ? await deps.acquireLock(database, userId)
            : rows(await database.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext(${userId})) AS acquired`))[0]?.acquired === true;
          if (!acquired) return busy();
          const client = await (deps.resolveClient ?? resolveClient)(config, userId, database);
          if (!client) return unavailable();
          const runId = await startSyncRun(database, userId);
          let status: "ok" | "partial" | "error";
          let reason: "auth" | null = null;
          try {
            const result = await (deps.runSync ?? runNorishSync)({ db: database, userId, client,
              upstreamTimeZone: norishUpstreamTimeZone() });
            status = result.partial ? "partial" : "ok";
            await finishSyncRun(database, runId, status, result.imported + result.updated, null);
          } catch (error) {
            status = "error";
            reason = isAuthError(error) ? "auth" : null;
            await finishSyncRun(database, runId, status, 0,
              reason === "auth" ? "Norish authentication failed (HTTP 401/403)" : "Norish sync failed", reason);
          }
          const finishedAt = rows(await database.execute(sql`SELECT finished_at FROM norish_sync_runs WHERE id=${runId}::uuid`))[0].finished_at;
          return json({ status, reason, origin: reason === "auth" ? new URL(baseUrl).origin : null,
            finishedAt: new Date(String(finishedAt)).toISOString() });
        });
      } catch {
        return unavailable();
      } finally {
        inFlight.delete(userId);
      }
    },
  };
}
