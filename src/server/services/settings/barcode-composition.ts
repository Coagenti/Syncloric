import { getDb } from "@/server/db";
import { getAuth } from "@/server/auth";
import { buildBarcodeSettingsHandlers } from "./barcode-http";
import { writeAdminAudit } from "@/server/db/repositories/admin-users";

export const barcodeSettingsRuntime = buildBarcodeSettingsHandlers({
  getDb,
  getSession: headers => getAuth().api.getSession({ headers }),
  writeAudit: (tx, event) => writeAdminAudit(tx, { actorUserId: event.actorUserId, action: "settings.update", target: event.key, detail: { before: event.before, after: event.after } }),
});
