"use client";
import { useEffect, useRef, useState } from "react";
import { SettingsNorishCard } from "@/components/settings/settings-norish-card";
import { SettingsAiCard } from "@/components/settings/settings-ai-card";
import { SettingsBarcodeCard } from "@/components/settings/settings-barcode-card";
import { SettingsUsersCard } from "@/components/settings/settings-users-card";
import { SettingsAccessNotice } from "@/components/settings/settings-access-notice";
import type { settingsPageProps } from "@/server/services/settings/page-data";

/** Server decides initial access. A self-demotion replaces all controls without a flash. */
export function SettingsContent(props: Awaited<ReturnType<typeof settingsPageProps>>) {
  const [lostAccess, setLostAccess] = useState(false);
  const notice = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (lostAccess) notice.current?.focus(); }, [lostAccess]);
  return <main className="min-h-dvh p-4 sm:p-6">
    <h1 className="text-lg sm:text-2xl font-bold">Impostazioni</h1>
    <p className="max-w-2xl mt-2">Configurazione globale dell’istanza. Le modifiche si applicano a tutti gli utenti.</p>
    <div className="mt-6">{"access" in props || lostAccess ? <div ref={notice} tabIndex={-1}><SettingsAccessNotice /></div> : <>
      <SettingsNorishCard {...props} />
      <SettingsAiCard />
      <SettingsBarcodeCard />
      <SettingsUsersCard onAccessLost={() => setLostAccess(true)} />
    </>}</div>
  </main>;
}
