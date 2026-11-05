import { PreferencesPage } from "@/components/preferences/preferences-page";
import { requirePageSession } from "@/server/auth/page-session";
export const dynamic = "force-dynamic";
export default async function LanguagePage() { await requirePageSession(); return <PreferencesPage section="language" />; }
