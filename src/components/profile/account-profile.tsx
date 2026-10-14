"use client";
import { useEffect, useState, type FormEvent } from "react";
import { AccountAvatar, type AccountUser } from "@/components/account-menu";
import { UiIcon } from "@/components/ui-icon";
export function AccountProfile() {
  const [user, setUser] = useState<AccountUser | null>(null); const [name, setName] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  useEffect(() => { const controller = new AbortController(); void fetch("/api/v1/account", { cache: "no-store", signal: controller.signal }).then(async response => { if (!response.ok) throw new Error(); const data = await response.json(); if (!controller.signal.aborted) { setUser(data.user); setName(data.user.name || data.user.username); } }).catch(() => { if (!controller.signal.aborted) setError("Profilo non disponibile. Ricarica la pagina o accedi di nuovo."); }); return () => controller.abort(); }, []);
  function announce() { window.dispatchEvent(new Event("syncloric:account-updated")); }
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError(""); setMessage("");
    try { const response = await fetch("/api/v1/account", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) }); if (!response.ok) throw new Error(); setUser(v => v ? { ...v, name: name.trim() } : v); announce(); setMessage("Profilo aggiornato."); } catch { setError("Salvataggio non riuscito. I valori sono conservati: riprova o accedi di nuovo."); } finally { setBusy(false); }
  }
  async function photo(file?: File, remove = false) {
    if (busy || !file && !remove) return;
    if (file && (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024)) { setError("Usa JPEG, PNG o WebP fino a 2 MB."); return; }
    setBusy(true); setError(""); setMessage("");
    try { const response = await fetch("/api/v1/account/avatar", { method: remove ? "DELETE" : "PUT", ...(file ? { headers: { "Content-Type": file.type }, body: file } : {}) }); const data = await response.json(); if (!response.ok) { setError(response.status === 401 ? "Accedi di nuovo per modificare la foto." : data.error || "Foto non salvata."); return; } setUser(v => v ? { ...v, image: data.image } : v); announce(); setMessage(remove ? "Foto rimossa." : "Foto profilo aggiornata."); } catch { setError("Caricamento non riuscito. Riprova."); } finally { setBusy(false); }
  }
  return <section className="profile-page"><h2>Il tuo spazio personale<span className="title-punctuation">.</span></h2><div className="profile-panel profile-identity"><div className="profile-avatar"><AccountAvatar user={user} /></div><div><strong>{user?.name || user?.username || "Il tuo profilo"}</strong><p className="form-help">{user ? `@${user.username}` : "Caricamento…"}</p><label className="avatar-upload secondary-btn"><UiIcon name="camera" /><span>Carica foto</span><input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Foto profilo" disabled={busy || !user} onChange={event => { void photo(event.target.files?.[0]); event.target.value = ""; }} /></label>{user?.image && <button type="button" className="entry-text-action" disabled={busy} onClick={() => void photo(undefined, true)}>Rimuovi foto</button>}<p className="form-help">JPEG, PNG o WebP, massimo 2 MB. La foto viene ridimensionata e i metadati vengono rimossi.</p></div></div><form onSubmit={save}><fieldset disabled={busy || !user} className="profile-panel"><legend>Come ti chiami</legend><label>Nome visualizzato<input required maxLength={80} value={name} autoComplete="name" onChange={event => { setName(event.target.value); setMessage(""); }} /></label><p className="form-help">Lo username di accesso resta {user?.username ? `@${user.username}` : "quello registrato"}.</p><button type="submit" className="profile-save">Salva profilo personale</button></fieldset></form>{error && <p role="alert" className="profile-error">{error}</p>}<p role="status">{message}</p></section>;
}
