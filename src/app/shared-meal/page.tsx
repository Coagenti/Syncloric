import type { Metadata } from "next";
import { SharedMealPage } from "@/components/meal-sharing/shared-meal-page";
export const metadata: Metadata = { title: "Pasto condiviso — Syncloric", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function Page() { return <SharedMealPage />; }
