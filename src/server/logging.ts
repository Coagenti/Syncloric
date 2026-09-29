import pino from "pino";

/**
 * Logger di processo (JSON su stdout). Regole § 5.5/§ 6: log strutturati con
 * contesto (fase, user_id, run_id); MAI il valore delle chiavi API.
 *
 * Uso: import { logger } from "@/server/logging"; logger.child({ module: "..." }).
 * In test (NODE_ENV=test) il log va su un buffer silenzioso per non inquinare l'output.
 */
export const logger = pino(
  process.env.NODE_ENV === "test"
    ? { level: "silent" }
    : {
        level: process.env.LOG_LEVEL ?? "info",
        base: { service: "syncloric" },
        redact: {
          paths: [
            "apiKey",
            "*.apiKey",
            "norishApiKey",
            "*.norishApiKey",
            "api_key",
            "*.api_key",
            "authorization",
            "headers['x-api-key']",
          ],
          censor: "[REDACTED]",
        },
      },
);

export type Logger = typeof logger;