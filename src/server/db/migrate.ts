/**
 * CLI di migrazione per sviluppo locale: `pnpm db:migrate` (§ 3: runner
 * drizzle-kit). Il bundle standalone non include questo modulo CLI: nel
 * container le migrazioni sono applicate dal bootstrap (migrate-runtime).
 * Compilato al volo da esbuild (vedi scripts/run-db-migrate.cjs).
 */
import "dotenv/config";
import { migrateLatest } from "@/server/db/migrate-runtime";
import { logger } from "@/server/logging";

migrateLatest()
  .then(() => {
    console.log("[migrate] migrazioni applicate");
    process.exit(0);
  })
  .catch((error: unknown) => {
    logger.error({ error }, "[migrate] fallimento migrazioni");
    process.exit(1);
  });