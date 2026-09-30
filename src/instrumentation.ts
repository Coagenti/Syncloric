/**
 * Bootstrap Next.js (§ 3): register() gira una volta per processo server.
 * - fail fast config (§ 5.0): l'app NON parte con env obbligatoria assente/invalida;
 * - migrazioni versionate applicate a runtime (container: drizzle/ in immagine);
 * - scheduler in-process (ADR-0004) SOLO con Norish configurato (URL via GUI o
 *   env): senza, l'app parte degradata (Norish disabilitato) con log chiaro —
 *   decisione utente/TL 2026-09-30, supersede ADR-0007 fail-fast sull'URL.
 * Skip durante il build (phase-production-build); su edge/non-node esce subito.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const [{ loadEnvConfig }, { migrateLatest }, { startScheduler }] = await Promise.all([
    import("@/server/config"),
    import("@/server/db/migrate-runtime"),
    import("@/server/services/scheduler"),
  ]);
  const config = loadEnvConfig(); // fail fast per env obbligatoria o invalida (§ 5.0)
  let dbReady = false;
  try {
    await migrateLatest();
    dbReady = true;
  } catch (error) {
    console.error(
      "[bootstrap] migrazioni non applicate: l'app parte degradata (GET /api/v1/health → 503);",
      "riprovare con `pnpm db:migrate` o riavvio container.",
      error instanceof Error ? error.message : error,
    );
  }
  if (config.NORISH_BASE_URL) {
    startScheduler();
  } else {
    console.log(
      "[bootstrap] Norish disabilitato: NORISH_BASE_URL non configurata; scheduler non avviato.",
    );
  }
  console.log(
    `[bootstrap] syncloric: config valida, scheduler ${config.NORISH_BASE_URL ? "avviato" : "non avviato"}, db=${dbReady ? "migrato" : "NON migrato"}`,
  );
}