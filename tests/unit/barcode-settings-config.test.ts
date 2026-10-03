import { expect, it } from "vitest";
import { resolveBarcodeEnabled, parseBarcodeSettings } from "@/server/services/settings/barcode-config";

it("defaults absent barcode.enabled to true without coercing stored values", () => {
  expect(resolveBarcodeEnabled(undefined)).toBe(true);
  expect(resolveBarcodeEnabled(true)).toBe(true);
  expect(resolveBarcodeEnabled(false)).toBe(false);
  for (const value of [null, "true", "false", 1, {}, []]) expect(resolveBarcodeEnabled(value)).toBe(false);
});
it("accepts only an explicit boolean setting, never extra fields or coercion", () => {
  expect(parseBarcodeSettings({ enabled: false })).toEqual({ enabled: false });
  expect(parseBarcodeSettings({ enabled: true })).toEqual({ enabled: true });
  for (const value of [{}, { enabled: "false" }, { enabled: 0 }, { enabled: null }, { enabled: true, secret: "x" }, null]) {
    expect(() => parseBarcodeSettings(value)).toThrow();
  }
});
