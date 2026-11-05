"use client";
import { useI18n } from "@/components/ui-preferences-provider";
import { useEffect, useRef, useState } from "react";

type CloudProvider = "openai" | "anthropic";
type Status = { configured: boolean; stored: boolean; urlConfigured?: boolean; source?: "ui" | "env" | "unset" };
export type AiKeyStatus = { keys: { openai: boolean; anthropic: boolean; ollama: boolean }; keySources?: { openai: "ui" | "env" | "unset"; anthropic: "ui" | "env" | "unset" } };
type Props = { scope: "norish"; provider?: never; onAiChanged?: never } | { scope: "ai"; provider: CloudProvider; onAiChanged?: (status: AiKeyStatus) => void };

/** Write-only password field: status reads never populate a saved secret. */
export function SettingsCredentialEditor({ scope, provider, onAiChanged }: Props) {
  const { tr } = useI18n();
  const endpoint = `/api/v1/settings/${scope === "norish" ? "norish-key" : "ai-key"}`;
  const label = scope === "norish" ? "Norish" : provider === "openai" ? "OpenAI" : "Anthropic";
  const [status, setStatus] = useState<Status | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const inFlight = useRef(false);
  const revision = useRef(0);
  const parse = (data: Status | AiKeyStatus): Status => scope === "norish" ? data as Status : {
    configured: !!(data as AiKeyStatus).keys[provider!],
    stored: (data as AiKeyStatus).keySources?.[provider!] === "ui",
    source: (data as AiKeyStatus).keySources?.[provider!] ?? ((data as AiKeyStatus).keys[provider!] ? "env" : "unset"),
  };
  useEffect(() => {
    const controller = new AbortController();
    const started = revision.current;
    fetch(endpoint, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(data => { if (!controller.signal.aborted && started === revision.current) setStatus(scope === "norish" ? data : { configured: !!data.keys[provider!], stored: data.keySources?.[provider!] === "ui", source: data.keySources?.[provider!] ?? (data.keys[provider!] ? "env" : "unset") }); })
      .catch(() => { if (!controller.signal.aborted && started === revision.current) setError(tr("Stato della chiave non disponibile. Riprova ricaricando la pagina.")); });
    return () => controller.abort();
  }, [endpoint, provider, scope, tr]);

  async function mutate(method: "PUT" | "DELETE") {
    if (inFlight.current) return;
    const submitted = draft;
    revision.current++; inFlight.current = true; setSaving(true); setError(""); setFeedback("");
    try {
      const payload = { ...(scope === "ai" ? { provider } : {}), ...(method === "PUT" ? { apiKey: submitted } : {}) };
      const response = await fetch(endpoint, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...(method === "PUT" || scope === "ai" ? { body: JSON.stringify(payload) } : {}) });
      if (!response.ok) { setError(tr(response.status === 400 ? tr("Inserisci una chiave valida, senza spazi interni, e riprova.") : response.status === 401 ? tr("Accedi di nuovo per aggiornare la chiave.") : response.status === 403 ? tr("Non hai i permessi per modificare questa chiave.") : tr("Aggiornamento non verificato. Ricarica lo stato prima di riprovare."))); return; }
      const data = await response.json();
      setStatus(parse(data));
      if (scope === "ai") onAiChanged?.(data);
      setDraft(current => current === submitted ? "" : current);
      setFeedback(tr(method === "PUT" ? tr("Chiave {0} salvata.", { "0": label }) : tr("Chiave {0} rimossa dalle impostazioni.", { "0": label })));
    } catch { setError(tr("Connessione non disponibile. Riprova.")); }
    finally { inFlight.current = false; setSaving(false); }
  }

  return <section className={scope === "norish" ? "editor-panel personal-norish-card" : "credential-editor"} aria-label={tr("Chiave {0}", { "0": label })}>
    {scope === "norish" ? <><h2>{tr("Il tuo account Norish")}</h2><p className="form-help">{tr("La tua chiave collega soltanto il tuo diario. Ogni utente configura il proprio account Norish.")}</p></> : <h3>{tr("Chiave API ")}{label}</h3>}
    {status && <p className="credential-status">{status.configured ? tr("Chiave {0} configurata{1}.", { "0": label, "1": status.source === "env" ? tr(" dall’ambiente") : "" }) : status.stored ? tr("Chiave salvata non utilizzabile: sostituiscila o rimuovila.") : tr("Chiave {0} non configurata.", { "0": label })}</p>}
    {scope === "norish" && status?.urlConfigured === false && <p className="form-help">{tr("Il server Norish non è configurato. Chiedi all’amministratore di impostarne l’URL.")}</p>}
    <form onSubmit={event => { event.preventDefault(); void mutate("PUT"); }} aria-busy={saving}>
      <label>{tr("Chiave API ")}{label}<input name={`${scope}-${provider ?? "personal"}-api-key`} type="password" autoComplete="new-password" spellCheck={false} maxLength={4096} required value={draft} disabled={saving} placeholder={tr("Incolla una nuova chiave")} onChange={event => { setDraft(event.target.value); setFeedback(""); }} /></label>
      <p className="form-help">{tr("La chiave è cifrata sul server. Il valore salvato non viene mostrato: inserisci una nuova chiave per sostituirla.")}</p>
      {scope === "ai" && <p className="form-help">{tr("La chiave nelle impostazioni ha precedenza sull’ambiente. Rimuoverla ripristina l’eventuale chiave dell’ambiente.")}</p>}
      <div className="credential-actions"><button type="submit" className="primary-btn" disabled={saving || !draft.trim()}>{tr("Salva chiave ")}{label}</button><button type="button" className="secondary-btn" disabled={saving || !status?.stored} onClick={() => { void mutate("DELETE"); }}>{tr("Rimuovi chiave ")}{label}</button></div>
    </form>
    {saving && <p role="status">{tr("Aggiornamento chiave in corso…")}</p>}
    {feedback && <p role="status">{tr(feedback)}</p>}{error && <p role="alert">{tr(error)}</p>}
  </section>;
}
