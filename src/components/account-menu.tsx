"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { UiIcon } from "./ui-icon";
import { LogoutButton } from "./auth/logout-button";
export type AccountUser = { id: string; username: string; name: string | null; image: string | null; role: string; createdAt: string };
export function AccountAvatar({ user }: { user: AccountUser | null }) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const image = user?.image?.startsWith("/api/v1/account/avatar?") ? user.image : null;
  return image && failedImage !== image ?
    // Avatar is a private same-origin image, never a user-supplied remote URL.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={image} alt="" onError={() => setFailedImage(image)} /> : <UiIcon name="profile" />;
}
export function AccountMenu() {
  const [open, setOpen] = useState(false); const [user, setUser] = useState<AccountUser | null>(null);
  const root = useRef<HTMLDivElement>(null); const trigger = useRef<HTMLButtonElement>(null); const menu = useRef<HTMLDivElement>(null); const id = useId();
  useEffect(() => {
    let controller: AbortController;
    const refresh = () => { controller?.abort(); const current = new AbortController(); controller = current; void fetch("/api/v1/account", { signal: current.signal, cache: "no-store" }).then(r => r.ok ? r.json() : null).then(data => { if (!current.signal.aborted && data?.user) setUser(data.user); }).catch(() => {}); };
    refresh(); window.addEventListener("syncloric:account-updated", refresh);
    return () => { controller?.abort(); window.removeEventListener("syncloric:account-updated", refresh); };
  }, []);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside); return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div className="account-menu" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} type="button" className="account-trigger" aria-label="Menu profilo" aria-haspopup="menu" aria-controls={id} aria-expanded={open} onClick={() => setOpen(v => !v)} onKeyDown={event => { if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setOpen(true); } }}><AccountAvatar user={user} /><span className="account-trigger-mark" aria-hidden="true" /></button>
    {open && <div ref={menu} id={id} className="account-dropdown" role="menu" aria-label="Account" onKeyDown={event => {
      const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []); const index = items.indexOf(document.activeElement as HTMLElement);
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
      else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; items[next]?.focus(); }
    }}><div className="account-menu-identity"><strong>{user?.name || user?.username || "Il tuo account"}</strong><span>{user?.username ? `@${user.username}` : "SYNCLORIC / PERSONALE"}</span></div><Link role="menuitem" className="account-menu-item" href="/profile" onClick={() => setOpen(false)}><UiIcon name="profile" />Profilo</Link><Link role="menuitem" className="account-menu-item" href="/settings" onClick={() => setOpen(false)}><UiIcon name="settings" />Impostazioni</Link><LogoutButton menuItem /></div>}
  </div>;
}
