"use client";

import { useEffect, useRef, type ReactNode } from "react";

const editors = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const controls = `${editors}, button, [role="slider"], [role="tablist"], [draggable="true"], a[download], [data-swipe-ignore]`;

/** Use the existing mobile links, including Next's normal navigation behavior. */
export function MobilePageContent({ currentHref, children }: { currentHref: string | null; children: ReactNode }) {
  const content = useRef<HTMLElement>(null);

  useEffect(() => {
    const surface = content.current;
    if (!surface || !currentHref) return;
    let start: { x: number; y: number; time: number; scrollY: number } | null = null;
    let blockedUntil = 0;
    const cancel = () => { start = null; };
    const enabled = () => window.location.pathname === currentHref
      && window.matchMedia("(max-width: 1024px)").matches
      && (window.visualViewport?.scale ?? 1) <= 1.01
      && !document.querySelector('dialog[open], [aria-modal="true"]')
      && !document.activeElement?.closest(editors)
      && window.getSelection()?.isCollapsed !== false;

    function begin(event: TouchEvent) {
      cancel();
      if (event.defaultPrevented || !enabled() || event.touches.length !== 1 || performance.now() < blockedUntil) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest(controls)) return;
      // Leave horizontal tab strips and other scrollable regions to the browser.
      for (let element: Element | null = target; element && element !== surface; element = element.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(element).overflowX) && element.scrollWidth > element.clientWidth + 1) return;
      }
      const touch = event.touches[0];
      // Keep the screen edges available for the phone/browser's back gesture.
      if (touch.clientX <= 24 || touch.clientX >= window.innerWidth - 24) return;
      start = { x: touch.clientX, y: touch.clientY, time: performance.now(), scrollY: window.scrollY };
    }

    function move(event: TouchEvent) {
      if (!start) return;
      if (event.touches.length !== 1) { cancel(); return; }
      const dx = Math.abs(event.touches[0].clientX - start.x);
      const dy = Math.abs(event.touches[0].clientY - start.y);
      if (dy > 12 && dy >= dx) cancel();
    }

    function end(event: TouchEvent) {
      const origin = start;
      cancel();
      if (!origin || event.defaultPrevented || event.touches.length || event.changedTouches.length !== 1 || !enabled()) return;
      const dx = event.changedTouches[0].clientX - origin.x;
      const dy = Math.abs(event.changedTouches[0].clientY - origin.y);
      const threshold = Math.max(64, Math.min(96, window.innerWidth * .2));
      if (performance.now() - origin.time > 800 || Math.abs(dx) < threshold || Math.abs(dx) < dy * 2 || dy > 48 || Math.abs(window.scrollY - origin.scrollY) > 12) return;
      const links = Array.from(surface!.closest(".app-shell")?.querySelectorAll<HTMLAnchorElement>(".mobile-nav a") ?? []);
      const index = links.findIndex(link => link.pathname === currentHref);
      const destination = index < 0 ? null : links[index + (dx < 0 ? 1 : -1)];
      if (!destination) return;
      // Prevent a swipe over a meal card from also activating the card itself.
      if (event.cancelable) event.preventDefault();
      blockedUntil = performance.now() + 500;
      destination.click();
    }

    surface.addEventListener("touchstart", begin, { passive: true });
    surface.addEventListener("touchmove", move, { passive: true });
    surface.addEventListener("touchend", end, { passive: false });
    surface.addEventListener("touchcancel", cancel, { passive: true });
    window.addEventListener("resize", cancel);
    return () => {
      surface.removeEventListener("touchstart", begin);
      surface.removeEventListener("touchmove", move);
      surface.removeEventListener("touchend", end);
      surface.removeEventListener("touchcancel", cancel);
      window.removeEventListener("resize", cancel);
    };
  }, [currentHref]);

  return <main className="content" ref={content}>{children}</main>;
}
