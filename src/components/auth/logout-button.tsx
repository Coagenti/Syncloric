"use client";
import { useState } from "react";
import { UiIcon } from "@/components/ui-icon";

export function LogoutButton({ menuItem = false }: { menuItem?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function logout() {
    setBusy(true); setError(false);
    try {
      const response = await fetch("/api/auth/sign-out", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error("Logout failed");
      window.location.replace("/login");
    } catch { setError(true); setBusy(false); }
  }
  return <div className="logout-control"><button role={menuItem ? "menuitem" : undefined} className={menuItem ? "account-menu-item account-logout" : "toolbar-action logout-action"} type="button" onClick={logout} disabled={busy}><UiIcon name="logout" /><span>{busy ? "Uscita…" : "Esci"}</span></button>{error && <p className="logout-error" role="alert">Uscita non riuscita. Riprova.</p>}</div>;
}
