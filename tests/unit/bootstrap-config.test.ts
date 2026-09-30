import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "@/instrumentation";
import { loadEnvConfig, norishBaseUrl, resetEnvConfigCache } from "@/server/config";

// Isolate external side effects, not the config loader under test.
const effects = vi.hoisted(() => ({ migrate: vi.fn(), schedule: vi.fn() }));
vi.mock("@/server/db/migrate-runtime", () => ({ migrateLatest: effects.migrate }));
vi.mock("@/server/services/scheduler", () => ({ startScheduler: effects.schedule }));

describe("bootstrap configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    resetEnvConfigCache();
  });

  it.each([undefined, "", "   ", "not-a-url"])(
    "bootstrap con NORISH_BASE_URL=%j: solo i valori malformati fermano l'avvio",
    async (value) => {
      vi.stubEnv("NEXT_RUNTIME", "nodejs");
      vi.stubEnv("NEXT_PHASE", "");
      vi.stubEnv("NORISH_BASE_URL", value);
      vi.stubEnv("DATABASE_URL", "postgres://localhost/syncloric_test");
      vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(64));
      vi.stubEnv("ENCRYPTION_KEY", "a".repeat(64));
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      if (value === "not-a-url") {
        await expect(register()).rejects.toThrow(/ADR-0007/);
        await expect(register()).rejects.toThrow(/NORISH_BASE_URL/);
        expect(effects.migrate).not.toHaveBeenCalled();
      } else {
        // URL assente/vuoto/spazi: l'app parte (degradata), scheduler NON avviato.
        await expect(register()).resolves.toBeUndefined();
        expect(logSpy.mock.calls.some((args) => args.some((a) => String(a).includes("Norish disabilitato")))).toBe(true);
      }
      expect(effects.schedule).not.toHaveBeenCalled();
    },
  );

  it("loads process env at bootstrap and exposes it to the HTTP client", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("NORISH_BASE_URL", "https://upstream.example.invalid");
    vi.stubEnv("DATABASE_URL", "postgres://localhost/syncloric_test");
    vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(64));
    vi.stubEnv("ENCRYPTION_KEY", "a".repeat(64));
    vi.spyOn(console, "log").mockImplementation(() => {});
    await register();
    expect(effects.migrate).toHaveBeenCalledOnce();
    expect(effects.schedule).toHaveBeenCalledOnce();
    expect(norishBaseUrl()).toBe("https://upstream.example.invalid");
    vi.stubEnv("NORISH_BASE_URL", "https://other.example.invalid");
    expect(loadEnvConfig().NORISH_BASE_URL).toBe("https://upstream.example.invalid");
  });

  it("does not require runtime env while building", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("NORISH_BASE_URL", undefined);
    await expect(register()).resolves.toBeUndefined();
    expect(effects.migrate).not.toHaveBeenCalled();
    expect(effects.schedule).not.toHaveBeenCalled();
  });
});