import type { Metadata } from "next";
import { ProfileForm } from "@/components/profile-form";
import { profilePageProps } from "@/server/services/profile/page-data";
export const metadata: Metadata = { title: "Profilo — Syncloric" };
export const dynamic = "force-dynamic";
export default async function ProfilePage() {
  return <ProfileForm {...await profilePageProps()} />;
}
