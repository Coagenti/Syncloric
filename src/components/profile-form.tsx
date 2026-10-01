"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { ProfileData } from "@/server/services/profile/http";
import "./profile.css";

type Fields = { sex: string; heightCm: string; weightKg: string; birthYear: string; activityLevel: string; goal: string; targetSource: string; manualTargetKcal: string };
function payload(f: Fields) { return { ...f, heightCm: Number(f.heightCm), weightKg: Number(f.weightKg), birthYear: Number(f.birthYear), manualTargetKcal: f.manualTargetKcal === "" ? null : Number(f.manualTargetKcal) }; }
export function ProfileForm({ initialProfile }: { initialProfile: ProfileData | null }) {
  const [fields, setFields] = useState<Fields>({ sex: initialProfile?.sex ?? "", heightCm: String(initialProfile?.heightCm ?? ""), weightKg: String(initialProfile?.weightKg ?? ""), birthYear: String(initialProfile?.birthYear ?? ""), activityLevel: initialProfile?.activityLevel ?? "", goal: initialProfile?.goal ?? "", targetSource: initialProfile?.targetSource ?? "calculated", manualTargetKcal: String(initialProfile?.manualTargetKcal ?? "") });
  const [preview, setPreview] = useState<number | null>(initialProfile?.calculatedTargetKcal ?? null);
  const [previewMessage, setPreviewMessage] = useState("Completa i dati per la stima.");
  const [notice, setNotice] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setPreview(null);
      if (!fields.sex || !fields.heightCm || !fields.weightKg || !fields.birthYear || !fields.activityLevel || !fields.goal) { setPreviewMessage("Completa i dati per la stima."); return; }
      setPreviewMessage("Calcolo in corso…");
      try {
        // Preview is independent from the manual selection; only the server computes kcal.
        const response = await fetch("/api/v1/profile/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload(fields), targetSource: "calculated" }), signal: controller.signal });
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) { setPreviewMessage(response.status === 401 ? "Accedi di nuovo per calcolare la stima." : "Controlla i dati per la stima."); return; }
        setPreview(result.calculatedTargetKcal); setPreviewMessage("");
      } catch { if (!controller.signal.aborted) setPreviewMessage("Stima non disponibile. Riprova modificando i dati."); }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [fields]);
  function update(key: keyof Fields, value: string) {
    setFields(f => ({ ...f, [key]: value })); setNotice(""); setErrors({}); setPreview(null);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setNotice(""); setErrors({});
    try {
      const response = await fetch("/api/v1/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload(fields)) });
      const result = await response.json();
      if (!response.ok) { setErrors(result.fields ?? {}); setNotice(response.status === 401 ? "Sessione scaduta. Accedi di nuovo." : "Non è stato possibile salvare. Controlla i dati e riprova."); return; }
      setPreview(result.profile.calculatedTargetKcal); setNotice("Modifiche salvate. Il tuo obiettivo è aggiornato.");
    } catch { setNotice("Non è stato possibile salvare. Riprova."); }
    finally { setSaving(false); }
  }
  const fieldProps = (key: keyof Fields) => ({ id: `profile-${key}`, value: fields[key], "aria-invalid": !!errors[key], "aria-describedby": errors[key] ? `error-${key}` : undefined, onChange: (e: { target: { value: string } }) => update(key, e.target.value) });
  const error = (key: keyof Fields) => errors[key] && <span id={`error-${key}`} className="profile-error">Controlla questo campo.</span>;
  return <main className="profile-page"><a className="profile-back" href="/dashboard">Torna alla dashboard</a><div className="eyebrow">SYNCLORIC / PROFILO</div><h1>Il tuo obiettivo<span className="title-punctuation">.</span></h1><p className="data-note">Scegli un valore manuale o una stima basata sui tuoi dati. Non è una prescrizione nutrizionale.</p>
    <form onSubmit={save}>
      <fieldset disabled={saving} className="profile-panel"><legend>I tuoi dati</legend><div className="profile-grid">
        <label htmlFor="profile-sex">Sesso per il calcolo<select {...fieldProps("sex")} required><option value="">Seleziona</option><option value="f">Donna</option><option value="m">Uomo</option></select>{error("sex")}</label>
        <label htmlFor="profile-heightCm">Altezza (cm)<input {...fieldProps("heightCm")} required type="number" min="1" step="1" />{error("heightCm")}</label>
        <label htmlFor="profile-weightKg">Peso (kg)<input {...fieldProps("weightKg")} required type="number" min="0.1" max="999.9" step="0.1" />{error("weightKg")}</label>
        <label htmlFor="profile-birthYear">Anno di nascita<input {...fieldProps("birthYear")} required type="number" step="1" />{error("birthYear")}</label>
        <label htmlFor="profile-activityLevel">Livello di attività<select {...fieldProps("activityLevel")} required><option value="">Seleziona</option><option value="sedentary">Sedentario</option><option value="light">Leggero</option><option value="moderate">Moderato</option><option value="active">Attivo</option><option value="very_active">Molto attivo</option></select>{error("activityLevel")}</label>
        <label htmlFor="profile-goal">Obiettivo<select {...fieldProps("goal")} required><option value="">Seleziona</option><option value="lose">Perdita peso</option><option value="maintain">Mantenimento</option><option value="gain">Massa</option></select>{error("goal")}</label>
      </div></fieldset>
      <fieldset disabled={saving} className="profile-panel"><legend>Target calorico</legend>
        <p data-testid="target-preview" className="profile-preview" aria-live="polite">Stima calcolata: {preview === null ? previewMessage || "Calcolo in corso…" : `${preview} kcal`}</p>
        <p className="data-note">Mifflin-St Jeor, attività e obiettivo. Arrotondamento a 5 kcal; soglia della stima: 1200 kcal donna / 1500 kcal uomo. Dati validi tra 10 e 100 anni. Una stima non sostituisce il parere di un professionista.</p>
        <label className="profile-radio"><input type="radio" name="targetSource" value="calculated" checked={fields.targetSource === "calculated"} onChange={() => update("targetSource", "calculated")} />Calcolato</label>
        <label className="profile-radio"><input type="radio" name="targetSource" value="manual" checked={fields.targetSource === "manual"} onChange={() => update("targetSource", "manual")} />Manuale</label>
        <label htmlFor="profile-manualTargetKcal">Target manuale (kcal)<input {...fieldProps("manualTargetKcal")} type="number" min="1" max="2147483647" step="1" required={fields.targetSource === "manual"} />{error("manualTargetKcal")}</label>
        <p className="data-note">Il campo manuale è opzionale quando scegli Calcolato. Sarà usato soltanto il target selezionato.</p>
      </fieldset>
      <p role="status" className="profile-notice">{notice}</p><button className="profile-save" type="submit" disabled={saving}>{saving ? "Salvataggio…" : "Salva profilo"}</button>
    </form>
  </main>;
}
