import { SettingsNorishCard } from "@/components/settings/settings-norish-card";
import { SettingsAiCard } from "@/components/settings/settings-ai-card";
import { SettingsAccessNotice } from "@/components/settings/settings-access-notice";
import type { settingsPageProps } from "@/server/services/settings/page-data";

/** Shared production rendering boundary; the server alone determines access. */
export function SettingsContent(props: Awaited<ReturnType<typeof settingsPageProps>>) {
  return <main className="min-h-dvh p-6">
    <h1 className="text-2xl font-bold">Impostazioni</h1>
    <div className="mt-6">{"access" in props ? <SettingsAccessNotice /> : <>
      <SettingsNorishCard {...props} />
      <SettingsAiCard />
    </>}</div>
  </main>;
}
