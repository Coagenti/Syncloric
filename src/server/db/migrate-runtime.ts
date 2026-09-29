/**
 * Migrazioni a runtime per il container (invocate dal bootstrap register(),
 * NON da un processo separato): il bundle standalone Next include i soli
 * moduli tracciati, quindi il migrator deve essere importato da codice che
 * parte col server. Idempotente: drizzle salta le migrazioni già applicate.
 */
import path from "node:path";
import process from "node:process";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate as drizzleMigrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { loadEnvConfig } from "@/server/config";

export function migrationsFolder(): string {
  return path.resolve(process.cwd(), "drizzle");
}

/** Applica le migrazioni versionate (drizzle/). Lancia in caso di errore: fail fast. */
export async function migrateLatest(): Promise<void> {
  const { DATABASE_URL } = loadEnvConfig();
  const client = postgres(DATABASE_URL, { max: 1, prepare: false });
  const db = drizzle(client);
  try {
    await drizzleMigrate(db, { migrationsFolder: migrationsFolder() });
  } finally {
    await client.end();
  }
}