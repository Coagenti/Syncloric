import { z } from "zod";

const httpsOrLocalHttp = z
  .string()
  .trim()
  .refine(
    (value) => {
      // URL() normalizza anche forme senza authority: qui richiediamo un URL assoluto.
      if (!/^https?:\/\/[^/\\\s?#]+/i.test(value)) return false;
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return false;
      }
      if (value.endsWith("/") && url.pathname === "/") return false; // no trailing slash
      if (url.protocol === "https:") return true;
      // http ammesso solo su host locale per lo sviluppo (§ 9.2)
      return (
        url.protocol === "http:" &&
        (url.hostname === "localhost" ||
          url.hostname === "127.0.0.1" ||
          url.hostname === "::1" ||
          url.hostname.endsWith(".localhost"))
      );
    },
    { message: "NORISH_BASE_URL: https obbligatorio (http solo su localhost), senza trailing slash" },
  );

const hex64 = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, "ENCRYPTION_KEY: 64 caratteri esadecimali (32 byte)");

const envSchema = z.object({
  // NORISH_BASE_URL è OPZIONALE senza alcun default (decisione utente/TL
  // 2026-09-30, supersede ADR-0007 sulla parte fail-fast): assente o composta
  // solo da spazi → stringa vuota (Norish disabilitato, l'app parte degradata).
  // Un valore esplicito malformato resta un errore fail-fast.
  NORISH_BASE_URL: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value === undefined ? "" : value),
    z.union([z.literal(""), httpsOrLocalHttp]),
  ),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL mancante")
    .refine((value) => value.startsWith("postgres://") || value.startsWith("postgresql://"), {
      message: "DATABASE_URL deve essere una stringa di connessione postgres:// o postgresql://",
    }),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET: almeno 32 caratteri"),
  ENCRYPTION_KEY: hex64,
  NORISH_API_KEY: z.string().min(1).optional(),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export type SyncloricConfig = z.infer<typeof envSchema>;

let cached: SyncloricConfig | null = null;

/**
 * Config di deployment (§ 5.0, § 9.2): caricamento dichiarativo e senza fallback
 * per le variabili obbligatorie (DATABASE_URL, BETTER_AUTH_SECRET, ENCRYPTION_KEY):
 * mancanti o invalidi → `loadEnvConfig()` lancia all'avvio (fail fast).
 * NORISH_BASE_URL è opzionale: assente o composta solo da spazi diventa stringa
 * vuota (Norish disabilitato, avvio degradato), senza host embedded; un valore
 * esplicito malformato resta un errore di avvio.
 */
export function loadEnvConfig(env: NodeJS.ProcessEnv = process.env): SyncloricConfig {
  if (cached) return cached;
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Configurazione d'ambiente non valida — l'app non parte (fail fast, ADR-0007, § 5.0):\n${details}`,
    );
  }
  cached = parsed.data;
  return cached;
}

/** Reset della cache config (uso: test). */
export function resetEnvConfigCache(): void {
  cached = null;
}

/* ------------------------------------------------------------------------- */
/* Precedenza Norish (contract per card t_797de62f + GUI t_2bd5557f):          */
/*   URL salvato dalla GUI (admin_settings, card t_2bd5557f)  >  env > vuoto.  */
/* La chiave API NON è configurabile dalla GUI: resta la sola env, in modo     */
/* che l'override URL non possa puntare l'istanza verso segreti condivisi.     */
/* ------------------------------------------------------------------------- */

/** Sorgente dell'URL effettivo: `gui` = settings DB, `env` = NORISH_BASE_URL, `unset` = vuoto. */
export type NorishUrlSource = "gui" | "env" | "unset";

/**
 * Chiave admin_settings (task GUI t_2bd5557f) per l'URL salvato dall'UI.
 * Un solo upstream per istanza (ADR-0007): override globale, non per-utente.
 */
export const NORISH_SETTINGS_KEY = "norish.base_url";

/** URL valido → ritornato senza slash finale; altrimenti `null` (fail-safe: fallback a env). */
function readNorishSettingsUrl(override: NorishSettingsOverride | undefined): string | null {
  const raw = override?.adminSettings?.[NORISH_SETTINGS_KEY];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null; // vuoto/spazi: NON copre l'env
  const parsed = httpsOrLocalHttp.safeParse(trimmed);
  return parsed.success ? parsed.data : null; // malformato: ignorato (fallback a env)
}

function resolveNorishUrl(
  override: NorishSettingsOverride | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { url: string; source: NorishUrlSource } {
  const fromSettings = readNorishSettingsUrl(override);
  if (fromSettings !== null) return { url: fromSettings, source: "gui" };
  const fromEnv = loadEnvConfig(env).NORISH_BASE_URL;
  return { url: fromEnv, source: fromEnv === "" ? "unset" : "env" };
}

/**
 * Base URL effettiva dell'upstream (senza /api/v1): il client norish aggiunge
 * il suffisso (§ 5.1). Precedenza: GUI > env NORISH_BASE_URL > vuoto.
 * Le altre env obbligatorie e gli URL espliciti invalidi restano fail-fast via
 * loadEnvConfig (cache per processo: l'env non viene riletta implicitamente).
 */
export function norishBaseUrl(
  override?: NorishSettingsOverride,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveNorishUrl(override, env).url;
}

/** Chiave API upstream (solo env, mai DB — § 5.0). */
export function norishApiKey(
  _override?: NorishSettingsOverride,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return loadEnvConfig(env).NORISH_API_KEY;
}

export interface NorishConfigStatus {
  /** true solo con URL effettivo configurato (GUI o env). */
  enabled: boolean;
  /** Da dove viene l'URL effettivo. La GUI mostra "Configurato da: Impostazioni /.env". */
  source: NorishUrlSource;
  /** Presenza valori (mai i valori): proiezione sicura per la UI di configurazione. */
  urlPresent: boolean;
  apiKeyPresent: boolean;
}

/**
 * Proiezione per la GUI (card t_2bd5557f) e per le funzioni correlate:
 * NESSUN valore, solo lo stato. L'override segue la stessa forma della
 * proiezione settings DB che la GUI passa a questi getter
 * (adminSettings: Record<chiave, valore> — la chiamante non costruisce mappe).
 */
export function norishConfigStatus(
  override?: NorishSettingsOverride,
  env: NodeJS.ProcessEnv = process.env,
): NorishConfigStatus {
  const { url, source } = resolveNorishUrl(override, env);
  const envApiKey = loadEnvConfig(env).NORISH_API_KEY;
  return {
    enabled: url !== "",
    source,
    urlPresent: url !== "",
    apiKeyPresent: typeof envApiKey === "string" && envApiKey !== "",
  };
}

/** Forma della proiezione settings (admin_settings del DB): le altre proprietà verranno da qui. */
export interface NorishSettingsOverride {
  adminSettings: {
    [NORISH_SETTINGS_KEY]?: string;
    [key: string]: unknown;
  };
}