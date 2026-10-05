"use client";
import { useEffect, useRef, useState } from "react";
import { SettingsCredentialEditor, type AiKeyStatus } from "@/components/settings/settings-credential-editor";
type Config = { enabled: boolean; provider: "openai" | "anthropic" | "ollama" | null; ready: boolean } & AiKeyStatus;
export function SettingsAiCard() {
  const [config, setConfig] = useState<Config | null>(null);
  const [saved, setSaved] = useState<Config | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [feedback, setFeedback] = useState(""); const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/settings/ai", { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("failed"); const data = await response.json() as Config;
      if (!controller.signal.aborted) { setConfig(data); setSaved(data); }
    }).catch(() => { if (!controller.signal.aborted) setError("Impostazioni AI non disponibili. Richiede amministratore."); });
    return () => controller.abort();
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!config || busy.current) return;
    busy.current = true; setSaving(true); setFeedback(""); setError("");
    try {
      const response = await fetch("/api/v1/settings/ai", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: config.enabled, provider: config.provider }) });
      if (response.status >= 400 && response.status < 500) { setError("Salvataggio non riuscito. Seleziona un provider prima di abilitare AI e verifica i permessi. Le modifiche non sono state applicate. Riprova."); return; }
      if (!response.ok) throw new Error("uncertain");
      const data = await response.json() as Config;
      if (typeof data.enabled !== "boolean" || !data.keys) throw new Error("uncertain");
      // Keep any newer draft and its focus while updating only the saved baseline.
      setSaved(data); setConfig(current => current ? { ...current, keys: data.keys, keySources: data.keySources } : current); setFeedback("Impostazioni AI salvate.");
    } catch { setError("Non è stato possibile verificare il salvataggio. Ricarica lo stato prima di riprovare."); }
    finally { busy.current = false; setSaving(false); }
  }
  const dirty = config && saved && (config.enabled !== saved.enabled || config.provider !== saved.provider);
  return <section aria-labelledby="ai-settings-title" className="editor-panel ai-settings-card max-w-2xl mt-6">
    <h2 id="ai-settings-title" className="text-lg font-semibold">Scansione etichetta con AI</h2>
    <p className="form-help">Provider e chiavi AI sono globali per questa istanza e configurabili soltanto dagli amministratori.</p>
    {config && <form onSubmit={save} aria-busy={saving}>
      <fieldset>
        <label>Provider AI<select value={config.provider ?? ""} onChange={event => { setFeedback(""); setConfig({ ...config, provider: event.target.value as Config["provider"] || null, enabled: event.target.value ? config.enabled : false }); }}>
          <option value="">Seleziona un provider</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="ollama">Ollama</option>
        </select></label>
        <label className="ai-enabled-toggle"><input type="checkbox" checked={config.enabled} disabled={!config.provider} onChange={event => { setFeedback(""); setConfig({ ...config, enabled: event.target.checked }); }} /> Abilita scansione AI</label>
        <p>{!config.provider ? "AI disabilitata: scegli esplicitamente un provider." : config.provider === "ollama" ? "Ollama self-hosted: nessuna chiave richiesta. La raggiungibilità si verifica alla scansione." : config.keys[config.provider] ? "Chiave configurata" : "Chiave non configurata: scansione non disponibile."}</p>
        <p className="form-help">OpenAI e Anthropic ricevono la foto quando l’utente richiede l’estrazione. Ollama riceve la foto sul server configurato. Nessuna foto conservata da Syncloric; verifica le politiche del provider.</p>
        {dirty && <p>Modifiche non salvate</p>}
        <button type="submit" className="primary-btn" aria-disabled={saving}>Salva AI</button>
      </fieldset>
    </form>}
    {config && (config.provider === "openai" || config.provider === "anthropic") && <SettingsCredentialEditor key={config.provider} scope="ai" provider={config.provider} onAiChanged={data => {
      setConfig(current => current ? { ...current, keys: data.keys, keySources: data.keySources } : current);
      setSaved(current => current ? { ...current, keys: data.keys, keySources: data.keySources } : current);
    }} />}
    {saving && <p role="status">Salvataggio AI in corso…</p>}
    {!config && !error && <p role="status">Caricamento impostazioni AI…</p>}
    {feedback && <p role="status">{feedback}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
