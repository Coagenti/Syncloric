import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { makeTestDb, resetTables, closeTestDb, type TestDb } from "./setup";
import { runSchedulerTick } from "@/server/services/scheduler";
import { NorishClient } from "@/server/services/norish/client";
import { resetEnvConfigCache, NORISH_SETTINGS_KEY } from "@/server/config";
import { encryptSecret } from "@/server/services/norish/crypto";

const USER = "11111111-1111-4111-8111-111111111111";
const KEY = "fixture-key-never-in-logs";
const rows = (value: unknown): Record<string, unknown>[] => (value as { rows: Record<string, unknown>[] }).rows;
let db: TestDb;
let requested: string[];
let code: number;
let fetchMock: typeof fetch;

beforeAll(async () => { db = await makeTestDb(); });
afterAll(async () => { await resetTables(db); await closeTestDb(); vi.unstubAllEnvs(); resetEnvConfigCache(); });
beforeEach(async () => {
  await resetTables(db);
  vi.stubEnv("NORISH_BASE_URL", undefined);
  vi.stubEnv("NORISH_API_KEY", KEY);
  vi.stubEnv("DATABASE_URL", "postgres://localhost/test");
  vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(64));
  vi.stubEnv("ENCRYPTION_KEY", "a".repeat(64));
  resetEnvConfigCache();
  await db.execute(sql`INSERT INTO users (id, username) VALUES (${USER}::uuid, 'demo')`);
  requested = [];
  code = 200;
  fetchMock = vi.fn(async (input: string | URL | Request) => {
    requested.push(String(input));
    return new Response(code === 200 ? "[]" : JSON.stringify({ message: KEY }), { status: code, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
const deps = () => ({ resolveClient: vi.fn(async (config: { NORISH_BASE_URL: string }) => new NorishClient({ baseUrl: config.NORISH_BASE_URL, apiKey: KEY, fetchImpl: fetchMock })) });
const count = async () => Number(rows(await db.execute(sql`SELECT count(*)::int AS n FROM norish_sync_runs`))[0].n);

describe("scheduler with persisted GUI setting and HTTP mocked", () => {
  it("GUI-only host A then B, then deleted skips without breaker/run/egress", async () => {
    await db.execute(sql`INSERT INTO admin_settings (key,value) VALUES (${NORISH_SETTINGS_KEY}, ${JSON.stringify("https://a.example")}::jsonb)`);
    expect(await runSchedulerTick(new Date(), { db: db as never, deps: deps() })).toHaveLength(1);
    expect(requested.every((url) => url.startsWith("https://a.example/"))).toBe(true);
    await db.execute(sql`UPDATE admin_settings SET value=${JSON.stringify("https://b.example")}::jsonb WHERE key=${NORISH_SETTINGS_KEY}`);
    requested = [];
    expect(await runSchedulerTick(new Date(), { db: db as never, deps: deps() })).toHaveLength(1);
    expect(requested.every((url) => url.startsWith("https://b.example/"))).toBe(true);
    await db.execute(sql`DELETE FROM admin_settings WHERE key=${NORISH_SETTINGS_KEY}`);
    requested = [];
    expect(await runSchedulerTick(new Date(), { db: db as never, deps: deps() })).toEqual([]);
    expect(requested).toEqual([]);
    expect(await count()).toBe(2);
  });
  it("GUI overrides env; malformed GUI falls back to env", async () => {
    vi.stubEnv("NORISH_BASE_URL", "https://env.example");
    resetEnvConfigCache();
    await db.execute(sql`INSERT INTO admin_settings (key,value) VALUES (${NORISH_SETTINGS_KEY}, ${JSON.stringify("https://gui.example")}::jsonb)`);
    await runSchedulerTick(new Date(), { db: db as never, deps: deps() });
    expect(requested.every((url) => url.startsWith("https://gui.example/"))).toBe(true);
    requested = [];
    await db.execute(sql`UPDATE admin_settings SET value=${JSON.stringify("not-an-url")}::jsonb WHERE key=${NORISH_SETTINGS_KEY}`);
    await runSchedulerTick(new Date(), { db: db as never, deps: deps() });
    expect(requested.every((url) => url.startsWith("https://env.example/"))).toBe(true);
  });
  it.each([401,403,500])("HTTP %i persists classified error with no secret or credential rewrite", async (status) => {
    code = status;
    await db.execute(sql`INSERT INTO admin_settings (key,value) VALUES (${NORISH_SETTINGS_KEY}, ${JSON.stringify("https://gui.example")}::jsonb)`);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runSchedulerTick(new Date(), { db: db as never, deps: deps() });
    expect(result).toHaveLength(1);
    const last = rows(await db.execute(sql`SELECT status, reason, error_message FROM norish_sync_runs ORDER BY started_at DESC LIMIT 1`))[0];
    expect(last.status).toBe("error");
    expect(last.reason).toBe(status === 500 ? null : "auth");
    expect(JSON.stringify(last)).not.toContain(KEY);
    expect(rows(await db.execute(sql`SELECT value FROM admin_settings WHERE key=${NORISH_SETTINGS_KEY}`))[0].value).toBe("https://gui.example");
    log.mockRestore();
  }, 40000);
  it("401 only on today after successful week is still auth (not partial)", async () => {
    await db.execute(sql`INSERT INTO admin_settings (key,value) VALUES (${NORISH_SETTINGS_KEY}, ${JSON.stringify("https://gui.example")}::jsonb)`);
    fetchMock = vi.fn(async (input: string | URL | Request) =>
      new Response(String(input).endsWith("/today") ? JSON.stringify({ message: "unauthorized" }) : "[]",
        { status: String(input).endsWith("/today") ? 401 : 200 })) as typeof fetch;
    await runSchedulerTick(new Date(), { db: db as never, deps: deps() });
    const last = rows(await db.execute(sql`SELECT status, reason FROM norish_sync_runs ORDER BY started_at DESC LIMIT 1`))[0];
    expect(last).toMatchObject({ status: "error", reason: "auth" });
  });
  it("encrypted per-user key remains unchanged after 403 auth failure", async () => {
    const ciphertext = encryptSecret(KEY, "a".repeat(64));
    await db.execute(sql`INSERT INTO admin_settings (key,value) VALUES (${NORISH_SETTINGS_KEY}, ${JSON.stringify("https://gui.example")}::jsonb),
      (${`norish.key.${USER}`}, ${JSON.stringify({ ciphertext })}::jsonb)`);
    code = 403;
    vi.stubGlobal("fetch", fetchMock);
    try {
      await runSchedulerTick(new Date(), { db: db as never });
      const last = rows(await db.execute(sql`SELECT status, reason, error_message FROM norish_sync_runs ORDER BY started_at DESC LIMIT 1`))[0];
      expect(last).toMatchObject({ status: "error", reason: "auth" });
      expect(JSON.stringify(last)).not.toContain(KEY);
      expect(rows(await db.execute(sql`SELECT value FROM admin_settings WHERE key=${`norish.key.${USER}`}`))[0].value).toEqual({ ciphertext });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("env demo key gets auth classification on first account only", async () => {
    code = 401;
    await db.execute(sql`INSERT INTO admin_settings (key,value) VALUES (${NORISH_SETTINGS_KEY}, ${JSON.stringify("https://gui.example")}::jsonb)`);
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(await runSchedulerTick(new Date(), { db: db as never })).toHaveLength(1);
      const last = rows(await db.execute(sql`SELECT status, reason, error_message FROM norish_sync_runs ORDER BY started_at DESC LIMIT 1`))[0];
      expect(last).toMatchObject({ status: "error", reason: "auth" });
      expect(JSON.stringify(last)).not.toContain(KEY);
      expect(process.env.NORISH_API_KEY).toBe(KEY);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
