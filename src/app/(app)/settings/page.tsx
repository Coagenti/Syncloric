import type { Metadata } from "next";
import { SettingsContent } from "@/components/settings/settings-content";
import { settingsPageProps } from "@/server/services/settings/page-data";

export const metadata: Metadata = { title: "Impostazioni — Syncloric" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  return <SettingsContent {...await settingsPageProps()} />;
}
