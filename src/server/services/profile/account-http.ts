import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import sharp from "sharp";
import { verifyPassword } from "better-auth/crypto";
import { accountSecurityAttempts, accounts, householdMembers, households, userAvatars, users } from "@/server/db/schema";
import { activeUser, checkOrigin, handle, HttpError, input, json, lockHouseholds, privateHeaders, sessionUserId, type Deps } from "@/server/services/households/common";
import { writeAdminAudit } from "@/server/db/repositories/admin-users";
const deletion = z.object({ password: z.string().min(1).max(128), confirmation: z.enum(["ELIMINA", "DELETE"]) }).strict();
export function buildAccountHandlers(deps: Deps) {
  async function owner(request: Request) { const id = await sessionUserId(deps, request); await activeUser(deps.getDb(), id); return id; }
  return {
    GET: (request: Request) => handle(async () => {
      const id = await owner(request);
      const [user] = await deps.getDb().select({ id: users.id, username: users.username, name: users.name, image: users.image, role: users.role, createdAt: users.createdAt }).from(users).where(eq(users.id, id));
      return json({ user });
    }),
    PATCH: (request: Request) => handle(async () => {
      const id = await owner(request); checkOrigin(request);
      const data = await input(request, z.object({ name: z.string().trim().min(1).max(80) }).strict());
      await deps.getDb().update(users).set({ name: data.name, updatedAt: new Date() }).where(eq(users.id, id));
      return json({ saved: true });
    }),
    DELETE: (request: Request) => handle(async () => {
      const id = await owner(request); checkOrigin(request); const data = await input(request, deletion); const db = deps.getDb();
      const now = deps.now?.() ?? new Date();
      // Persist failed password attempts across workers; a rollback must not reset the throttle.
      const [attempt] = await db.insert(accountSecurityAttempts).values({ userId: id, attempts: 1, windowStartedAt: now }).onConflictDoUpdate({ target: accountSecurityAttempts.userId, set: { attempts: sql`CASE WHEN ${accountSecurityAttempts.windowStartedAt} < ${new Date(now.getTime() - 15 * 60000)} THEN 1 ELSE LEAST(${accountSecurityAttempts.attempts} + 1, 6) END`, windowStartedAt: sql`CASE WHEN ${accountSecurityAttempts.windowStartedAt} < ${new Date(now.getTime() - 15 * 60000)} THEN ${now} ELSE ${accountSecurityAttempts.windowStartedAt} END` } }).returning();
      if (attempt.attempts > 5) throw new HttpError("Troppi tentativi. Riprova tra 15 minuti.", 429);
      await db.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(19373302)`); await lockHouseholds(tx);
        const [user] = await tx.select().from(users).where(and(eq(users.id, id), eq(users.banned, false))).for("update");
        const [credential] = await tx.select({ password: accounts.password }).from(accounts).where(and(eq(accounts.userId, id), eq(accounts.providerId, "credential"))).for("update");
        if (!user || !credential?.password || !await verifyPassword({ hash: credential.password, password: data.password })) throw new HttpError("Password attuale non corretta.", 403);
        if (user.role === "admin") {
          const [other] = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.banned, false), ne(users.id, id))).limit(1);
          if (!other) throw new HttpError("Prima di eliminare l’account assegna il ruolo amministratore a un altro utente attivo.", 409);
        }
        const owned = await tx.select({ id: households.id }).from(households).where(eq(households.ownerId, id));
        for (const household of owned) {
          const [successor] = await tx.select({ id: householdMembers.userId }).from(householdMembers).innerJoin(users, eq(users.id, householdMembers.userId)).where(and(eq(householdMembers.householdId, household.id), ne(householdMembers.userId, id), eq(users.banned, false))).orderBy(asc(householdMembers.joinedAt), asc(householdMembers.userId)).limit(1);
          if (successor) await tx.update(households).set({ ownerId: successor.id, joinCodeHash: null, joinCodeExpiresAt: null, updatedAt: now }).where(eq(households.id, household.id));
          else {
            const [member] = await tx.select({ id: householdMembers.userId }).from(householdMembers).where(and(eq(householdMembers.householdId, household.id), ne(householdMembers.userId, id))).limit(1);
            if (member) throw new HttpError("Trasferisci la proprietà del nucleo a un membro attivo prima di eliminare l’account.", 409);
          }
        }
        await tx.delete(users).where(eq(users.id, id));
        await writeAdminAudit(tx, { actorUserId: id, action: "self-delete", target: id, detail: { outcome: "success" } });
      });
      return json({ deleted: true });
    }),
    AVATAR_GET: (request: Request) => handle(async () => {
      const id = await owner(request); const [avatar] = await deps.getDb().select().from(userAvatars).where(eq(userAvatars.userId, id));
      if (!avatar) throw new HttpError("Foto non presente.", 404);
      return new Response(Buffer.from(avatar.data, "base64"), { headers: { ...privateHeaders, "Content-Type": "image/webp", "Content-Security-Policy": "default-src 'none'" } });
    }),
    AVATAR_PUT: (request: Request) => handle(async () => {
      const id = await owner(request); checkOrigin(request);
      if (!["image/jpeg", "image/png", "image/webp"].includes(request.headers.get("content-type") ?? "")) throw new HttpError("Usa JPEG, PNG o WebP.", 415);
      const reader = request.body?.getReader(); if (!reader) throw new HttpError("Foto mancante.");
      let size = 0; const chunks: Uint8Array[] = [];
      try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 2 * 1024 * 1024) throw new HttpError("La foto deve pesare al massimo 2 MB.", 413); chunks.push(value); } } finally { await reader.cancel(); }
      let image: Buffer;
      try {
        const decoder = sharp(Buffer.concat(chunks), { limitInputPixels: 16_000_000, failOn: "warning" }); const metadata = await decoder.metadata();
        if (!["jpeg", "png", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) > 1) throw new Error("format");
        image = await decoder.rotate().resize(256, 256, { fit: "cover" }).webp({ quality: 80 }).toBuffer();
      } catch { throw new HttpError("Foto non leggibile. Usa un’immagine statica JPEG, PNG o WebP.", 422); }
      const imageUrl = `/api/v1/account/avatar?v=${Date.now()}`;
      await deps.getDb().transaction(async tx => {
        await tx.insert(userAvatars).values({ userId: id, data: image.toString("base64") }).onConflictDoUpdate({ target: userAvatars.userId, set: { data: image.toString("base64"), updatedAt: new Date() } });
        await tx.update(users).set({ image: imageUrl, updatedAt: new Date() }).where(eq(users.id, id));
      });
      return json({ image: imageUrl });
    }),
    AVATAR_DELETE: (request: Request) => handle(async () => {
      const id = await owner(request); checkOrigin(request);
      await deps.getDb().transaction(async tx => { await tx.delete(userAvatars).where(eq(userAvatars.userId, id)); await tx.update(users).set({ image: null, updatedAt: new Date() }).where(eq(users.id, id)); });
      return json({ image: null });
    }),
  };
}
