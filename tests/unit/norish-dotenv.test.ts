import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { config as loadDotEnv } from "dotenv";
import { loadEnvConfig, norishBaseUrl, norishConfigStatus, resetEnvConfigCache } from "@/server/config";

let dir: string | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  resetEnvConfigCache();
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("Norish configuration from a real .env file", () => {
  it.each([
    ["NORISH_BASE_URL=\" https://dotenv.example.invalid \"\n", "https://dotenv.example.invalid", "env"],
    ["", "", "unset"],
    ["NORISH_BASE_URL=\n", "", "unset"],
  ])("loads %j without an embedded default", async (line, url, source) => {
    for (const key of ["NORISH_BASE_URL", "NORISH_API_KEY", "DATABASE_URL", "BETTER_AUTH_SECRET", "ENCRYPTION_KEY"]) {
      vi.stubEnv(key, undefined);
    }
    resetEnvConfigCache();
    dir = await mkdtemp(path.join(tmpdir(), "syncloric-dotenv-"));
    const file = path.join(dir, ".env");
    await writeFile(file, line + [
      "DATABASE_URL=postgres://localhost/syncloric_test",
      `BETTER_AUTH_SECRET=${"x".repeat(64)}`,
      `ENCRYPTION_KEY=${"a".repeat(64)}`,
    ].join("\n"));
    expect(loadDotEnv({ path: file, quiet: true }).error).toBeUndefined();
    expect(loadEnvConfig().NORISH_BASE_URL).toBe(url);
    expect(norishBaseUrl()).toBe(url);
    expect(norishConfigStatus()).toEqual({ enabled: url !== "", source, urlPresent: url !== "", apiKeyPresent: false });
    const override = { adminSettings: { "norish.base_url": "https://gui.example.invalid" } };
    expect(norishBaseUrl(override)).toBe("https://gui.example.invalid");
    expect(norishConfigStatus(override).source).toBe("gui");
    expect(norishBaseUrl({ adminSettings: {} })).toBe(url);
  });
});
