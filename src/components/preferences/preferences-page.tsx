"use client";
import { useState, type CSSProperties } from "react";
import { AppShell } from "@/components/app-shell";
import { UiIcon } from "@/components/ui-icon";
import { SettingsAppearanceCard } from "@/components/settings/settings-appearance-card";
import { useI18n, useUiPreferences } from "@/components/ui-preferences-provider";
import { locales, type Theme } from "@/lib/ui-preferences";

const themeOptions: { id: Theme; title: string; description: string; background: string; primary: string; secondary: string }[] = [
  { id: "cyberpunk", title: "Cyberpunk", description: "HUD tecnico, cornici angolari e accenti ciano/giallo neon.", background: "#090d14", primary: "#00f0ff", secondary: "#fcee0a" },
  { id: "arasaka-red", title: "Arasaka Red", description: "Nero ossidiana, rosso segnale e geometrie giapponesi.", background: "#0b090b", primary: "#ff6974", secondary: "#ff4052" },
  { id: "synthwave", title: "Synthwave", description: "Viola, magenta e atmosfera notturna.", background: "#110d1c", primary: "#bd9aff", secondary: "#ff7cce" },
  { id: "terminal", title: "Terminal", description: "Verde fosforo e ambra su fondo scuro.", background: "#08110d", primary: "#9cff57", secondary: "#ffd166" },
];
export function PreferencesPage({ section }: { section: "themes" | "language" }) {
  const { tr } = useI18n();
  const preferences = useUiPreferences(); const [saved, setSaved] = useState(false);
  const busy = preferences.loading || preferences.saving;
  return <AppShell view={section}><section className="view-stack preferences-page">
    <div className="eyebrow"><span className="signal-dot" />{tr("IL TUO SPAZIO")} / {section === "themes" ? tr("ASPETTO") : tr("LINGUA")}</div>
    <div className="view-title"><div><h1>{section === "themes" ? tr("Temi") : tr("Lingua")}<span className="title-punctuation">.</span></h1><p>{tr("Le preferenze sono personali e sincronizzate sui tuoi dispositivi.")}</p></div></div>
    <fieldset className="preferences-panel" disabled={busy} aria-busy={busy}>
      <legend>{section === "themes" ? tr("Scegli il tuo tema") : tr("Lingua dell’app")}</legend>
      {section === "themes" ? <div className="theme-options">{themeOptions.map(option => <label key={option.id} className={`theme-option${preferences.theme === option.id ? " is-selected" : ""}`}>
        <input type="radio" name="theme" className="sr-only" value={option.id} checked={preferences.theme === option.id} onChange={async () => { setSaved(false); setSaved(await preferences.update({ theme: option.id })); }} />
        <span className={`theme-preview${option.id === "cyberpunk" ? " theme-preview-hud" : option.id === "arasaka-red" ? " theme-preview-arasaka" : ""}`} aria-hidden="true" style={{ "--preview-bg": option.background, "--preview-primary": option.primary, "--preview-secondary": option.secondary } as CSSProperties}><i className="theme-preview-nav" /><i className="theme-preview-ring" /><span className="theme-preview-bars"><i /><i /><i /></span></span>
        <span className="theme-option-title"><strong>{tr(option.title)}</strong>{preferences.theme === option.id && <UiIcon name="check" />}</span><span className="theme-option-description">{tr(option.description)}</span>
      </label>)}</div> : <div className="language-options">{locales.map(locale => <label key={locale} className={`language-option${preferences.locale === locale ? " is-selected" : ""}`}>
        <input type="radio" className="sr-only" name="locale" value={locale} checked={preferences.locale === locale} onChange={async () => { setSaved(false); setSaved(await preferences.update({ locale })); }} />
        <span className="language-code" aria-hidden="true">{locale.toUpperCase()}</span><span><strong>{locale === "it" ? "Italiano" : "English"}</strong><small>{locale === "it" ? tr("Italiano") : tr("Inglese")}</small></span>{preferences.locale === locale && <UiIcon name="check" />}
      </label>)}</div>}
      <p className="form-help">{tr("Le modifiche vengono salvate automaticamente.")}</p>
    </fieldset>
    {preferences.error && <p role="alert" className="entry-error">{tr(preferences.error)}</p>}
    <p role="status" className="preferences-feedback">{preferences.loading ? tr("Caricamento preferenze…") : preferences.saving ? tr("Salvataggio…") : saved ? tr("Preferenze salvate.") : ""}</p>
    {section === "themes" && <SettingsAppearanceCard />}
  </section></AppShell>;
}
