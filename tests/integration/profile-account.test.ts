import { beforeAll, beforeEach, afterAll, expect, it, vi, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import sharp from "sharp";
import { hashPassword } from "better-auth/crypto";
import { buildAccountHandlers } from "@/server/services/profile/account-http";
import { buildProfileHandlers } from "@/server/services/profile/http";
import { buildDiaryFeedHandlers } from "@/server/services/diary/feed";
import { makeTestDb, resetTables, closeTestDb, type TestDb } from "./setup";
import type { Db } from "@/server/db";
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
let db: TestDb, password: string;
beforeAll(async () => { db = await makeTestDb(); password = await hashPassword("Current-pass-2026"); }, 600000);
afterAll(closeTestDb); afterEach(() => vi.useRealTimers());
beforeEach(async () => { await resetTables(db); await db.execute(sql`INSERT INTO users(id,username) VALUES(${A}::uuid,'alice'),(${B}::uuid,'bea')`); await db.execute(sql`INSERT INTO accounts(id,user_id,account_id,provider_id,password) VALUES('credential-a',${A}::uuid,${A},'credential',${password})`); }, 600000);
const deps = (id: string | null = A) => ({ getDb: () => db as unknown as Db, getSession: async () => id ? { user: { id } } : null });
const request = (method: string, body?: unknown, origin = "http://localhost") => new Request("http://localhost/api/v1/account", { method, headers: { "Content-Type": "application/json", Origin: origin }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const account = (id: string | null = A) => buildAccountHandlers(deps(id));
const profile = () => buildProfileHandlers(deps());
const person = { sex: "m", heightCm: 180, weightKg: 100, birthYear: 1996, activityLevel: "moderate", goal: "lose", targetSource: "calculated", manualTargetKcal: null };
it("stores a personal deadline and macro proportions, and includes goals in the diary feed", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
  const saved = await profile().PUT(request("PUT", { ...person, weightGoal: { targetWeightKg: 95, targetDate: "2027-04-14" } })); expect(saved.status).toBe(200);
  expect((await profile().MACROS(request("PUT", { mode: "custom", style: "balanced", carbs: 50, protein: 20, fat: 30 }))).status).toBe(200);
  const feed = async (id = A) => (await buildDiaryFeedHandlers(deps(id)).GET(new Request("http://localhost/api/v1/diary?month=2026-10"))).json();
  expect((await feed()).macroGoals.percentages).toEqual({ carbs: 50, protein: 20, fat: 30 }); expect((await feed(B)).macroGoals).toBeNull();
  vi.setSystemTime(new Date("2027-04-15T12:00:00Z")); const current = await (await profile().GET(request("GET"))).json(); expect(current.profile.calculation.status).toBe("expired"); expect((await feed()).target).toBe(current.profile.calculation.maintenanceKcal);
});
it("rejects extreme deadlines and invalid percentage sums without changing stored goals", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
  expect((await profile().PUT(request("PUT", { ...person, weightGoal: { targetWeightKg: 90, targetDate: "2026-10-30" } }))).status).toBe(422);
  expect((await profile().MACROS(request("PUT", { mode: "custom", style: "balanced", carbs: 60, protein: 20, fat: 30 }))).status).toBe(422);
});
it("normalizes private avatars to metadata-free 256px WebP and can remove them", async () => {
  const png = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#00f0ff" } }).png().toBuffer();
  const response = await account().AVATAR_PUT(new Request("http://localhost/api/v1/account/avatar", { method: "PUT", headers: { Origin: "http://localhost", "Content-Type": "image/png" }, body: png })); expect(response.status).toBe(200);
  const photo = await account().AVATAR_GET(request("GET")); expect(photo.headers.get("cache-control")).toBe("private, no-store"); const metadata = await sharp(Buffer.from(await photo.arrayBuffer())).metadata(); expect(metadata).toMatchObject({ format: "webp", width: 256, height: 256 }); expect(metadata.exif).toBeUndefined();
  expect((await account(B).AVATAR_GET(request("GET"))).status).toBe(404); expect((await account(null).AVATAR_GET(request("GET"))).status).toBe(401);
  expect((await account().AVATAR_DELETE(request("DELETE"))).status).toBe(200); expect((await account().AVATAR_GET(request("GET"))).status).toBe(404);
  expect((await account().AVATAR_PUT(new Request("http://localhost/api/v1/account/avatar", { method: "PUT", headers: { Origin: "http://localhost", "Content-Type": "image/png" }, body: "not an image" }))).status).toBe(422);
});
it("requires ownership, live access, Origin, password and explicit deletion confirmation", async () => {
  expect((await account(null).DELETE(request("DELETE", { password: "Current-pass-2026", confirmation: "ELIMINA" }))).status).toBe(401);
  expect((await account().DELETE(request("DELETE", { password: "Current-pass-2026", confirmation: "ELIMINA" }, "https://other.test"))).status).toBe(403);
  expect((await account().DELETE(request("DELETE", { password: "wrong", confirmation: "ELIMINA" }))).status).toBe(403);
  expect((await account().DELETE(request("DELETE", { password: "Current-pass-2026", confirmation: "wrong" }))).status).toBe(400);
  await db.execute(sql`UPDATE users SET banned=true WHERE id=${A}::uuid`); expect((await account().PATCH(request("PATCH", { name: "Alice" }))).status).toBe(401);
});
it.each(["ELIMINA", "DELETE"])("deletes owned data and transfers household ownership with %s confirmation", async confirmation => {
  await profile().PUT(request("PUT", person));
  await db.execute(sql`INSERT INTO sessions(id,token,user_id,expires_at) VALUES('session-a','private-token',${A}::uuid,now()+interval '1 day')`);
  await db.execute(sql`INSERT INTO households(id,name,owner_id) VALUES('aaaaaaaa-1111-4111-8111-111111111111','Casa',${A}::uuid)`);
  await db.execute(sql`INSERT INTO household_members(user_id,household_id) VALUES(${A}::uuid,'aaaaaaaa-1111-4111-8111-111111111111'),(${B}::uuid,'aaaaaaaa-1111-4111-8111-111111111111')`);
  expect((await account().DELETE(request("DELETE", { password: "Current-pass-2026", confirmation }))).status).toBe(200);
  expect((await db.execute(sql`SELECT count(*)::int n FROM sessions WHERE user_id=${A}::uuid`)).rows[0].n).toBe(0); expect((await db.execute(sql`SELECT count(*)::int n FROM profiles WHERE user_id=${A}::uuid`)).rows[0].n).toBe(0);
  expect((await db.execute(sql`SELECT owner_id FROM households`)).rows[0].owner_id).toBe(B); expect((await account().GET(request("GET"))).status).toBe(401);
});
it("protects the last active admin and persists a bounded password-attempt throttle", async () => {
  await db.execute(sql`UPDATE users SET role='admin' WHERE id=${A}::uuid`);
  expect((await account().DELETE(request("DELETE", { password: "Current-pass-2026", confirmation: "ELIMINA" }))).status).toBe(409);
  for (let i=0;i<4;i++) expect((await account().DELETE(request("DELETE", { password: "bad", confirmation: "ELIMINA" }))).status).toBe(403);
  expect((await account().DELETE(request("DELETE", { password: "bad", confirmation: "ELIMINA" }))).status).toBe(429);
});
