import { CalorieApp } from "@/components/calorie-app";
import { requirePageSession } from "@/server/auth/page-session";
export default async function DiaryPage() {
  await requirePageSession();
  return <CalorieApp view="diary" />;
}
