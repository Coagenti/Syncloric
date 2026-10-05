import { beforeEach, describe, expect, it, vi } from "vitest";
import { NorishApiError } from "@/server/services/norish/client";
import { resetEnvConfigCache } from "@/server/config";

const USER = "11111111-1111-4111-8111-111111111111";
const KEY = "sensitive-test-key";
let saved: string | undefined;
const deps = () => ({
  migrationsReady: vi.fn(async () => true),
  resolveBaseUrl: vi.fn(async () => saved ?? process.env.NORISH_BASE_URL ?? ""),
  resolveUpstreamTimeZone: vi.fn(() => process.env.NORISH_UPSTREAM_TZ),
  listUserIds: vi.fn(async () => [USER]),
  isBreakerOpen: vi.fn(async () => false),
  acquireLock: vi.fn(async () => true),
  startSyncRun: vi.fn(async () => "run-1"),
  finishSyncRun: vi.fn(async () => undefined),
  resolveClient: vi.fn(async () => ({}) as never),
  runNorishSync: vi.fn(async () => ({ imported: 1, updated: 0, skipped: 0, marked: 0 })),
});
beforeEach(() => {
  saved = undefined;
  vi.stubEnv("DATABASE_URL", "postgres://localhost/test");
  vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(64));
  vi.stubEnv("ENCRYPTION_KEY", "a".repeat(64));
  vi.stubEnv("NORISH_API_KEY", KEY);
  vi.stubEnv("NORISH_BASE_URL", undefined);
  vi.stubEnv("NORISH_UPSTREAM_TZ", undefined);
  resetEnvConfigCache();
});
describe("scheduler runtime URL and auth", () => {
  it("resolves and injects env-only upstream timezone afresh per tick", async () => {
    const { runSchedulerTick } = await import("@/server/services/scheduler");
    const d = deps();
    saved = "https://a.example";
    vi.stubEnv("NORISH_UPSTREAM_TZ", "UTC");
    await runSchedulerTick(new Date(), { deps: d });
    vi.stubEnv("NORISH_UPSTREAM_TZ", "Pacific/Kiritimati");
    await runSchedulerTick(new Date(), { deps: d });
    expect(d.resolveUpstreamTimeZone).toHaveBeenCalledTimes(2);
    expect(d.runNorishSync).toHaveBeenNthCalledWith(1, expect.objectContaining({ upstreamTimeZone: "UTC" }));
    expect(d.runNorishSync).toHaveBeenNthCalledWith(2, expect.objectContaining({ upstreamTimeZone: "Pacific/Kiritimati" }));
  });
  it("ignores the legacy global env key for every user, including the first account", async () => {
    const { resolveNorishClient } = await import("@/server/services/scheduler");
    const { loadEnvConfig } = await import("@/server/config");
    const config = { ...loadEnvConfig(), NORISH_BASE_URL: "https://gui.example" };
    expect(resolveNorishClient(config, undefined)).toBeNull();
    expect(config).not.toHaveProperty("NORISH_API_KEY");
  });
  it("GUI only activates tick; host changes on next tick; clearing skips before breaker or run", async () => {
    const { runSchedulerTick } = await import("@/server/services/scheduler");
    const d = deps();
    saved = "https://a.example";
    await runSchedulerTick(new Date(), { deps: d });
    saved = "https://b.example";
    await runSchedulerTick(new Date(), { deps: d });
    expect(d.resolveClient).toHaveBeenNthCalledWith(1, expect.objectContaining({ NORISH_BASE_URL: "https://a.example" }), USER, expect.anything());
    expect(d.resolveClient).toHaveBeenNthCalledWith(2, expect.objectContaining({ NORISH_BASE_URL: "https://b.example" }), USER, expect.anything());
    saved = undefined;
    await runSchedulerTick(new Date(), { deps: d });
    expect(d.startSyncRun).toHaveBeenCalledTimes(2);
    expect(d.isBreakerOpen).toHaveBeenCalledTimes(2);
  }, 20000);
  it("unmigrated DB exits cleanly without URL read or run", async () => {
    const { runSchedulerTick } = await import("@/server/services/scheduler");
    const d = deps();
    d.migrationsReady.mockResolvedValue(false);
    expect(await runSchedulerTick(new Date(), { deps: d })).toEqual([]);
    expect(d.resolveBaseUrl).not.toHaveBeenCalled();
    expect(d.startSyncRun).not.toHaveBeenCalled();
  });
  it.each([401, 403])("HTTP %i records auth without persisting key", async (status) => {
    const { runSchedulerTick } = await import("@/server/services/scheduler");
    const d = deps();
    saved = "https://a.example";
    d.runNorishSync.mockRejectedValue(new NorishApiError(`Norish API error (HTTP ${status})`, status));
    await runSchedulerTick(new Date(), { deps: d });
    expect(d.finishSyncRun).toHaveBeenCalledWith(expect.anything(), "run-1", "error", 0, expect.any(String), "auth");
    expect(JSON.stringify(d.finishSyncRun.mock.calls)).not.toContain(KEY);
  });
});
