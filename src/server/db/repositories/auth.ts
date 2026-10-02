import { asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/server/db";
import { users } from "@/server/db/schema";

/** Serialize bootstrap across server processes: only the earliest registered user is promoted.
 * No client-supplied role is trusted. The transaction never returns secret data.
 */
export async function bootstrapFirstAdmin(db: Db, userId: string) {
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(19373301)`);
    const [existingAdmin] = await tx.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);
    if (existingAdmin) return;
    const [first] = await tx.select({ id: users.id, role: users.role }).from(users)
      .orderBy(asc(users.createdAt), asc(users.id)).limit(1);
    if (first?.id === userId && first.role === "user") {
      await tx.update(users).set({ role: "admin" }).where(eq(users.id, first.id));
    }
  });
}
