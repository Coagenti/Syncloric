"use client";
import { useState } from "react";

export function LogoutButton() {
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
  return <div><button className="auth-switch" type="button" onClick={logout} disabled={busy}>{busy ? "Uscita…" : "Esci"}</button>{error && <p role="alert">Uscita non riuscita. Riprova.</p>}</div>;
}
