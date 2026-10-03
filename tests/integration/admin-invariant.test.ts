import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { makeTestDb, closeTestDb, type TestDb } from "./setup";
import { users } from "@/server/db/schema";
let db: TestDb;
beforeAll(async () => { db = await makeTestDb(); }, 600_000);
afterAll(closeTestDb);
it("database rejects demotion of the final active admin by any writer", async () => {
  const id = randomUUID();
  await db.insert(users).values({ id, username: "invariant_admin", role: "admin" });
  let rejected = false;
  try { await db.update(users).set({ role: "user" }).where(eq(users.id, id)); } catch { rejected = true; }
  const [row] = await db.select().from(users).where(eq(users.id, id));
  expect({ rejected, role: row.role }).toEqual({ rejected: true, role: "admin" });
}, 600_000);
it("profile changes pass through; final-admin ban and delete are rejected", async () => {
  const [admin] = await db.select().from(users);
  await db.update(users).set({ name: "Fixture profile" }).where(eq(users.id, admin.id));
  await expect(db.update(users).set({ banned: true }).where(eq(users.id, admin.id))).rejects.toThrow();
  await expect(db.delete(users).where(eq(users.id, admin.id))).rejects.toThrow();
  expect((await db.select().from(users))[0]).toMatchObject({ name: "Fixture profile", role: "admin", banned: false });
});
it("two submitted demotions of the final two admins allow exactly one (PGlite single connection)", async () => {
  const second = randomUUID(); await db.insert(users).values({ id: second, username: "race_admin", role: "admin" });
  const rows = await db.select().from(users);
  const outcomes = await Promise.allSettled(rows.map(row => db.update(users).set({ role: "user" }).where(eq(users.id, row.id))));
  expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(1);
  expect((await db.select().from(users)).filter(u => u.role === "admin" && !u.banned)).toHaveLength(1);
});
it("audit table is installed by the normal migration chain", async () => {
  const rows = await db.execute(sql`select table_name from information_schema.tables where table_name = 'admin_audit_log'`);
  expect(rows.rows).toHaveLength(1);
});
