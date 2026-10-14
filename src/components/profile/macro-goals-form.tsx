"use client";
import { useState, type FormEvent } from "react";
import type { ProfileData } from "@/server/services/profile/http";
import { defaultMacroSettings, goalSources, macroGoals, macroPercentages, type MacroSettings } from "@/lib/goal-targets";
import { NeonSwitch } from "@/components/neon-switch";
const numberFormat = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });
export function MacroGoalsForm({ profile, onSaved }: { profile: ProfileData | null; onSaved: (profile: ProfileData) => void }) {
  const [settings, setSettings] = useState<MacroSettings>(profile?.macroSettings ?? defaultMacroSettings);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const target = profile?.targetSource === "manual" ? profile.manualTargetKcal ?? null : profile?.calculatedTargetKcal ?? null;
  const adult = !profile || new Date().getUTCFullYear() - profile.birthYear >= 18;
  const preview = macroGoals(adult ? target : null, settings, profile?.goal, profile?.activityLevel, profile?.weightKg);
  const suggested = macroPercentages({ ...settings, mode: "auto" }, profile?.goal, profile?.activityLevel, profile?.weightKg, target);
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError(""); setMessage("");
    try { const response = await fetch("/api/v1/profile/macros", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) }); const data = await response.json(); if (!response.ok) { setError(response.status === 401 ? "Accedi di nuovo per salvare." : data.error || "Salvataggio non riuscito."); return; } onSaved(data.profile); setMessage("Obiettivi macro salvati. Li ritrovi nel diario e nella dashboard."); }
    catch { setError("Connessione non disponibile. Le modifiche sono conservate."); } finally { setBusy(false); }
  }
  return <form onSubmit={save} className="profile-page">
    <h2>La tua ripartizione energetica<span className="title-punctuation">.</span></h2>
    <p className="form-help">Distribuisci le calorie giornaliere tra carboidrati, proteine e grassi. Per ogni quota vedi anche la quantità corrispondente in grammi.</p>
    <fieldset disabled={busy} className="profile-panel">
      <legend>Obiettivi macro</legend>
      <div className="settings-toggle-heading"><h3>Suggerimento automatico</h3><NeonSwitch label="Suggerimento automatico macro" checked={settings.mode === "auto"} onChange={checked => { setSettings(v => ({ ...v, mode: checked ? "auto" : "custom", carbs: suggested.carbs, protein: suggested.protein, fat: suggested.fat })); setMessage(""); }} /></div>
      <label>Stile di vita e allenamento<select value={settings.style} onChange={e => { setSettings(v => ({ ...v, style: e.target.value as MacroSettings["style"] })); setMessage(""); }}><option value="balanced">Vita quotidiana / equilibrato</option><option value="strength">Allenamento di forza</option><option value="endurance">Attività di resistenza</option></select></label>
      <p className="form-help">{settings.mode === "auto" ? `Punto di partenza: ${suggested.label}. Il suggerimento tiene conto di peso, attività, obiettivo e kcal salvati.` : "Imposta le percentuali delle calorie: la somma deve essere 100%."}</p>
      {preview && <p className="form-help">Ripartizione del tuo obiettivo di <strong>{numberFormat.format(preview.kcal)} kcal / giorno</strong>.</p>}
      <div className="macro-goal-preview">{(["carbs", "protein", "fat"] as const).map((key, i) => <article key={key}>
        <span>{["Carboidrati", "Proteine", "Grassi"][i]}</span>
        <div className="macro-goal-share">
          {settings.mode === "custom" ? <label><span className="sr-only">{["Carboidrati", "Proteine", "Grassi"][i]} (%)</span><input type="number" required min={key === "carbs" ? 45 : key === "fat" ? 20 : 10} max={key === "carbs" ? 60 : 35} step="1" value={settings[key]} onChange={e => setSettings(v => ({ ...v, [key]: Number(e.target.value) }))} /></label> : <strong>{suggested[key]}<small>%</small></strong>}
          <span>{settings.mode === "custom" ? "% delle calorie" : "delle calorie"}</span>
        </div>
        <div className="macro-goal-amount">{preview ? <><span>{numberFormat.format(preview.kcal * preview.percentages[key] / 100)} kcal</span><span>{numberFormat.format(preview.grams[key])} g / giorno</span></> : <span>Configura le kcal per vedere i grammi</span>}</div>
      </article>)}</div>
      <p className="form-help macro-calorie-note"><strong>Perché percentuali e grammi sono diversi?</strong><br />Un grammo di carboidrati o proteine apporta 4 kcal; un grammo di grassi ne apporta 9. Per questo una quota maggiore di calorie dai grassi può corrispondere a meno grammi.</p>
      {settings.mode === "custom" && <p className="form-help">Totale: {settings.carbs + settings.protein + settings.fat}% delle calorie · intervalli dell’app: carboidrati 45–60%, grassi 20–35%, proteine 10–35%.</p>}
      {preview && profile && <p className="form-help">Proteine: {numberFormat.format(preview.grams.protein / profile.weightKg)} g/kg del peso registrato.</p>}
      {!adult && <p className="form-help">I suggerimenti macro sono previsti per adulti; per i minori serve un percorso personalizzato.</p>}
      {!profile && <p className="form-help">Salva prima i dati nella tab Obiettivo.</p>}
      {error && <p role="alert" className="profile-error">{error}</p>}
      <p role="status">{message}</p><button type="submit" className="profile-save" disabled={busy || !profile || !adult}>Salva obiettivi macro</button>
    </fieldset>
    <details className="profile-panel goal-references"><summary>Come sono scelti i suggerimenti</summary><p>I preset sono punti di partenza dell’app, non percentuali cliniche prescritte dalle fonti. EFSA indica 45–60% dell’energia dai carboidrati e 20–35% dai grassi. OMS indica che il 10–15% di proteine è generalmente sufficiente per adulti di peso sano; le esigenze sportive possono essere maggiori.</p><p>EFSA esprime il riferimento proteico anche in peso: 0,83 g/kg per adulti sani. Per chi si allena, ISSN riporta 1,4–2 g/kg; per la perdita di peso la letteratura studia spesso 1,2–1,6 g/kg. Il suggerimento parte da un riferimento in g/kg, convertito in percentuale, e mantiene carboidrati e grassi negli intervalli. Per Vita attiva usa 1–1,2 g/kg come punto di partenza del software. Gli intervalli possono limitare il risultato: controlla anche i grammi per kg e personalizza con un professionista.</p><div className="goal-source-links"><a href={goalSources.who} target="_blank" rel="noreferrer">OMS ↗</a><a href={goalSources.carbs} target="_blank" rel="noreferrer">EFSA carboidrati ↗</a><a href={goalSources.fat} target="_blank" rel="noreferrer">EFSA grassi ↗</a><a href={goalSources.protein} target="_blank" rel="noreferrer">EFSA proteine ↗</a><a href={goalSources.sport} target="_blank" rel="noreferrer">ISSN sport ↗</a><a href={goalSources.lossProtein} target="_blank" rel="noreferrer">Proteine e perdita di peso ↗</a><a href={goalSources.amdr} target="_blank" rel="noreferrer">NASEM / AMDR ↗</a></div></details>
  </form>;
}
