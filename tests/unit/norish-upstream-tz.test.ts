import { describe, expect, it, vi } from "vitest";
import * as config from "@/server/config";

describe("NORISH_UPSTREAM_TZ env-only fail-safe", () => {
  it("has no default; accepts explicit timezone and ignores invalid values with a safe warning", () => {
    const warn = vi.fn();
    expect(config.norishUpstreamTimeZone({}, warn)).toBeUndefined();
    expect(config.norishUpstreamTimeZone({ NORISH_UPSTREAM_TZ: "  UTC  " }, warn)).toBe("UTC");
    expect(config.norishUpstreamTimeZone({ NORISH_UPSTREAM_TZ: "Invalid/Zone" }, warn)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith("[norish] NORISH_UPSTREAM_TZ non riconosciuta: ignorata; payload vuoto non autorevole");
  });
});
