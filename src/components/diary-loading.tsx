"use client";
import { useI18n } from "@/components/ui-preferences-provider";

export function DiaryLoading({ view }: { view: "dashboard" | "diary" | "calendar" }) {
  const { tr } = useI18n();
  return <section className={"diary-loading loading-" + view} role="status" aria-label={tr("Caricamento pasti…")} aria-busy="true">
    <span className="sr-only">{tr("Caricamento pasti…")}</span>
    <div aria-hidden="true">
      <div className="loading-overview"><i className="loading-title" /><div className={view === "dashboard" ? "loading-ring" : "loading-value"} /><div className="loading-bars"><i /><i /><i /></div></div>
      {view === "calendar" ? <div className="loading-calendar-grid">{Array.from({ length: 35 }, (_, index) => <i key={index} />)}</div> : <div className="loading-meals">{Array.from({ length: 4 }, (_, index) => <div key={index}><i /><i /><i /></div>)}</div>}
    </div>
  </section>;
}
