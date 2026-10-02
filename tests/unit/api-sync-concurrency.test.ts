import { expect, it, vi } from "vitest";
import type { Db } from "@/server/db";
import { buildSyncHandlers } from "@/server/services/norish/http";
import type { SyncPort } from "@/server/services/norish/runner";

vi.mock("@/server/config", () => ({ NORISH_SETTINGS_KEY: "norish.base_url", norishBaseUrl: () => "https://test.example", loadEnvConfig: () => ({}), norishUpstreamTimeZone: () => undefined }));
vi.mock("@/server/db/repositories/settings", () => ({ getAdminSetting: async () => null }));
vi.mock("@/server/services/scheduler", () => ({ resolveNorishClient: () => null }));
vi.mock("@/server/services/norish/sync", () => ({ startSyncRun: async () => "test-run", finishSyncRun: async () => {} }));

const request = () => new Request("https://syncloric.example/api/v1/sync", { method: "POST", headers: { "content-type": "application/json" } });
const db = { execute: async () => ({ rows: [{ acquired: true, finished_at: "2026-10-02T00:00:00Z" }] }),
  transaction: async (work: (tx: Db) => Promise<unknown>) => work(db as unknown as Db) };

it("different users enter the runner before either finishes (no process-global serialization)", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const entered: string[] = [];
  let bothEntered!: () => void;
  const both = new Promise<void>((resolve) => { bothEntered = resolve; });
  const runSync = vi.fn(async ({ userId }: { userId: string }) => {
    entered.push(userId); if (entered.length === 2) bothEntered();
    await gate;
    return { imported: 0, updated: 0, skipped: 0, marked: 0 };
  });
  const deps = { getDb: () => db as unknown as Db, runSync, resolveClient: async () => ({} as SyncPort) };
  const first = buildSyncHandlers({ ...deps, getSession: async () => ({ user: { id: "parallel-a" } }) }).POST(request());
  const second = buildSyncHandlers({ ...deps, getSession: async () => ({ user: { id: "parallel-b" } }) }).POST(request());
  try {
    await Promise.race([both, new Promise<void>((resolve) => setTimeout(resolve, 1000))]);
    expect(entered.sort()).toEqual(["parallel-a", "parallel-b"]);
  } finally { release(); await Promise.allSettled([first, second]); }
  expect((await first).status).toBe(200);
  expect((await second).status).toBe(200);
});
