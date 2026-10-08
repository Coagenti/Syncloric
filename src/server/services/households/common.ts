import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db";
import { users } from "@/server/db/schema";
import { isAllowedRequestOrigin } from "@/server/http/request-origin";

export type Deps = { getDb: () => Db; getSession: (headers: Headers) => Promise<{ user: { id: string } } | null>; now?: () => Date };
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: privateHeaders });
export class HttpError extends Error { constructor(message: string, public status = 400) { super(message); } }
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
// Serialize membership changes with household-authorized copies and link revocations.
// The single short transaction lock suits a self-hosted instance, and prevents check/use races.
export const lockHouseholds = (tx: Tx) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('syncloric-households'))`);
export async function sessionUserId(deps: Deps, request: Request) {
  const session = await deps.getSession(request.headers);
  if (!session?.user || !z.uuid().safeParse(session.user.id).success) throw new HttpError("Autenticazione richiesta.", 401);
  return session.user.id;
}
export async function activeUser(db: Db | Tx, id: string) {
  const [user] = await db.select({ id: users.id, username: users.username }).from(users).where(and(eq(users.id, id), eq(users.banned, false)));
  if (!user) throw new HttpError("Autenticazione richiesta.", 401);
  return user;
}
export function checkOrigin(request: Request) {
  if (!isAllowedRequestOrigin(request, { requireOrigin: true })) throw new HttpError("Origine non consentita.", 403);
}
export async function input<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new HttpError("Invia dati JSON.");
  const reader = request.body?.getReader(); if (!reader) throw new HttpError("Dati non validi.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 16384) throw new HttpError("Dati troppo grandi.", 413); chunks.push(value); }
    const parsed = schema.safeParse(JSON.parse(Buffer.concat(chunks).toString()));
    if (!parsed.success) throw new HttpError("Dati non validi.");
    return parsed.data;
  } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError("Dati non validi."); }
  finally { await reader.cancel(); }
}
export async function handle(run: () => Promise<Response>) {
  try { return await run(); }
  catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    if (error instanceof Error && error.message === "Nutrition overflow") return json({ error: "I nutrienti superano i limiti supportati." }, 400);
    return json({ error: "Operazione non riuscita. Aggiorna la pagina prima di riprovare." }, 500);
  }
}
