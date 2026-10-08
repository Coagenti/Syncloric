"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { registrationEmail, validateCredentials } from "@/lib/auth";

export function LoginForm() {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (error && !busy) errorRef.current?.focus(); }, [error, busy]);
  function fail(message: string) {
    setError(message);
    errorRef.current?.focus();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const username = String(data.get("username") ?? "").trim().toLowerCase();
    const password = String(data.get("password") ?? "");
    const invalid = validateCredentials(username, password);
    if (invalid) { fail(invalid); return; }
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/auth/${register ? "sign-up/email" : "sign-in/username"}`, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(register ? { username, name: username, email: registrationEmail(username), password } : { username, password }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        const duplicate = ["USER_ALREADY_EXISTS", "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", "USERNAME_IS_ALREADY_TAKEN"].includes(result.code);
        fail(response.status === 429 ? "Troppi tentativi. Attendi e riprova." : duplicate ? "Username già in uso. Scegline un altro o accedi." : register ? "Impossibile creare l’account. Controlla i dati e riprova." : "Username o password non validi. Riprova.");
        return;
      }
      // Full navigation discards private client state and refreshes the server session boundary.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Auth must reset the document rather than reuse Next's client route cache.
      window.location.assign("/diary");
    } catch { fail("Connessione non disponibile. Riprova tra poco."); }
    finally { setBusy(false); }
  }
  return <section className="auth-card" aria-labelledby="access-title">
    <span className="eyebrow">IL TUO SPAZIO / PRIVATO</span>
    <h1 id="access-title">{register ? "Crea un account" : "Accedi"}<span className="brand-accent">.</span></h1>
    <p>Il tuo diario, sul tuo server. Nessuna email richiesta.</p>
    <form onSubmit={submit} noValidate aria-busy={busy}>
      <label htmlFor="username">Username</label>
      <input ref={usernameRef} id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={30} disabled={busy} aria-describedby={error ? "username-help access-error" : "username-help"} />
      <small id="username-help">3–30 lettere, numeri, punti o trattini bassi.</small>
      <label htmlFor="password">Password</label>
      <input id="password" name="password" type="password" autoComplete={register ? "new-password" : "current-password"} required minLength={8} maxLength={128} disabled={busy} aria-describedby={error ? "password-help access-error" : "password-help"} />
      <small id="password-help">Da 8 a 128 caratteri. Non condividere la tua password.</small>
      {error && <p id="access-error" ref={errorRef} role="alert" tabIndex={-1} className="auth-error">{error}</p>}
      <button className="auth-primary" type="submit" disabled={busy}>{busy ? "Attendi…" : register ? "Crea account" : "Accedi"}</button>
    </form>
    <button className="auth-switch" type="button" disabled={busy} onClick={() => { setRegister(!register); setError(null); usernameRef.current?.focus(); }}>{register ? "Hai già un account? Accedi" : "Crea un account"}</button>
    {register && <p className="status-note">Il primo utente dell’istanza diventa amministratore. Gli account successivi sono utenti standard.</p>}
  </section>;
}
