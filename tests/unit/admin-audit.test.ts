import { expect, it, vi } from "vitest";
import { adminUpdateDetail, writeAdminAudit } from "@/server/db/repositories/admin-users";
import { adminAuditLog } from "@/server/db/schema";
it("audit writer retains actor or explicit system fallback and propagates transaction failure", async () => {
  const values = vi.fn(async () => {});
  const db = { insert: vi.fn(() => ({ values })) };
  await writeAdminAudit(db as never, { action: "fixture", target: "fixture", detail: {} });
  expect(db.insert).toHaveBeenCalledWith(adminAuditLog);
  expect(values).toHaveBeenLastCalledWith({ actorUserId: "system", action: "fixture", target: "fixture", detail: {} });
  await writeAdminAudit(db as never, { actorUserId: "fixture-actor", action: "fixture", target: "fixture", detail: { outcome: "denied" } });
  expect(values).toHaveBeenLastCalledWith(expect.objectContaining({ actorUserId: "fixture-actor" }));
  values.mockRejectedValueOnce(new Error("db unavailable"));
  await expect(writeAdminAudit(db as never, { action: "fixture", target: "fixture", detail: {} })).rejects.toThrow("db unavailable");
});
it("native update audit has only allowed values and opaque markers, never password or custom contents", () => {
  expect(adminUpdateDetail({ role: "user", banned: true, banReason: "Fixture", banExpires: null, email: "private@users.invalid", name: "Private fixture", emailVerified: true, image: "private-image", password: "never-logged" })).toEqual({ role: "user", banned: true, banReason: "Fixture", banExpires: null, emailChanged: true, nameChanged: true, emailVerifiedChanged: true, customFields: 1 });
});
