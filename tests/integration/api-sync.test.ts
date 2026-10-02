import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { makeTestDb, resetTables, closeTestDb, type TestDb } from "./setup";
import { buildSyncHandlers } from "@/server/services/norish/http";
import { buildDiaryFeedHandlers } from "@/server/services/diary/feed";
import { NORISH_SETTINGS_KEY, resetEnvConfigCache } from "@/server/config";
import { encryptSecret } from "@/server/services/norish/crypto";
import { PLANNED_RECIPE, RECIPE_DETAIL } from "../fixtures/norish";

const USER = "11111111-1111-4111-8111-111111111111";
let db: TestDb;
const request = () => new Request("https://syncloric.example/api/v1/sync", {
  method: "POST", headers: { "content-type": "application/json", origin: "https://syncloric.example" }, body: "{}",
});
const session = async () => ({ user: { id: USER } });
const handlers = () => buildSyncHandlers({ getDb: () => db as never, getSession: session });
beforeAll(async () => { db = await makeTestDb(); });
afterAll(async () => { await closeTestDb(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetEnvConfigCache(); });
beforeEach(async () => {
  await resetTables(db);
  vi.stubEnv("DATABASE_URL", "postgres://localhost/test");
  vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(64));
  vi.stubEnv("ENCRYPTION_KEY", "a".repeat(64));
  vi.stubEnv("NORISH_API_KEY", "test-only-sync-key");
  vi.stubEnv("NORISH_BASE_URL", "https://env.example");
  vi.stubEnv("NORISH_UPSTREAM_TZ", undefined);
  resetEnvConfigCache();
  await db.execute(sql`INSERT INTO users (id,username) VALUES (${USER}::uuid,'demo')`);
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[]")));
});

it("syncs with GUI precedence, GET-only HTTP, and publishes the same structured feed state", async () => {
  await db.execute(sql`INSERT INTO admin_settings (key,value) VALUES (${NORISH_SETTINGS_KEY}, ${JSON.stringify("https://gui.example")}::jsonb)`);
  const response = await handlers().POST(request());
  expect(response.status).toBe(200);
  const outcome = await response.json();
  expect(outcome).toMatchObject({ status: "ok", reason: null, origin: null, finishedAt: expect.any(String) });
  const fetchMock = vi.mocked(fetch);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  for (const [url, options] of fetchMock.mock.calls) {
    expect(String(url)).toMatch(/^https:\/\/gui.example\/api\/v1\/planned-recipes\/(week|today)$/);
    expect(options?.method).toBe("GET");
  }
  const feed = await buildDiaryFeedHandlers({ getDb: () => db as never, getSession: session })
    .GET(new Request("https://syncloric.example/api/v1/diary?month=2026-10"));
  expect((await feed.json()).sync).toEqual(outcome);
});

it("rejects a second concurrent sync for the same user across handler instances and releases the flag", async () => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  vi.stubGlobal("fetch", vi.fn(async () => { entered(); await gate; return new Response("[]"); }));
  const first = handlers().POST(request());
  await started;
  try {
    const second = await Promise.race([
      handlers().POST(request()),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
    ]);
    expect(second?.status).toBe(503);
  } finally { release(); await first; }
  expect((await handlers().POST(request())).status).toBe(200);
});

it("returns 503 without a run or HTTP when another worker/scheduler owns the advisory lock", async () => {
  const acquireLock = vi.fn(async () => false);
  const response = await buildSyncHandlers({ getDb: () => db as never, getSession: session, acquireLock }).POST(request());
  expect(response.status).toBe(503);
  expect(acquireLock).toHaveBeenCalledWith(expect.anything(), USER);
  expect(fetch).not.toHaveBeenCalled();
  const runs = await db.execute(sql`SELECT count(*)::int AS n FROM norish_sync_runs`);
  expect(runs.rows[0].n).toBe(0);
});

it.each([401, 403, 400])("persists a sanitized HTTP %i failure and returns feed-compatible status", async (status) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "raw-upstream-diagnostic" }), { status })));
  const response = await handlers().POST(request());
  expect(response.status).toBe(200);
  const outcome = await response.json();
  expect(outcome).toMatchObject({ status: "error", reason: status === 400 ? null : "auth",
    origin: status === 400 ? null : "https://env.example" });
  const feed = await buildDiaryFeedHandlers({ getDb: () => db as never, getSession: session })
    .GET(new Request("https://syncloric.example/api/v1/diary?month=2026-10"));
  expect((await feed.json()).sync).toEqual(outcome);
  const runs = await db.execute(sql`SELECT error_message FROM norish_sync_runs`);
  expect(JSON.stringify(runs.rows)).not.toContain("raw-upstream-diagnostic");
  // A failed sync must release both locks so a subsequent run succeeds.
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[]")));
  expect((await handlers().POST(request())).status).toBe(200);
});

