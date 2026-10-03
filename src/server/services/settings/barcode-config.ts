import { z } from "zod";

export const BARCODE_SETTINGS_KEY = "barcode.enabled";
const settingsSchema = z.object({ enabled: z.boolean() }).strict();
/** Only an absent row defaults ON; malformed persisted values fail closed. */
export function resolveBarcodeEnabled(value: unknown): boolean {
  return value === undefined || value === true;
}
export function parseBarcodeSettings(value: unknown): { enabled: boolean } {
  return settingsSchema.parse(value);
}
