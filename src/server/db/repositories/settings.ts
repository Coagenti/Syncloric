import { eq, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { adminSettings } from "../schema";

/**
 * Repository della tabella admin_settings (§ 4.6): singleton key/value per le
 * impostazioni amministrative dell'istanza (ai.*, barcode.* e — dal task GUI
 * t_2bd5557f — norish.base_url). Nessuna query direttamente nei route handler
 * (§ 3, regola 2): l'API settings passa da qui.
 *
 * Il valore è jsonb, quindi la stringa è preservata letteralmente (nessun trim,
 * nessuna normalizzazione): la semantica di normalizzazione/precedenza sta nel
 * modulo @/server/config (norishBaseUrl, norishConfigStatus).
 *
 * Il client è parametrico (PgTable/SQL di drizzle): le stesse query girano su
 * postgres.js (runtime, tipo `Db`) e su PGlite (test di integrazione), come
 * già per SqlExecutor in services/norish/sync.ts — la tipizzazione full `Db`
 * legherebbe il repository al solo driver postgres.js.
 */
interface SettingsClient {
  select(fields: Record<string, PgColumn>): {
    from(table: PgTable): {
      where(condition: SQL): Promise<Array<{ value?: unknown; key?: unknown }>>;
    };
  };
  insert(table: PgTable): {
    values(row: { key: string; value: unknown }): {
      onConflictDoUpdate(config: {
        target: PgColumn;
        set: { value: unknown };
      }): Promise<unknown>;
    };
  };
  delete(table: PgTable): {
    where(condition: SQL): {
      returning(fields: Record<string, PgColumn>): Promise<Array<{ key?: unknown }>>;
    };
  };
}

/** Lettura puntuale di una chiave: `null` se assente (mai default impliciti). */
export async function getAdminSetting<T = unknown>(
  db: {
    select: SettingsClient["select"];
  },
  key: string,
): Promise<T | null> {
  const rows = await db
    .select({ value: adminSettings.value })
    .from(adminSettings)
    .where(eq(adminSettings.key, key));
  const raw = (rows as Array<{ value: unknown }>)[0]?.value;
  if (raw === undefined || raw === null) return null;
  return raw as T;
}

/**
 * Lettura con default dichiarato dal chiamante (es. timeout barcode): la
 * chiave assente NON viene scritta (nessun default implicito nel DB).
 */
export async function getAdminSettingOrDefault<T>(
  db: Parameters<typeof getAdminSetting>[0],
  key: string,
  fallback: T,
): Promise<T> {
  const value = await getAdminSetting<T>(db, key);
  return value === null ? fallback : value;
}

/** Upsert idempotente della chiave: un solo upstream per istanza (ADR-0007). */
export async function setAdminSetting(
  db: {
    insert: SettingsClient["insert"];
  },
  key: string,
  value: unknown,
): Promise<void> {
  await db
    .insert(adminSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: adminSettings.key, set: { value } });
}

/**
 * Rimozione della chiave. `true` solo se una riga è stata davvero cancellata:
 * la distinzione "cancellato" vs "già assente" serve al feedback di salvataggio
 * della UI e al fail-safe della precedenza (chiave assente → fallback env).
 * `.returning()` è supportato da postgres.js e PGlite (array di righe eliminate).
 */
export async function deleteAdminSetting(
  db: {
    delete: SettingsClient["delete"];
  },
  key: string,
): Promise<boolean> {
  const deleted = (await db
    .delete(adminSettings)
    .where(eq(adminSettings.key, key))
    .returning({ key: adminSettings.key })) as Array<{ key?: unknown }>;
  return deleted.length > 0;
}