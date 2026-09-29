import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { loadEnvConfig } from "../config";

/**
 * Client DB unico dell'app (driver postgres.js, § 2: PostgreSQL 17 + Drizzle).
 * Tutto l'accesso ai dati passa dai repositories (§ 3, regola 2).
 *
 * Lazily: il client si crea al primo uso.getRuntime — import del modulo non
 * innesca il fail-fast della config che avviene nel bootstrap del server
 * (src/instrumentation.ts, register() → loadEnvConfig). In test si passa un
 * client dedicato (es. PGlite) con drizzleFor().
 */

type QueryClient = ReturnType<typeof postgres>;
type DbClient = ReturnType<typeof drizzle<typeof schema>>;

let clientSingleton: QueryClient | undefined;
let dbSingleton: DbClient | undefined;

export function createDbClient(databaseUrl?: string): DbClient {
  if (dbSingleton) return dbSingleton;
  const url = databaseUrl ?? loadEnvConfig().DATABASE_URL;
  const client = postgres(url, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 5,
    prepare: false, // compatibile con pgbouncer transaction-pooling
  });
  clientSingleton = client;
  dbSingleton = drizzle(client, { schema });
  return dbSingleton;
}

/** Accesso canonico al client DB dell'app (lazy, fail-fast in bootstrap). */
export function getDb(): DbClient {
  return createDbClient();
}

/** Per i test: costruisce un handle Drizzle su un client fornito (es. PGlite). */
export function drizzleFor(client: QueryClient) {
  return drizzle(client, { schema });
}

/** Solo per i test: chiude e svuota i singleton di processo. */
export async function resetDb(): Promise<void> {
  if (clientSingleton) {
    try {
      await clientSingleton.end({ timeout: 1 });
    } catch {
      // ignore: reset di test
    }
  }
  clientSingleton = undefined;
  dbSingleton = undefined;
}

export { schema };
export type Db = DbClient;