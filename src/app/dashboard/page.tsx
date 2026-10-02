import { CalorieApp } from "@/components/calorie-app";
import { requirePageSession } from "@/server/auth/page-session";
export const dynamic = "force-dynamic";
export default async function DashboardPage() {
  await requirePageSession();
  return <CalorieApp view="dashboard" />;
}
