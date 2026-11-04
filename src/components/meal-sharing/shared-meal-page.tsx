"use client";
import { useI18n } from "@/components/ui-preferences-provider";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { localDateKey, slotLabels } from "@/lib/diary";
import type { SharedMeal } from "@/lib/meal-sharing";
import { requestJson } from "./common";
import { CopyMealForm } from "./copy-meal-form";
export function SharedMealPage() {
  const { tr, formatDay } = useI18n();
  const [token, setToken] = useState(""); const [meal, setMeal] = useState<SharedMeal | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [feedback, setFeedback] = useState("");
  useEffect(() => {
    let controller: AbortController | undefined;
    function load() {
      controller?.abort(); controller = new AbortController(); const signal = controller.signal;
      const secret = window.location.hash.slice(1); setMeal(null); setToken(""); setLoading(true); setError(""); setFeedback("");
      if (!/^syncloric_meal_[A-Za-z0-9_-]{43}$/.test(secret)) { setError(tr("Link non valido o incompleto.")); setLoading(false); return; }
      void requestJson("/api/v1/meals/shared/read", { signal, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: secret }) }).then(data => { if (!signal.aborted) { setMeal(data.meal); setToken(secret); } })
        .catch(error => { if (!signal.aborted) setError(tr(error.message)); }).finally(() => { if (!signal.aborted) setLoading(false); });
    }
    load(); window.addEventListener("hashchange", load); return () => { controller?.abort(); window.removeEventListener("hashchange", load); };
  }, [tr]);
  return <main className="shared-meal-shell"><Link href="/" className="brand"><Brand /></Link><section className="editor-panel settings-card shared-meal-card"><span className="eyebrow">{tr("PASTO CONDIVISO / LINK TEMPORANEO")}</span><h1>{meal ? tr(slotLabels[meal.slot]) : tr("Pasto condiviso")}<span className="title-punctuation">.</span></h1>
    {meal && <><p className="form-help">{formatDay(meal.date, { day: "numeric", month: "long", year: "numeric" })}</p><CopyMealForm key={token} meal={meal} source={{ via: "link", token }} initialDate={localDateKey()} onCopied={(_, count) => setFeedback(tr("{0} {1}.", { "0": count, "1": tr(count === 1 ? "voce copiata" : "voci copiate") }))} /></>}
    {loading && <p role="status">{tr("Caricamento pasto…")}</p>}{error && <p role="alert">{tr(error)}</p>}{feedback && <p role="status">{tr(feedback)}</p>}
  </section></main>;
}
