import { z } from "zod";
import { FoodEntryView } from "@/components/food-entry/food-entry-view";
import { requirePageSession } from "@/server/auth/page-session";
import { DIARY_SLOTS } from "@/lib/types/diary";
export const dynamic = "force-dynamic";
export default async function FoodEntryPage({ searchParams }: { searchParams: Promise<{ date?: string; slot?: string }> }) {
  await requirePageSession();
  const params = await searchParams;
  const date = z.iso.date().safeParse(params.date); const slot = z.enum(DIARY_SLOTS).safeParse(params.slot);
  return <FoodEntryView initialDate={date.success ? date.data : ""} initialSlot={slot.success ? slot.data : "Lunch"} />;
}
