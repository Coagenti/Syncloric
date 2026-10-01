import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db";
import { readProfile } from "./http";

/** Authorize before DB access; same server-side guard as settings/login. */
export async function profilePageProps() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/login");
  return { initialProfile: await readProfile(getDb(), session.user.id) };
}
