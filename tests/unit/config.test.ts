import { afterEach, describe, expect, it } from "vitest";
import { loadEnvConfig, resetEnvConfigCache } from "@/server/config";

const base = {
  NODE_ENV: "test" as const,
  NORISH_BASE_URL: "https://norish.coagenti.it",
  DATABASE_URL: "postgres://REDACTED@localhost:5432/syncloric",
  BETTER_AUTH_SECRET: "x".repeat(64),
  ENCRYPTION_KEY: "a".repeat(64),
};

describe("loadEnvConfig", () => {
  afterEach(() => {
    resetEnvConfigCache();
  });

  it("parsa un env valido con default PORT", () => {
    const config = loadEnvConfig({ ...base });
    expect(config.NORISH_BASE_URL).toBe("https://norish.coagenti.it");
    expect(config.PORT).toBe(3000);
  });

  it("fail fast se manca NORISH_BASE_URL (§ 5.0)", () => {
    const resto = Object.fromEntries(
      Object.entries(base).filter(([key]) => key !== "NORISH_BASE_URL"),
    );
    // next-env.d.ts stringe ProcessEnv (NODE_ENV unione letterale): doppio cast
    // confinato al test, che costruisce un processo-env sintetico.
    expect(() => loadEnvConfig(resto as unknown as NodeJS.ProcessEnv)).toThrow(/NORISH_BASE_URL/);
  });

  it("rifiuta http non-locale (§ 9.2)", () => {
    expect(() =>
      loadEnvConfig({ ...base, NORISH_BASE_URL: "http://norish.example.com" }),
    ).toThrow(/localhost/);
  });

  it("accetta http su localhost (sviluppo, § 9.2)", () => {
    const config = loadEnvConfig({ ...base, NORISH_BASE_URL: "http://localhost:8080" });
    expect(config.NORISH_BASE_URL).toBe("http://localhost:8080");
  });

  it("rifiuta trailing slash su host radice (§ 9.2)", () => {
    expect(() =>
      loadEnvConfig({ ...base, NORISH_BASE_URL: "https://norish.coagenti.it/" }),
    ).toThrow(/trailing slash/);
  });

  it("rifiuta ENCRYPTION_KEY non hex-64", () => {
    expect(() =>
      loadEnvConfig({ ...base, ENCRYPTION_KEY: "z".repeat(64) }),
    ).toThrow(/ENCRYPTION_KEY/);
  });

  it("rifiuta BETTER_AUTH_SECRET troppo corto", () => {
    expect(() =>
      loadEnvConfig({ ...base, BETTER_AUTH_SECRET: "corto" }),
    ).toThrow(/BETTER_AUTH_SECRET/);
  });
});
