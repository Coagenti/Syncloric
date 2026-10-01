import { CalorieApp } from "@/components/calorie-app";
import { requirePageSession } from "@/server/auth/page-session";
export default async function CalendarPage() {
  await requirePageSession();
  return <CalorieApp view="calendar" />;
}
