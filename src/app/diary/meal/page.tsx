import { z } from "zod";
import { notFound } from "next/navigation";
import { CalorieApp } from "@/components/calorie-app";
import { requirePageSession } from "@/server/auth/page-session";
import { DIARY_SLOTS } from "@/lib/types/diary";

export const dynamic = "force-dynamic";
export default async function MealPage({ searchParams }: { searchParams: Promise<{ slot?: string }> }) {
  await requirePageSession();
  const slot = z.enum(DIARY_SLOTS).safeParse((await searchParams).slot);
  if (!slot.success) notFound();
  return <CalorieApp view="meal" initialSlot={slot.data} />;
}
