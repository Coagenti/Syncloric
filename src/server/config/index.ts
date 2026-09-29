import { z } from "zod";

const httpsOrLocalHttp = z
  .string()
  .trim()
  .refine(
    (value) => {
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
  NORISH_BASE_URL: httpsOrLocalHttp,
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
 * Config di deployment (§ 5.0, § 9.2): caricamento dichiarativo e senza fallback.
 * Se una variabile obbligatoria manca o è invalida → `loadEnvConfig()` lancia
 * all'avvio (fail fast): l'app NON parte con config parziale; nessun default
 * embedded per la base URL upstream.
 */
export function loadEnvConfig(env: NodeJS.ProcessEnv = process.env): SyncloricConfig {
  if (cached) return cached;
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Configurazione d'ambiente non valida — l'app non parte (fail fast, § 5.0):\n${details}`,
    );
  }
  cached = parsed.data;
  return cached;
}

/** Reset della cache config (uso: test). */
export function resetEnvConfigCache(): void {
  cached = null;
}

/**
 * Base URL dell'upstream (senza /api/v1): il client norish aggiunge il suffisso
 * (§ 5.1). Accesso centralizzato per il fail-fast: se chiamato in assenza di
 * env valido, l'errore è lo stesso di loadEnvConfig.
 */
export function norishBaseUrl(): string {
  return loadEnvConfig().NORISH_BASE_URL;
}