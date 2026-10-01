import { CalorieApp } from "@/components/calorie-app";
import { requirePageSession } from "@/server/auth/page-session";
export default async function DashboardPage() {
  await requirePageSession();
  return <CalorieApp view="dashboard" />;
}
