"use client";
import { useI18n } from "@/components/ui-preferences-provider";
import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { AccountMenu } from "@/components/account-menu";
import { UiIcon } from "@/components/ui-icon";
import { Brand, BrandMark } from "@/components/brand";
import { MotionPreferences } from "@/components/motion-preferences";
import { PwaRuntime } from "@/components/pwa-runtime";
import { MobilePageContent } from "@/components/mobile-page-content";

const navigation = [
  { id: "dashboard", label: "Oggi", href: "/dashboard" },
  { id: "diary", label: "Diario", href: "/diary" },
  { id: "calendar", label: "Calendario", href: "/calendar" },
  { id: "settings", label: "Impostazioni", href: "/settings" },
] as const;

export function AppShell({ view, children }: { view: typeof navigation[number]["id"] | "profile" | "themes" | "language"; children: ReactNode }) {
  const { tr } = useI18n();
  const label = tr((view === "profile" ? "Profilo" : view === "themes" ? "Temi" : view === "language" ? "Lingua" : navigation.find(item => item.id === view)?.label) ?? "Syncloric");
  useEffect(() => { document.title = `${label} — Syncloric`; }, [label]);
  return <div className="app-shell">
    <MotionPreferences />
    <PwaRuntime />
    <aside className="sidebar">
      <Link href="/dashboard" className="brand" aria-label={tr("Syncloric, vai alla dashboard")}><Brand /></Link>
      <div className="side-divider" /><span className="side-label">{tr("ESPLORA")}</span>
      <nav className="side-nav" aria-label={tr("Navigazione principale")}>{navigation.map(item => <Link key={item.id} href={item.href} aria-current={view === item.id ? "page" : undefined} className={`nav-link ${view === item.id ? "active" : ""}`}><UiIcon name={item.id} />{tr(item.label)}{view === item.id && <i aria-hidden="true" />}</Link>)}</nav>
      <div className="side-bottom"><span className="side-label">{tr("IL TUO SPAZIO")}</span><p>{tr("Una panoramica semplice di quello che registri. Nessun giudizio, solo dati.")}</p><div className="side-build">SYNC / LIVE <span>●</span> V.01</div></div>
    </aside>
    <div className="app-main">
      <header className="topbar"><div className="topbar-path"><Link href="/dashboard" className="mobile-brand-home" aria-label={tr("Syncloric, vai alla dashboard")}><BrandMark /></Link><span>SYNCLORIC</span><span aria-hidden="true">/</span><strong>{label?.toUpperCase()}</strong></div><div className="topbar-right"><AccountMenu /></div><span className="hud-header-track" aria-hidden="true"><i /></span></header>
      <MobilePageContent currentHref={navigation.find(item => item.id === view)?.href ?? null}>{children}</MobilePageContent>
      <footer className="app-footer">SYNCLORIC <span>{tr("DIARIO CALORIE · DATI PERSONALI")}</span></footer>
    </div>
    <nav className="mobile-nav" aria-label={tr("Navigazione mobile")}>{navigation.map(item => <Link key={item.id} href={item.href} className={view === item.id ? "active" : ""} aria-current={view === item.id ? "page" : undefined}><UiIcon name={item.id} />{tr(item.label)}</Link>)}</nav>
  </div>;
}
