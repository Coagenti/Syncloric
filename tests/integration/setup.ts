import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import * as schema from "@/server/db/schema";

/**
 * Postgres di test dei test di integrazione (§ 8): PGlite in-memory per lo
 * sviluppo locale (Docker non disponibile su questo ambiente). Le migrazioni
 * drizzle sono le STESSSE dell'app: nessuna divergenza con produzione.
 */

export type TestDb = PgliteDatabase<typeof schema>;

let client: PGlite | undefined;

export async function makeTestDb(): Promise<TestDb> {
  if (!client) {
    client = new PGlite();
    const database = drizzle(client, { schema });
    await migrate(database, { migrationsFolder: "./drizzle" });
  }
  return drizzle(client as PGlite, { schema });
}

export async function closeTestDb(): Promise<void> {
  if (client) {
    await client.close();
    client = undefined;
  }
}

/** Svuota le tabelle operative tra i test (ordine FK-safe con CASCADE). */
export async function resetTables(db: TestDb): Promise<void> {
  await db.execute(
    sql`TRUNCATE diary_entries, recipes, foods, norish_sync_runs, admin_settings, profiles, sessions, accounts, verifications, users CASCADE`,
  );
}