it("does not open a fake run when Norish URL is unset", async () => {
  vi.stubEnv("NORISH_BASE_URL", undefined); resetEnvConfigCache();
  const response = await handlers().POST(request());
  expect(response.status).toBe(503);
  expect(fetch).not.toHaveBeenCalled();
  expect((await db.execute(sql`SELECT count(*)::int AS n FROM norish_sync_runs`)).rows[0].n).toBe(0);
});

it("does not fall back to the configured demo key for an existing JSON-null user key", async () => {
  await db.execute(sql`INSERT INTO admin_settings (key,value) VALUES (${`norish.key.${USER}`}, 'null'::jsonb)`);
  const response = await handlers().POST(request());
  expect(response.status).toBe(503);
  expect(fetch).not.toHaveBeenCalled();
  expect((await db.execute(sql`SELECT count(*)::int AS n FROM norish_sync_runs`)).rows[0].n).toBe(0);
});

it("never fans out the bootstrap demo key to another user", async () => {
  const second = "22222222-2222-4222-8222-222222222222";
  await db.execute(sql`INSERT INTO users (id,username,created_at) VALUES (${second}::uuid,'second',now()+interval '1 second')`);
  const response = await buildSyncHandlers({ getDb: () => db as never, getSession: async () => ({ user: { id: second } }) }).POST(request());
  expect(response.status).toBe(503);
  expect(fetch).not.toHaveBeenCalled();
  expect((await db.execute(sql`SELECT count(*)::int AS n FROM norish_sync_runs`)).rows[0].n).toBe(0);
});

it.each([["Europe/Rome", true], ["not/a-timezone", false]] as const)("uses validated NORISH_UPSTREAM_TZ=%s for empty-payload reconciliation", async (timeZone, expectedDeleted) => {
  vi.stubEnv("NORISH_UPSTREAM_TZ", timeZone);
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  await db.execute(sql`INSERT INTO diary_entries (user_id,date,slot,entry_type,source,norish_item_id,kcal,servings)
    VALUES (${USER}::uuid,${date}::date,'Lunch','recipe','norish_sync','33333333-3333-4333-8333-333333333333'::uuid,120,1)`);
  expect((await handlers().POST(request())).status).toBe(200);
  expect((await db.execute(sql`SELECT norish_deleted FROM diary_entries`)).rows[0].norish_deleted).toBe(expectedDeleted);
});

it.each([false, true])("imports only the session user's meals with their encrypted key; partial=%s", async (partial) => {
  const second = "22222222-2222-4222-8222-222222222222";
  await db.execute(sql`INSERT INTO users (id,username,created_at) VALUES (${second}::uuid,'second',now()+interval '1 second')`);
  const ciphertext = encryptSecret("test-only-per-user-key", "a".repeat(64));
  await db.execute(sql`INSERT INTO admin_settings (key,value) VALUES (${`norish.key.${second}`},${JSON.stringify({ ciphertext })}::jsonb)`);
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
    expect(new Headers(options?.headers).get("x-api-key")).toBe("test-only-per-user-key");
    expect(options?.method).toBe("GET");
    const url = String(input);
    if (url.endsWith("/today")) return new Response("[]", { status: partial ? 400 : 200 });
    return new Response(JSON.stringify(url.endsWith("/week") ? [PLANNED_RECIPE] : RECIPE_DETAIL));
  }));
  const getSession = async () => ({ user: { id: second } });
  const response = await buildSyncHandlers({ getDb: () => db as never, getSession }).POST(request());
  expect(response.status).toBe(200);
  const outcome = await response.json();
  expect(outcome.status).toBe(partial ? "partial" : "ok");
  const feedRequest = new Request("https://syncloric.example/api/v1/diary?month=2026-09");
  const feed = await buildDiaryFeedHandlers({ getDb: () => db as never, getSession }).GET(feedRequest);
  const payload = await feed.json();
  expect(payload.sync).toEqual(outcome);
  expect(payload.entries).toHaveLength(1);
  expect(payload.entries[0]).toMatchObject({ name: "Sachertorte", kcal: 458, servings: 1, source: "norish_sync" });
  const other = await buildDiaryFeedHandlers({ getDb: () => db as never, getSession: session }).GET(feedRequest);
  expect(await other.json()).toMatchObject({ entries: [], sync: null });
  const run = (await db.execute(sql`SELECT user_id, items_upserted FROM norish_sync_runs`)).rows[0];
  expect(run).toMatchObject({ user_id: second, items_upserted: 1 });
  expect((await db.execute(sql`SELECT value FROM admin_settings WHERE key=${`norish.key.${second}`}`)).rows[0].value).toEqual({ ciphertext });
});

it("rejects unauthenticated sync on PGlite without a run or HTTP", async () => {
  expect((await buildSyncHandlers({ getDb: () => db as never, getSession: async () => null }).POST(request())).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
  expect((await db.execute(sql`SELECT count(*)::int AS n FROM norish_sync_runs`)).rows[0].n).toBe(0);
});
