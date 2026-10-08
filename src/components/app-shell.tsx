import Link from "next/link";
import type { ReactNode } from "react";
import { LogoutButton } from "@/components/auth/logout-button";
import { UiIcon } from "@/components/ui-icon";
import { Brand, BrandMark } from "@/components/brand";
import { MotionPreferences } from "@/components/motion-preferences";
import { PwaRuntime } from "@/components/pwa-runtime";

const navigation = [
  { id: "dashboard", label: "Oggi", href: "/dashboard" },
  { id: "diary", label: "Diario", href: "/diary" },
  { id: "calendar", label: "Calendario", href: "/calendar" },
  { id: "settings", label: "Impostazioni", href: "/settings" },
] as const;

export function AppShell({ view, children }: { view: typeof navigation[number]["id"]; children: ReactNode }) {
  const label = navigation.find(item => item.id === view)?.label;
  return <div className="app-shell">
    <MotionPreferences />
    <PwaRuntime />
    <aside className="sidebar">
      <Link href="/dashboard" className="brand" aria-label="Syncloric, vai alla dashboard"><Brand /></Link>
      <div className="side-divider" /><span className="side-label">ESPLORA</span>
      <nav className="side-nav" aria-label="Navigazione principale">{navigation.map(item => <Link key={item.id} href={item.href} aria-current={view === item.id ? "page" : undefined} className={`nav-link ${view === item.id ? "active" : ""}`}><UiIcon name={item.id} />{item.label}{view === item.id && <i aria-hidden="true" />}</Link>)}</nav>
      <div className="side-bottom"><span className="side-label">IL TUO SPAZIO</span><p>Una panoramica semplice di quello che registri. Nessun giudizio, solo dati.</p><div className="side-build">SYNC / LIVE <span>●</span> V.01</div></div>
    </aside>
    <div className="app-main">
      <header className="topbar"><div className="topbar-path"><Link href="/dashboard" className="mobile-brand-home" aria-label="Syncloric, vai alla dashboard"><BrandMark /></Link><span>SYNCLORIC</span><span aria-hidden="true">/</span><strong>{label?.toUpperCase()}</strong></div><div className="topbar-right"><Link className={`toolbar-action ${view === "settings" ? "is-current" : ""}`} href="/settings" aria-current={view === "settings" ? "page" : undefined}><UiIcon name="settings" /><span>Impostazioni</span></Link><LogoutButton /></div></header>
      <main className="content">{children}</main>
      <footer className="app-footer">SYNCLORIC <span>DIARIO CALORIE · DATI PERSONALI</span></footer>
    </div>
    <nav className="mobile-nav" aria-label="Navigazione mobile">{navigation.map(item => <Link key={item.id} href={item.href} className={view === item.id ? "active" : ""} aria-current={view === item.id ? "page" : undefined}><UiIcon name={item.id} />{item.label}</Link>)}</nav>
  </div>;
}
