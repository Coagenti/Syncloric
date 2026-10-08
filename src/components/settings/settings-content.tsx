"use client";
import { useEffect, useRef, useState } from "react";
import { SettingsNorishCard } from "@/components/settings/settings-norish-card";
import { SettingsAiCard } from "@/components/settings/settings-ai-card";
import { SettingsBarcodeCard } from "@/components/settings/settings-barcode-card";
import { SettingsUsersCard } from "@/components/settings/settings-users-card";
import { SettingsAccessNotice } from "@/components/settings/settings-access-notice";
import type { settingsPageProps } from "@/server/services/settings/page-data";
import { AppShell } from "@/components/app-shell";
import { SettingsCredentialEditor } from "@/components/settings/settings-credential-editor";
import { SettingsAppearanceCard } from "@/components/settings/settings-appearance-card";
import { SettingsInstallCard } from "@/components/settings/settings-install-card";
import { SettingsExportCard } from "@/components/settings/settings-export-card";
import { SettingsHouseholdCard } from "@/components/settings/settings-household-card";
import { UiIcon } from "@/components/ui-icon";

const sections = [
  { id: "generali", label: "Generali", icon: "settings", admin: false },
  { id: "nucleo", label: "Nucleo", icon: "family", admin: false },
  { id: "norish", label: "Norish", icon: "sync", admin: false },
  { id: "dati", label: "I miei dati", icon: "diary", admin: false },
  { id: "scansione", label: "Scansione", icon: "scan", admin: true },
  { id: "utenti", label: "Utenti", icon: "family", admin: true },
] as const;
type Section = typeof sections[number]["id"];

/** Server decides initial access. A self-demotion replaces all controls without a flash. */
export function SettingsContent(props: Awaited<ReturnType<typeof settingsPageProps>>) {
  const [lostAccess, setLostAccess] = useState(false);
  const [selected, setSelected] = useState<Section>("generali");
  const [visited, setVisited] = useState<Section[]>(["generali"]);
  const isAdmin = !("access" in props) && !lostAccess;
  const tabs = sections.filter(section => !section.admin || isAdmin);
  const active = tabs.some(tab => tab.id === selected) ? selected : "generali";
  const tabRefs = useRef<Partial<Record<Section, HTMLButtonElement | null>>>({});
  const notice = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (lostAccess) notice.current?.focus(); }, [lostAccess]);
  useEffect(() => {
    const readHash = () => {
      const candidate = window.location.hash.slice(1);
      const section = sections.find(section => section.id === candidate && (!section.admin || isAdmin))?.id ?? "generali";
      queueMicrotask(() => {
        setSelected(section); setVisited(current => current.includes(section) ? current : [...current, section]);
        tabRefs.current[section]?.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    };
    readHash(); window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, [isAdmin]);
  function select(section: Section, focus = false) {
    setSelected(section); setVisited(current => current.includes(section) ? current : [...current, section]);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${section}`);
    if (focus) tabRefs.current[section]?.focus({ preventScroll: true });
    tabRefs.current[section]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function accessLost() { select("generali"); setLostAccess(true); }
  return <AppShell view="settings"><section className="view-stack settings-page">
    <div className="eyebrow"><span className="signal-dot" /> IL TUO SPAZIO / IMPOSTAZIONI</div>
    <div className="view-title"><div><h1>Impostazioni<span className="title-punctuation">.</span></h1>
    <p>Gestisci app, nucleo e dati personali. Gli amministratori gestiscono anche la configurazione globale dell’istanza.</p></div></div>
    {lostAccess && <div ref={notice} tabIndex={-1}><SettingsAccessNotice /></div>}
    <div className="settings-workspace">
      <div className="settings-tab-bar" role="tablist" aria-label="Sezioni impostazioni">{tabs.map((tab, index) => <button key={tab.id} ref={element => { tabRefs.current[tab.id] = element; }} type="button" role="tab" className={`settings-tab ${active === tab.id ? "is-active" : ""}`} id={`settings-tab-${tab.id}`} aria-selected={active === tab.id} aria-controls={`settings-panel-${tab.id}`} tabIndex={active === tab.id ? 0 : -1} onClick={() => select(tab.id)} onKeyDown={event => {
        let next: number;
        if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
        else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = tabs.length - 1;
        else return;
        event.preventDefault(); select(tabs[next].id, true);
      }}><UiIcon name={tab.icon} /><span>{tab.label}</span>{tab.admin && <small aria-hidden="true">ADMIN</small>}</button>)}</div>
      {tabs.map(tab => <div key={tab.id} role="tabpanel" id={`settings-panel-${tab.id}`} aria-labelledby={`settings-tab-${tab.id}`} className="settings-tab-panel" tabIndex={0} hidden={active !== tab.id}>
        {visited.includes(tab.id) && <div className="settings-grid">
          {tab.id === "generali" && <><SettingsAppearanceCard /><SettingsInstallCard /></>}
          {tab.id === "nucleo" && <SettingsHouseholdCard />}
          {tab.id === "norish" && <><SettingsCredentialEditor scope="norish" />{isAdmin && !("access" in props) ? <SettingsNorishCard {...props} /> : <SettingsAccessNotice />}</>}
          {tab.id === "dati" && <SettingsExportCard />}
          {tab.id === "scansione" && isAdmin && <><SettingsAiCard /><SettingsBarcodeCard /></>}
          {tab.id === "utenti" && isAdmin && <SettingsUsersCard onAccessLost={accessLost} />}
        </div>}
      </div>)}
    </div>
  </section></AppShell>;
}
