"use client";

import { useState } from "react";
import { fetchJson } from "@/lib/http-client";

/**
 * Scheda "Norish URL" della pagina Impostazioni (task GUI t_2bd5557f).
 * Usabile da non tecnici: etichetta chiara, placeholder 'your norish url',
 * nessun valore precompilato, validazione con messaggio comprensibile,
 * pulsanti Salva/Cancella con feedback di conferma.
 *
 * Lo stato mostrato arriva da GET /api/v1/settings/norish-url
 * ({ saved, status: norishConfigStatus }) — la GUI mostra lo STATO della
 * configurazione, mai i valori (l'URL non è un segreto, la chiave API non è
 * mai in DB/GUI, § 5.0). La pagina ospite (/settings) passa i valori iniziali
 * (server component → client component) per evitare il flash di caricamento.
 */

export interface SettingsStatusJson {
  enabled: boolean;
  source: "gui" | "env" | "unset";
  urlPresent: boolean;
  apiKeyPresent: boolean;
}

interface SettingsPayload {
  saved: string | null;
  status: SettingsStatusJson;
  saved_ok?: boolean;
  hostChanged?: boolean;
  error?: string;
}

/** PUT del nuovo URL ("" = cancellazione con fallback su .env). */
export async function saveNorishUrl(url: string): Promise<SettingsPayload> {
  return fetchJson<SettingsPayload>("/api/v1/settings/norish-url", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
}

/** DELETE dell'URL salvato (ritorno al fallback env). */
export async function clearNorishUrl(): Promise<SettingsPayload> {
  return fetchJson<SettingsPayload>("/api/v1/settings/norish-url", { method: "DELETE" });
}

/** Feedback di conferma/errore (pura, testabile): nessun valore mostrato. */
export function feedbackMessage(
  result:
    | { ok: true; status: SettingsStatusJson; hostChanged?: boolean }
    | { ok: false; error: string },
): string {
  if (!result.ok) return result.error;
  if (result.hostChanged) return "URL aggiornato: verifica le tue chiavi Norish";
  if (result.status.source === "gui" && result.status.enabled) {
    return "URL Norish salvato: ora l'app usa Impostazioni.";
  }
  if (result.status.source === "env") {
    return "URL Norish rimosso: ora l'app usa il file .env.";
  }
  return "URL Norish rimosso: nessun URL configurato.";
}

const SOURCE_LABEL: Record<SettingsStatusJson["source"], string | null> = {
  gui: "Configurato da: Impostazioni",
  env: "Configurato da: .env",
  unset: null,
};

export function SettingsNorishCard({
  initialSaved,
  initialStatus,
}: {
  initialSaved: string | null;
  initialStatus: SettingsStatusJson;
}) {
  const [url, setUrl] = useState(initialSaved ?? "");
  const [status, setStatus] = useState<SettingsStatusJson>(initialStatus);
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const payload = await saveNorishUrl(url);
      setStatus(payload.status);
      setUrl(payload.saved ?? "");
      setFeedback({ text: feedbackMessage({ ok: true, status: payload.status, hostChanged: payload.hostChanged }), ok: true });
    } catch (error) {
      setFeedback({
        text: error instanceof Error ? error.message : "Errore durante il salvataggio",
        ok: false,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setSaving(true);
    setFeedback(null);
    try {
      const payload = await clearNorishUrl();
      setStatus(payload.status);
      setUrl("");
      setFeedback({ text: feedbackMessage({ ok: true, status: payload.status, hostChanged: payload.hostChanged }), ok: true });
    } catch (error) {
      setFeedback({
        text: error instanceof Error ? error.message : "Errore durante la cancellazione",
        ok: false,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="norish-url-heading" className="max-w-2xl">
      <h2 id="norish-url-heading" className="text-lg font-semibold">
        Norish URL
      </h2>
      <p className="mt-1 text-sm opacity-80">
        Indirizzo del tuo server Norish.{" "}
        <span data-testid="norish-source">{SOURCE_LABEL[status.source] ?? "Norish non configurato"}</span>
      </p>
      <p className="mt-1 text-sm" data-testid="norish-state">
        {status.enabled ? "Norish configurato" : "Norish non configurato"}
      </p>
      <form onSubmit={handleSave} className="mt-4 flex flex-col gap-3">
        <label htmlFor="norish-url" className="text-sm font-medium">
          Norish URL
        </label>
        <input
          id="norish-url"
          name="norish-url"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="your norish url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="rounded-md border border-cyber-border bg-cyber-surface px-3 py-2 text-sm"
        />
        <p className="text-xs opacity-70">
          Lascia il campo vuoto per usare l&apos;eventuale impostazione da file .env.
        </p>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md border border-cyber-border px-4 py-2 text-sm hover:bg-cyber-surface disabled:opacity-50"
          >
            {saving ? "Salvataggio…" : "Salva"}
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={saving}
            className="rounded-md border border-cyber-border px-4 py-2 text-sm hover:bg-cyber-surface disabled:opacity-50"
          >
            Cancella
          </button>
        </div>
        {feedback && (
          <p role="status" className={`text-sm ${feedback.ok ? "text-emerald-400" : "text-red-400"}`}>
            {feedback.text}
          </p>
        )}
      </form>
    </section>
  );
}

export default SettingsNorishCard;