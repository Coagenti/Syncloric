import { getAdminSettings, setAdminSetting } from "./settings";
import { BARCODE_SETTINGS_KEY, parseBarcodeSettings, resolveBarcodeEnabled } from "@/server/services/settings/barcode-config";

export async function getBarcodeEnabled(db: Parameters<typeof getAdminSettings>[0]): Promise<boolean> {
  const values = await getAdminSettings(db, [BARCODE_SETTINGS_KEY]);
  return resolveBarcodeEnabled(values[BARCODE_SETTINGS_KEY]);
}
export async function setBarcodeEnabled(db: Parameters<typeof setAdminSetting>[0], enabled: boolean): Promise<void> {
  const value = parseBarcodeSettings({ enabled });
  await setAdminSetting(db, BARCODE_SETTINGS_KEY, value.enabled);
}
