import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db";
import { NORISH_SETTINGS_KEY, norishConfigStatus } from "@/server/config";
import { getAdminSetting } from "@/server/db/repositories/settings";
import { buildAdminSettingsOverride } from "./norish-url";

/** Authorize before DB access, including server-rendered settings (TL decision). */
export async function settingsPageProps(db?: Parameters<typeof getAdminSetting>[0]) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin") redirect("/");
  const saved = await getAdminSetting<string>(db ?? getDb(), NORISH_SETTINGS_KEY);
  return {
    initialSaved: saved,
    initialStatus: norishConfigStatus(buildAdminSettingsOverride(saved ?? undefined)),
  };
}
