import "dotenv/config";
import { loadEnvConfig, norishBaseUrl, norishUpstreamTimeZone, NORISH_SETTINGS_KEY } from "@/server/config";
import { getAdminSetting } from "@/server/db/repositories/settings";
import { buildAdminSettingsOverride } from "../settings/norish-url";
import { NorishApiError } from "./client";
import { runNorishSync, NorishSyncError } from "./runner";
import { resolveUserNorishClient } from "../scheduler";
import { startSyncRun, finishSyncRun } from "./sync";
import { getDb } from "@/server/db";

/** Trigger esplicito: pnpm sync:norish --user <uuid> [--period week|month].
 * La chiave non è mai un argomento né un valore stampato. Il comando non crea utenti.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const userId = args[args.indexOf("--user") + 1];
  const period = args.includes("--period") ? args[args.indexOf("--period") + 1] : "week";
  if (!userId || !UUID.test(userId) || (period !== "week" && period !== "month")) {
    throw new Error("Uso: sync:norish --user <uuid> [--period week|month]");
  }
  const db = getDb();
  const saved = await getAdminSetting<string>(db, NORISH_SETTINGS_KEY);
  const baseUrl = norishBaseUrl(buildAdminSettingsOverride(saved ?? undefined));
  if (!baseUrl) {
    console.log("[sync:norish] Norish disabilitato: URL non configurato; nessuna run");
    return;
  }
  const config = { ...loadEnvConfig(), NORISH_BASE_URL: baseUrl };
  const upstreamTimeZone = norishUpstreamTimeZone();
  const client = await resolveUserNorishClient(config, userId, db);
  if (!client) throw new Error("chiave Norish non disponibile per l'utente richiesto");
  const runId = await startSyncRun(db, userId);
  try {
    const result = await runNorishSync({ db, userId, client, period, upstreamTimeZone });
    await finishSyncRun(db, runId, result.partial ? "partial" : "ok", result.imported + result.updated, null);
    console.log(`[sync:norish] imported=${result.imported} updated=${result.updated} skipped=${result.skipped} marked=${result.marked}`);
  } catch (error) {
    const cause = error instanceof NorishSyncError ? error.cause : error;
    const status = cause instanceof NorishApiError ? cause.status : null;
    const reason = status === 401 || status === 403 ? "auth" : null;
    await finishSyncRun(db, runId, "error", 0, reason ? "Norish authentication failed (HTTP 401/403)" : "Norish sync failed", reason);
    throw new Error(reason ? "autenticazione Norish fallita (401/403)" : "sincronizzazione Norish fallita");
  }
}

main().catch((error: unknown) => {
  // Errori upstream non fidati NON sono interpolati nei log.
  console.error(error instanceof Error && /^(Uso:|autenticazione Norish|sincronizzazione Norish|chiave Norish)/.test(error.message)
    ? `[sync:norish] ${error.message}` : "[sync:norish] errore di configurazione o database");
  process.exitCode = 1;
});
