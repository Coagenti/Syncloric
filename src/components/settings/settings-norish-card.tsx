"use client";

import { useI18n } from "@/components/ui-preferences-provider";
import { useRef, useState } from "react";
import { fetchJson } from "@/lib/http-client";

/**
 * Scheda "Norish URL" della pagina Impostazioni (task GUI t_2bd5557f).
 * Usabile da non tecnici: etichetta chiara, placeholder 'your norish url',
 * nessun valore precompilato, validazione con messaggio comprensibile,
 * pulsanti Salva/Cancella con feedback di conferma.
 *
 * Lo stato mostrato arriva da GET /api/v1/settings/norish-url
 * ({ saved, status: norishConfigStatus }) — questa scheda gestisce l'URL
 * globale, senza leggere o mostrare le chiavi personali. La scheda credenziali
 * separata salva le chiavi cifrate. La pagina ospite passa i valori iniziali
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
  const { tr } = useI18n();
  const [url, setUrl] = useState(initialSaved ?? "");
  const [saved, setSaved] = useState(initialSaved ?? "");
  const busy = useRef(false);
  const editRevision = useRef(0);
  const [status, setStatus] = useState<SettingsStatusJson>(initialStatus);
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setFeedback(null);
    try {
      const submitted = url;
      const payload = await saveNorishUrl(submitted);
      setStatus(payload.status);
      setSaved(payload.saved ?? "");
      setUrl(current => current === submitted ? payload.saved ?? "" : current);
      setFeedback({ text: feedbackMessage({ ok: true, status: payload.status, hostChanged: payload.hostChanged }), ok: true });
    } catch (error) {
      setFeedback({
        text: error instanceof Error ? error.message : tr("Errore durante il salvataggio"),
        ok: false,
      });
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  async function handleClear() {
    if (busy.current) return;
    const submittedRevision = editRevision.current;
    busy.current = true;
    setSaving(true);
    setFeedback(null);
    try {
      const payload = await clearNorishUrl();
      setStatus(payload.status);
      setUrl(current => editRevision.current === submittedRevision ? "" : current);
      setSaved("");
      setFeedback({ text: feedbackMessage({ ok: true, status: payload.status, hostChanged: payload.hostChanged }), ok: true });
    } catch (error) {
      setFeedback({
        text: error instanceof Error ? error.message : tr("Errore durante la cancellazione"),
        ok: false,
      });
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="norish-url-heading" className="max-w-2xl norish-url-card">
      <h2 id="norish-url-heading" className="text-lg font-semibold">
        Norish URL
      </h2>
      <p className="mt-1 text-sm opacity-80">{tr("Indirizzo del tuo server Norish.")}{" "}
        <span data-testid="norish-source">{tr(SOURCE_LABEL[status.source] ?? "Norish non configurato")}</span>
      </p>
      <p className="mt-1 text-sm" data-testid="norish-state">
        {status.enabled ? tr("Norish configurato") : tr("Norish non configurato")}
      </p>
      <form onSubmit={handleSave} className="mt-4 flex flex-col gap-3">
        {url !== saved && <p>{tr("Modifiche non salvate")}</p>}
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
          onChange={(e) => { editRevision.current++; setUrl(e.target.value); }}
          className="rounded-md border border-cyber-border bg-cyber-surface px-3 py-2 text-sm"
        />
        <p className="text-xs opacity-70">{tr("Lascia il campo vuoto per usare l'eventuale impostazione da file .env.")}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            aria-disabled={saving}
            style={{ minHeight: 44 }}
            className="rounded-md border border-cyber-border px-4 py-2 text-sm hover:bg-cyber-surface disabled:opacity-50"
          >{tr("Salva Norish")}</button>
          <button
            type="button"
            onClick={handleClear}
            aria-disabled={saving}
            style={{ minHeight: 44 }}
            className="rounded-md border border-cyber-border px-4 py-2 text-sm hover:bg-cyber-surface disabled:opacity-50"
          >{tr("Cancella")}</button>
        </div>
        {feedback && (
          <p role={feedback.ok ? "status" : "alert"} className={`text-sm ${feedback.ok ? "text-emerald-400" : "text-red-400"}`}>
            {tr(feedback.text)}
          </p>
        )}
      </form>
    </section>
  );
}

export default SettingsNorishCard;
