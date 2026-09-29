/**
 * Bootstrap Next.js (§ 3): register() gira una volta per processo server.
 * - fail fast config (§ 5.0): l'app NON parte con env invalida;
 * - migraizoni versionate applicate a runtime (container: drizzle/ in immagine);
 * - avvio scheduler in-process (ADR-0004): node-cron ogni 30 min per utente.
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
  loadEnvConfig(); // fail fast (§ 5.0)
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
  startScheduler();
  console.log(
    `[bootstrap] syncloric: config valida, scheduler avviato, db=${dbReady ? "migrato" : "NON migrato"}`,
  );
}