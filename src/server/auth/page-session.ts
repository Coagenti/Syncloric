import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth";

/** Server-only boundary for private app pages; never redirect an active session. */
export async function requirePageSession() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/login");
  return session;
}
