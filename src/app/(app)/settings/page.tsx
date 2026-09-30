import type { Metadata } from "next";
import { SettingsNorishCard } from "@/components/settings/settings-norish-card";
import { settingsPageProps } from "@/server/services/settings/page-data";

export const metadata: Metadata = { title: "Impostazioni — Syncloric" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const props = await settingsPageProps();
  return (
    <main className="min-h-dvh p-6">
      <h1 className="text-2xl font-bold">Impostazioni</h1>
      <div className="mt-6">
        <SettingsNorishCard {...props} />
      </div>
    </main>
  );
}
