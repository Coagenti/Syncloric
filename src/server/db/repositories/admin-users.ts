import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { Db } from "@/server/db";
import { adminAuditLog, sessions, users } from "@/server/db/schema";

type Database = Pick<Db, "select" | "insert" | "update" | "delete" | "execute">;
export type AdminMutation = { actorUserId: string; target: string; action: string; changes: { role?: string; banned?: boolean; banReason?: string | null; banExpires?: Date | null }; remove?: boolean; detail: Record<string, unknown> };
export const lastAdminMessage = "Deve restare almeno un amministratore attivo.";
export async function writeAdminAudit(db: Pick<Db, "insert">, event: { actorUserId?: string; action: string; target: string; detail: Record<string, unknown> }) {
  await db.insert(adminAuditLog).values({ ...event, actorUserId: event.actorUserId ?? "system" });
}
async function checkMutation(tx: Database, mutation: AdminMutation) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(19373302)`);
  const [target] = await tx.select().from(users).where(eq(users.id, mutation.target)).limit(1);
  if (!target) return { ok: false as const, code: "NOT_FOUND" };
  const losesAdmin = mutation.remove || (mutation.changes.role !== undefined && mutation.changes.role !== "admin") || mutation.changes.banned === true;
  if (target.role === "admin" && !target.banned && losesAdmin) {
    const [other] = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.banned, false), ne(users.id, target.id))).limit(1);
    if (!other) {
      await writeAdminAudit(tx, { actorUserId: mutation.actorUserId, action: mutation.action, target: mutation.target, detail: { ...mutation.detail, outcome: "denied", code: "LAST_ACTIVE_ADMIN" } });
      return { ok: false as const, code: "LAST_ACTIVE_ADMIN" };
    }
  }
  return { ok: true as const, target };
}
/** Native hook preflight: the trigger protects the later adapter write's separate transaction. */
export async function preflightAdminMutation(db: Db, mutation: AdminMutation) {
  return db.transaction(tx => checkMutation(tx, mutation));
}
/** Custom mutations: authorization, invariant, write, session revocation and audit are atomic. */
export async function mutateAdminUser(db: Db, mutation: AdminMutation) {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(19373302)`);
    const [actor] = await tx.select().from(users).where(eq(users.id, mutation.actorUserId));
    if (!actor || actor.role !== "admin" || actor.banned) return { ok: false as const, code: "FORBIDDEN" };
    const result = await checkMutation(tx, mutation);
    if (!result.ok) return result;
    if (mutation.actorUserId === mutation.target && (mutation.changes.banned === true || mutation.remove)) return { ok: false as const, code: "SELF_ACTION_FORBIDDEN" };
    if (mutation.remove) await tx.delete(users).where(eq(users.id, mutation.target));
    else await tx.update(users).set({ ...mutation.changes, updatedAt: new Date() }).where(eq(users.id, mutation.target));
    if (mutation.changes.banned === true) await tx.delete(sessions).where(eq(sessions.userId, mutation.target));
    await writeAdminAudit(tx, { actorUserId: mutation.actorUserId, action: mutation.action, target: mutation.target, detail: { ...mutation.detail, outcome: "success" } });
    return { ok: true as const };
  });
}
export async function listAdminUsers(db: Db) {
  return db.select({ id: users.id, username: users.username, role: users.role, banned: users.banned, banReason: users.banReason, createdAt: users.createdAt }).from(users).orderBy(asc(users.createdAt), asc(users.id));
}
/** Native update-user audit: no email/name/custom values or passwords. */
export function adminUpdateDetail(data: Record<string, unknown>) {
  const detail: Record<string, unknown> = {};
  let customFields = 0;
  for (const [key, value] of Object.entries(data)) {
    if (["role", "banned", "banReason", "banExpires"].includes(key)) detail[key] = value;
    else if (["email", "emailVerified", "name"].includes(key)) detail[`${key}Changed`] = true;
    else if (key !== "password") customFields++;
  }
  if (customFields) detail.customFields = customFields;
  return detail;
}
