import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Db } from "@/server/db";
import { buildProfileHandlers } from "@/server/services/profile/http";
import { buildDiaryFeedHandlers } from "@/server/services/diary/feed";
import { makeTestDb, resetTables, closeTestDb, type TestDb } from "./setup";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
let db: TestDb;
beforeAll(async () => { db = await makeTestDb(); }, 600000);
afterAll(closeTestDb);
beforeEach(async () => {
  await resetTables(db);
  await db.execute(sql`INSERT INTO users (id, username) VALUES (${A}::uuid, 'a'), (${B}::uuid, 'b')`);
}, 600000);
const data = { sex: "m", heightCm: 180, weightKg: 80, birthYear: 1996, activityLevel: "moderate", goal: "maintain", targetSource: "calculated", manualTargetKcal: null };
const handlers = (id: string | null = A) => buildProfileHandlers({ getDb: () => db as unknown as Db, getSession: async () => id ? { user: { id } } : null });
const req = (body: unknown, route = "profile") => new Request(`http://localhost/api/v1/${route}`, { method: "PUT", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: JSON.stringify(body) });
const feed = async (id = A) => (await buildDiaryFeedHandlers({ getDb: () => db as unknown as Db, getSession: async () => ({ user: { id } }) }).GET(new Request("http://localhost/api/v1/diary?month=2026-01"))).json();

it("upserts the session's profile and switches feed between calculated and manual targets", async () => {
  expect((await feed()).target).toBeNull();
  expect((await handlers().PUT(req(data))).status).toBe(200);
  const saved = await (await handlers().GET(new Request("http://localhost/api/v1/profile"))).json();
  expect(saved.profile).toMatchObject({ sex: "m", weightKg: 80, targetSource: "calculated" });
  expect((await feed()).target).toBe(saved.profile.calculatedTargetKcal);
  expect((await handlers().PUT(req({ ...data, targetSource: "manual", manualTargetKcal: 2101, userId: B, calculatedTargetKcal: 1 }))).status).toBe(200);
  expect((await feed()).target).toBe(2101);
  expect((await feed(B)).target).toBeNull();
  expect((await handlers().PUT(req(data))).status).toBe(200);
  expect((await feed()).target).toBe(saved.profile.calculatedTargetKcal);
  const rows = await db.execute(sql`SELECT count(*)::int AS n FROM profiles`);
  expect(rows.rows[0].n).toBe(1);
});

it("requires auth, validates before writes and rejects cross-origin changes", async () => {
  expect((await handlers(null).GET(new Request("http://localhost/api/v1/profile"))).status).toBe(401);
  expect((await handlers(null).PUT(req(data))).status).toBe(401);
  expect((await handlers().PUT(req({ ...data, heightCm: 0 }))).status).toBe(422);
  expect((await handlers().PUT(req({ ...data, targetSource: "manual", manualTargetKcal: null }))).status).toBe(422);
  expect((await handlers().PUT(new Request("http://localhost/api/v1/profile", { method: "PUT", headers: { Origin: "https://evil.invalid", "Content-Type": "application/json" }, body: JSON.stringify(data) }))).status).toBe(403);
  expect((await feed()).target).toBeNull();
});

it("returns a server preview without saving a profile", async () => {
  const preview = await handlers().PREVIEW(req(data, "profile/preview"));
  expect(preview.status).toBe(200);
  expect((await preview.json()).calculatedTargetKcal % 5).toBe(0);
  expect((await feed()).target).toBeNull();
});
