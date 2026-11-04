"use client";

import { useI18n } from "@/components/ui-preferences-provider";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ProfileData } from "@/server/services/profile/http";
import { goalSources, type GoalCalculation } from "@/lib/goal-targets";
import { NeonSwitch } from "./neon-switch";
import "./profile.css";

type Fields = { sex: string; heightCm: string; weightKg: string; birthYear: string; activityLevel: string; goal: string; targetSource: string; manualTargetKcal: string };
function payload(f: Fields) { return { ...f, heightCm: Number(f.heightCm), weightKg: Number(f.weightKg), birthYear: Number(f.birthYear), manualTargetKcal: f.manualTargetKcal === "" ? null : Number(f.manualTargetKcal) }; }
export function ProfileForm({ initialProfile, onSaved }: { initialProfile: ProfileData | null; onSaved?: (profile: ProfileData) => void }) {
  const { tr, formatDay } = useI18n();
  const [fields, setFields] = useState<Fields>({ sex: initialProfile?.sex ?? "", heightCm: String(initialProfile?.heightCm ?? ""), weightKg: String(initialProfile?.weightKg ?? ""), birthYear: String(initialProfile?.birthYear ?? ""), activityLevel: initialProfile?.activityLevel ?? "", goal: initialProfile?.goal ?? "", targetSource: initialProfile?.targetSource ?? "calculated", manualTargetKcal: String(initialProfile?.manualTargetKcal ?? "") });
  const [preview, setPreview] = useState<number | null>(initialProfile?.calculatedTargetKcal ?? null);
  const [timed, setTimed] = useState(!!initialProfile?.weightGoal);
  const [goalWeight, setGoalWeight] = useState(String(initialProfile?.weightGoal?.targetWeightKg ?? ""));
  const [goalDate, setGoalDate] = useState(initialProfile?.weightGoal?.targetDate ?? (() => { const date = new Date(); date.setUTCMonth(date.getUTCMonth() + 6); return date.toISOString().slice(0, 10); })());
  const [calculation, setCalculation] = useState<GoalCalculation | null>(initialProfile?.calculation ?? null);
  const activeTimeline = timed && fields.goal === "lose" && fields.targetSource === "calculated";
  const profilePayload = () => ({ ...payload(fields), weightGoal: activeTimeline ? { targetWeightKg: Number(goalWeight), targetDate: goalDate } : null });
  const [previewMessage, setPreviewMessage] = useState(tr("Completa i dati per la stima."));
  const [notice, setNotice] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const pendingFocus = useRef<HTMLElement | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    if (saving || !pendingFocus.current) return;
    // Disabled controls can only receive focus after React commits their re-enabling.
    const firstInvalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (firstInvalid) firstInvalid.focus();
    else if (document.activeElement === document.body) pendingFocus.current.focus();
    pendingFocus.current = null;
  }, [saving]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setPreview(null);
      if (!fields.sex || !fields.heightCm || !fields.weightKg || !fields.birthYear || !fields.activityLevel || !fields.goal) { setPreviewMessage(tr("Completa i dati per la stima.")); return; }
      setPreviewMessage(tr("Calcolo in corso…"));
      try {
        // Preview is independent from the manual selection; only the server computes kcal.
        const response = await fetch("/api/v1/profile/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload(fields), weightGoal: activeTimeline ? { targetWeightKg: Number(goalWeight), targetDate: goalDate } : null, targetSource: "calculated" }), signal: controller.signal });
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) { setPreviewMessage(response.status === 401 ? tr("Accedi di nuovo per calcolare la stima.") : tr("Controlla i dati per la stima.")); return; }
        setPreview(result.calculatedTargetKcal); setCalculation(result.calculation ?? null); setPreviewMessage("");
      } catch { if (!controller.signal.aborted) setPreviewMessage(tr("Stima non disponibile. Riprova modificando i dati.")); }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [fields, activeTimeline, goalWeight, goalDate, tr]);
  function update(key: keyof Fields, value: string) {
    setFields(f => ({ ...f, [key]: value })); setNotice(""); setErrors({}); setPreview(null);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    pendingFocus.current = event.currentTarget.contains(document.activeElement)
      ? document.activeElement as HTMLElement : event.currentTarget.querySelector('button[type="submit"]');
    setSaving(true); setNotice(""); setErrors({});
    try {
      const response = await fetch("/api/v1/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profilePayload()) });
      if (!response.ok) {
        if (response.status === 422) {
          const result = await response.json();
          setErrors(result.fields ?? {});
          setNotice(tr("Non è stato possibile salvare. Correggi i campi indicati e riprova."));
        } else {
          setNotice(tr(response.status === 401 ? tr("Sessione scaduta. Accedi di nuovo.")
            : response.status >= 500 ? tr("Servizio temporaneamente non disponibile. I valori sono conservati: riprova il salvataggio.")
            : tr("Salvataggio non consentito. I valori sono conservati: ricarica la pagina o accedi di nuovo prima di riprovare.")));
        }
        return;
      }
      const result = await response.json();
      setPreview(result.profile.calculatedTargetKcal); setCalculation(result.profile.calculation ?? null); onSaved?.(result.profile); setNotice(tr("Modifiche salvate. Il tuo obiettivo è aggiornato."));
    } catch { setNotice(tr("Connessione non riuscita o risposta non leggibile. I valori sono conservati: verifica la rete e riprova il salvataggio.")); }
    finally { inFlight.current = false; setSaving(false); }
  }
  const fieldProps = (key: keyof Fields) => ({ id: `profile-${key}`, value: fields[key], "aria-invalid": !!errors[key], "aria-describedby": errors[key] ? `error-${key}` : undefined, onChange: (e: { target: { value: string } }) => update(key, e.target.value) });
  const error = (key: keyof Fields | "weightGoal") => errors[key] && <span id={`error-${key}`} className="profile-error">{errors[key].map(message => tr(message)).join(" ")}</span>;
  return <section className="profile-page"><h2>{tr("Il tuo obiettivo")}<span className="title-punctuation">.</span></h2><p className="data-note">{tr("Scegli un valore manuale o una stima basata sui tuoi dati. Non è una prescrizione nutrizionale.")}</p>
    <form ref={formRef} onSubmit={save}>
      <fieldset disabled={saving} className="profile-panel"><legend>{tr("I tuoi dati")}</legend><div className="profile-grid">
        <label htmlFor="profile-sex">{tr("Sesso per il calcolo")}<select {...fieldProps("sex")} required><option value="">{tr("Seleziona")}</option><option value="f">{tr("Donna")}</option><option value="m">{tr("Uomo")}</option></select>{error("sex")}</label>
        <label htmlFor="profile-heightCm">{tr("Altezza (cm)")}<input {...fieldProps("heightCm")} required type="number" min="1" step="1" />{error("heightCm")}</label>
        <label htmlFor="profile-weightKg">{tr("Peso (kg)")}<input {...fieldProps("weightKg")} required type="number" min="0.1" max="999.9" step="0.1" />{error("weightKg")}</label>
        <label htmlFor="profile-birthYear">{tr("Anno di nascita")}<input {...fieldProps("birthYear")} required type="number" step="1" />{error("birthYear")}</label>
        <label htmlFor="profile-activityLevel">{tr("Livello di attività")}<select {...fieldProps("activityLevel")} required><option value="">{tr("Seleziona")}</option><option value="sedentary">{tr("Sedentario")}</option><option value="light">{tr("Leggero")}</option><option value="moderate">{tr("Moderato")}</option><option value="active">{tr("Attivo")}</option><option value="very_active">{tr("Molto attivo")}</option></select>{error("activityLevel")}</label>
        <label htmlFor="profile-goal">{tr("Obiettivo")}<select {...fieldProps("goal")} required><option value="">{tr("Seleziona")}</option><option value="lose">{tr("Perdita peso")}</option><option value="maintain">{tr("Mantenimento")}</option><option value="gain">{tr("Massa")}</option></select>{error("goal")}</label>
      </div></fieldset>
      <fieldset disabled={saving} className="profile-panel"><legend>{tr("Target calorico")}</legend>
        <p data-testid="target-preview" className="profile-preview" aria-live="polite">{tr("Stima calcolata: ")}{preview === null ? tr(previewMessage) || tr("Calcolo in corso…") : `${preview} kcal`}</p>
        <p className="data-note">{tr("Mifflin-St Jeor, attività e obiettivo. Arrotondamento a 5 kcal; soglia della stima: 1200 kcal donna / 1500 kcal uomo. Dati validi tra 10 e 100 anni. Una stima non sostituisce il parere di un professionista.")}</p>
        <label className="profile-radio"><input type="radio" name="targetSource" value="calculated" checked={fields.targetSource === "calculated"} onChange={() => update("targetSource", "calculated")} />{tr("Calcolato")}</label>
        <label className="profile-radio"><input type="radio" name="targetSource" value="manual" checked={fields.targetSource === "manual"} onChange={() => update("targetSource", "manual")} />{tr("Manuale")}</label>
        <label htmlFor="profile-manualTargetKcal">{tr("Target manuale (kcal)")}<input {...fieldProps("manualTargetKcal")} type="number" min="1" max="2147483647" step="1" required={fields.targetSource === "manual"} />{error("manualTargetKcal")}</label>
        <p className="data-note">{tr("Il campo manuale è opzionale quando scegli Calcolato. Sarà usato soltanto il target selezionato.")}</p>
      </fieldset>
      {fields.goal === "lose" && fields.targetSource === "calculated" && <fieldset disabled={saving} className="profile-panel timeline-panel"><legend>{tr("Un traguardo nel tempo")}</legend><div className="settings-toggle-heading"><h3>{tr("Obiettivo temporale facoltativo")}</h3><NeonSwitch label={tr("Obiettivo temporale")} checked={timed} onChange={setTimed} /></div><p className="form-help">{tr("Per adulti con sovrappeso: un primo traguardo orientativo è il 5–10% del peso in circa sei mesi. ")}<a href={goalSources.weight} target="_blank" rel="noreferrer">NIH/NIDDK ↗</a></p>{timed && <><div className="profile-grid"><label>{tr("Peso desiderato (kg)")}<input type="number" min="1" max="999.9" step="0.1" required aria-invalid={!!errors.weightGoal} aria-describedby={errors.weightGoal ? "error-weightGoal" : undefined} value={goalWeight} onChange={e => { setGoalWeight(e.target.value); setCalculation(null); setPreview(null); }} /></label><label>{tr("Data obiettivo")}<input type="date" required aria-invalid={!!errors.weightGoal} aria-describedby={errors.weightGoal ? "error-weightGoal" : undefined} value={goalDate} onChange={e => { setGoalDate(e.target.value); setCalculation(null); setPreview(null); }} /></label></div>{preview !== null && calculation && <div className={`goal-estimate ${calculation.status === "limited" || calculation.status === "unavailable" ? "needs-review" : ""}`} aria-live="polite"><div><span>{tr("Mantenimento stimato")}</span><strong>{calculation.maintenanceKcal} <small>kcal</small></strong></div><div><span>{tr("Deficit giornaliero stimato")}</span><strong>{calculation.appliedDeficitKcal} <small>kcal</small></strong></div><p>{tr(calculation.message)}</p>{calculation.suggestedDate && <button type="button" className="secondary-btn" onClick={() => { setGoalDate(calculation.suggestedDate!); setCalculation(null); setPreview(null); }}>{tr("Usa data suggerita · ")}{formatDay(calculation.suggestedDate, { day: "numeric", month: "numeric", year: "numeric" })}</button>}</div>}{error("weightGoal")}<p className="form-help">{tr("Il periodo modifica il deficit, con limiti prudenti dell’app: fino a 500 kcal/giorno e al 20% del mantenimento. La stima approssimata considera il rallentamento del calo di peso e va rivalutata quando aggiorni il peso. ")}<a href={goalSources.dynamics} target="_blank" rel="noreferrer">{tr("Ricerca di Hall e colleghi ↗")}</a></p></>}</fieldset>}
      <p role="status" className="profile-notice">{tr(notice)}</p><button className="profile-save" type="submit" disabled={saving || activeTimeline && (preview === null || calculation?.status === "limited" || calculation?.status === "unavailable")}>{saving ? tr("Salvataggio…") : tr("Salva profilo")}</button>
    </form>
  </section>;
}
