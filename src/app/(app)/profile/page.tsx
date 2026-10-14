import type { Metadata } from "next";
import { ProfileContent } from "@/components/profile/profile-content";
import { profilePageProps } from "@/server/services/profile/page-data";
export const metadata: Metadata = { title: "Profilo — Syncloric" };
export const dynamic = "force-dynamic";
export default async function ProfilePage() {
  return <ProfileContent {...await profilePageProps()} />;
}
