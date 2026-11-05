import { z } from "zod";
import { NORISH_SETTINGS_KEY, type NorishConfigStatus } from "@/server/config";

/**
 * Servizio settings per la pagina Impostazioni (contratto GUI t_2bd5557f).
 * Funzioni pure: validazione input, proiezione view, forma override.
 * L'accesso al DB sta nel repository, l'autorizzazione nel route handler.
 */

/**
 * Stessa regola sintattica dell'env (§ 9.2): https, senza trailing slash,
 * solo http locale. Riutilizzata per l'input della GUI: un non tecnico deve
 * poter incollare solo URL validi; la cancellazione è la stringa vuota.
 * Esportata per l'API (route handler) e per l'export del contratto.
 */
export const norishUrlInputSchema = z
  .string()
  .trim()
  .refine(
    (value) => {
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
    {
      message:
        "URL non valido: usa un indirizzo completo con https (es. https://norish.example.invalid) oppure lascia il campo vuoto",
    },
  );

export type ParseNorishUrlResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * Valida l'input del campo Norish URL: stringa vuota/spazi = cancellazione
 * (OK, l'URL ricade su .env se presente); altrimenti l'URL deve essere
 * sintatticamente valido. Ritorna l'input di `PUT /api/v1/settings/norish-url`.
 */
export function parseNorishUrlInput(raw: unknown): ParseNorishUrlResult {
  if (typeof raw !== "string") {
    return { ok: false, error: "Inserisci un URL valido (https) oppure lascia il campo vuoto" };
  }
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: "" };
  const parsed = norishUrlInputSchema.safeParse(trimmed);
  if (!parsed.success) {
    return { ok: false, error: "URL non valido: inserisci un indirizzo completo con https o lascia il campo vuoto." };
  }
  return { ok: true, value: parsed.data };
}

/**
 * Forma dell'override per i getter @/server/config: la chiamante
 * proietta la tabella admin_settings in un Record — nessuna mappa aggiuntiva.
 */
export interface AdminSettingsOverrideShape {
  adminSettings: { [NORISH_SETTINGS_KEY]?: string; [key: string]: unknown };
}

/** Il valore GUI proiettato nella forma dei getter ("" = esplicitamente vuoto). */
export function buildAdminSettingsOverride(
  savedNorishUrl: string | undefined,
): AdminSettingsOverrideShape {
  if (savedNorishUrl === undefined) return { adminSettings: {} };
  return { adminSettings: { [NORISH_SETTINGS_KEY]: savedNorishUrl } };
}

/** Vista per la pagina Impostazioni: mostra LO STATO, mai i segreti (§ 5.0). */
export interface SettingsView {
  statusText: string;
  /** "Configurato da: Impostazioni | .env", null se non configurato. */
  sourceText: string | null;
  enabled: boolean;
  urlPresent: boolean;
  apiKeyPresent: boolean;
}

/** Proietta norishConfigStatus nella view (nessun valore, solo stato). */
export function toSettingsView(status: NorishConfigStatus): SettingsView {
  const sourceText =
    status.source === "gui"
      ? "Configurato da: Impostazioni"
      : status.source === "env"
        ? "Configurato da: .env"
        : null;
  return {
    statusText: status.enabled ? "Norish configurato" : "Norish non configurato",
    sourceText,
    enabled: status.enabled,
    urlPresent: status.urlPresent,
    apiKeyPresent: status.apiKeyPresent,
  };
}

/** Vista iniziale prima del primo caricamento (niente spurious "unset"). */
export function emptySettingsView(): SettingsView {
  return {
    statusText: "",
    sourceText: null,
    enabled: false,
    urlPresent: false,
    apiKeyPresent: false,
  };
}