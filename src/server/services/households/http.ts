import { randomInt } from "node:crypto";
import { and, asc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { householdJoinAttempts, householdMembers, households, users } from "@/server/db/schema";
import { activeUser, checkOrigin, handle, hash, HttpError, input, json, lockHouseholds, sessionUserId, type Deps, type Tx } from "./common";

const name = z.string().trim().min(1).max(80);
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name }).strict(),
  z.object({ action: z.literal("join"), code: z.string().regex(/^\d{6}$/) }).strict(),
  z.object({ action: z.literal("regenerate") }).strict(),
  z.object({ action: z.literal("leave") }).strict(),
  z.object({ action: z.literal("rename"), name }).strict(),
  z.object({ action: z.literal("remove"), userId: z.uuid() }).strict(),
  z.object({ action: z.literal("transfer"), userId: z.uuid() }).strict(),
]);
export async function memberHousehold(tx: Tx, userId: string) {
  const [row] = await tx.select({ household: households }).from(householdMembers)
    .innerJoin(households, eq(householdMembers.householdId, households.id)).where(eq(householdMembers.userId, userId));
  return row?.household ?? null;
}
async function view(tx: Tx, userId: string) {
  const household = await memberHousehold(tx, userId); if (!household) return null;
  const members = await tx.select({ id: users.id, username: users.username, banned: users.banned }).from(householdMembers)
    .innerJoin(users, eq(householdMembers.userId, users.id)).where(eq(householdMembers.householdId, household.id)).orderBy(asc(householdMembers.joinedAt), asc(users.id));
  return { id: household.id, name: household.name, ownerId: household.ownerId, currentUserId: userId,
    joinCodeExpiresAt: household.ownerId === userId ? household.joinCodeExpiresAt?.toISOString() ?? null : null,
    members: members.map(m => ({ ...m, isOwner: m.id === household.ownerId })) };
}
async function newCode(tx: Tx) {
  for (let tries = 0; tries < 30; tries++) {
    const code = randomInt(1_000_000).toString().padStart(6, "0");
    const [existing] = await tx.select({ id: households.id }).from(households).where(eq(households.joinCodeHash, hash(code)));
    if (!existing) return code;
  }
  throw new HttpError("Impossibile generare il codice. Riprova.", 503);
}
export function buildHouseholdHandlers(deps: Deps) {
  const now = deps.now ?? (() => new Date());
  return {
    GET: (request: Request) => handle(async () => {
      const userId = await sessionUserId(deps, request);
      return deps.getDb().transaction(async tx => { await lockHouseholds(tx); await activeUser(tx, userId); return json({ household: await view(tx, userId) }); });
    }),
    POST: (request: Request) => handle(async () => {
      const userId = await sessionUserId(deps, request); checkOrigin(request);
      const data = await input(request, actionSchema);
      return deps.getDb().transaction(async tx => {
        await lockHouseholds(tx); await activeUser(tx, userId);
        const household = await memberHousehold(tx, userId); let code: string | undefined;
        if (data.action === "create" || data.action === "join") {
          if (household) throw new HttpError("Fai già parte di un nucleo. Esci prima di crearne uno o unirti a un altro.", 409);
          if (data.action === "create") {
            code = await newCode(tx);
            const [created] = await tx.insert(households).values({ name: data.name, ownerId: userId, joinCodeHash: hash(code), joinCodeExpiresAt: new Date(now().getTime() + 600000) }).returning();
            await tx.insert(householdMembers).values({ userId, householdId: created.id });
          } else {
            const [previous] = await tx.select().from(householdJoinAttempts).where(eq(householdJoinAttempts.userId, userId));
            const withinWindow = previous && previous.windowStartedAt.getTime() + 600000 > now().getTime();
            if (withinWindow && previous.attempts >= 5) return json({ error: "Troppi tentativi. Attendi 10 minuti dal primo tentativo e riprova." }, 429);
            await tx.insert(householdJoinAttempts).values({ userId, attempts: withinWindow ? previous.attempts + 1 : 1, windowStartedAt: withinWindow ? previous.windowStartedAt : now() })
              .onConflictDoUpdate({ target: householdJoinAttempts.userId, set: { attempts: withinWindow ? previous.attempts + 1 : 1, windowStartedAt: withinWindow ? previous.windowStartedAt : now() } });
            const [invited] = await tx.select({ household: households }).from(households).innerJoin(users, eq(households.ownerId, users.id))
              .where(and(eq(households.joinCodeHash, hash(data.code)), gt(households.joinCodeExpiresAt, now()), eq(users.banned, false)));
            // Return (rather than throw) so failed attempts are committed.
            if (!invited) return json({ error: "Codice non valido o scaduto." }, 400);
            await tx.insert(householdMembers).values({ userId, householdId: invited.household.id });
            await tx.delete(householdJoinAttempts).where(eq(householdJoinAttempts.userId, userId));
          }
        } else {
          if (!household) throw new HttpError("Non fai parte di un nucleo.", 404);
          if (data.action === "leave") {
            const other = await tx.select({ userId: householdMembers.userId }).from(householdMembers).where(eq(householdMembers.householdId, household.id));
            if (household.ownerId === userId && other.length > 1) throw new HttpError("Passa l’amministrazione a un membro prima di uscire.", 409);
            if (household.ownerId === userId) await tx.delete(households).where(eq(households.id, household.id));
            else await tx.delete(householdMembers).where(eq(householdMembers.userId, userId));
          } else {
            if (household.ownerId !== userId) throw new HttpError("Solo l’amministratore del nucleo può farlo.", 403);
            if (data.action === "regenerate") {
              code = await newCode(tx);
              await tx.update(households).set({ joinCodeHash: hash(code), joinCodeExpiresAt: new Date(now().getTime() + 600000), updatedAt: now() }).where(eq(households.id, household.id));
            } else if (data.action === "rename") {
              await tx.update(households).set({ name: data.name, updatedAt: now() }).where(eq(households.id, household.id));
            } else {
              const [member] = await tx.select().from(householdMembers).where(and(eq(householdMembers.userId, data.userId), eq(householdMembers.householdId, household.id)));
              if (!member || data.userId === userId) throw new HttpError("Membro non valido.", 404);
              if (data.action === "remove") {
                await tx.delete(householdMembers).where(eq(householdMembers.userId, data.userId));
                await tx.update(households).set({ joinCodeHash: null, joinCodeExpiresAt: null, updatedAt: now() }).where(eq(households.id, household.id));
              }
              else {
                await activeUser(tx, data.userId);
                await tx.update(households).set({ ownerId: data.userId, joinCodeHash: null, joinCodeExpiresAt: null, updatedAt: now() }).where(eq(households.id, household.id));
              }
            }
          }
        }
        return json({ household: await view(tx, userId), ...(code ? { code } : {}) }, data.action === "create" ? 201 : 200);
      });
    }),
  };
}
