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

/** Server decides initial access. A self-demotion replaces all controls without a flash. */
export function SettingsContent(props: Awaited<ReturnType<typeof settingsPageProps>>) {
  const [lostAccess, setLostAccess] = useState(false);
  const notice = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (lostAccess) notice.current?.focus(); }, [lostAccess]);
  return <AppShell view="settings"><section className="view-stack settings-page">
    <div className="eyebrow"><span className="signal-dot" /> IL TUO SPAZIO / IMPOSTAZIONI</div>
    <div className="view-title"><div><h1>Impostazioni<span className="title-punctuation">.</span></h1>
    <p>Collega il tuo account Norish. Gli amministratori gestiscono anche la configurazione globale dell’istanza.</p></div></div>
    <div className="settings-grid"><SettingsInstallCard /><SettingsAppearanceCard /><SettingsExportCard /><SettingsCredentialEditor scope="norish" />{"access" in props || lostAccess ? <div ref={notice} tabIndex={-1}><SettingsAccessNotice /></div> : <>
      <SettingsNorishCard {...props} />
      <SettingsAiCard />
      <SettingsBarcodeCard />
      <SettingsUsersCard onAccessLost={() => setLostAccess(true)} />
    </>}</div>
  </section></AppShell>;
}
