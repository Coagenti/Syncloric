import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "@/instrumentation";
import { resetEnvConfigCache } from "@/server/config";

// Isolate external side effects, not the bootstrap under test.
const effects = vi.hoisted(() => ({ migrate: vi.fn(), schedule: vi.fn() }));
vi.mock("@/server/db/migrate-runtime", () => ({ migrateLatest: effects.migrate }));
vi.mock("@/server/services/scheduler", () => ({ startScheduler: effects.schedule }));

/**
 * Bootstrap con Norish OPZIONALE (decisione utente/TL 2026-09-30, supersede
 * fail-fast ADR-0007 per NORISH_BASE_URL): l'app deve avviarsi senza la
 * variabile, con scheduler avviato: l'attivazione Norish si decide nel tick.
 */
describe("bootstrap con Norish opzionale", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    resetEnvConfigCache();
  });

  function stubBootstrapEnv(norishBaseUrlValue: string | undefined): void {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("NORISH_BASE_URL", norishBaseUrlValue);
    vi.stubEnv("DATABASE_URL", "postgres://localhost/syncloric_test");
    vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(64));
    vi.stubEnv("ENCRYPTION_KEY", "a".repeat(64));
  }

  it("parte senza NORISH_BASE_URL: scheduler avviato per tick", async () => {
    stubBootstrapEnv(undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(register()).resolves.toBeUndefined();
    expect(effects.migrate).toHaveBeenCalledOnce();
    expect(effects.schedule).toHaveBeenCalledOnce();
    expect(
      logSpy.mock.calls.some((args) => args.some((a) => String(a).includes("attivazione Norish per tick"))),
    ).toBe(true);
  });

  it("parte con NORISH_BASE_URL vuota/spazi: degradato come senza variabile", async () => {
    stubBootstrapEnv("   ");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(register()).resolves.toBeUndefined();
    expect(effects.schedule).toHaveBeenCalledOnce();
    expect(
      logSpy.mock.calls.some((args) => args.some((a) => String(a).includes("attivazione Norish per tick"))),
    ).toBe(true);
  });

  it("parte con NORISH_BASE_URL impostata: scheduler avviato come prima", async () => {
    stubBootstrapEnv("https://upstream.example.invalid");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(register()).resolves.toBeUndefined();
    expect(effects.migrate).toHaveBeenCalledOnce();
    expect(effects.schedule).toHaveBeenCalledOnce();
    expect(
      logSpy.mock.calls.some((args) => args.some((a) => String(a).includes("Norish disabilitato"))),
    ).toBe(false);
  });

  it("non richiede runtime env durante il build (invariato)", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("NORISH_BASE_URL", undefined);
    await expect(register()).resolves.toBeUndefined();
    expect(effects.migrate).not.toHaveBeenCalled();
    expect(effects.schedule).not.toHaveBeenCalled();
  });
});