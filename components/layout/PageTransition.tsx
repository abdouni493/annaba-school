"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/** Applies a smooth entry animation to the page content on EVERY navigation.
 *
 *  ⚠️  DO NOT use `key={pathname}` on the wrapper. Changing the key forces
 *  React to destroy and re-create the entire subtree on every navigation.
 *  During the destruction phase, deeply nested components (modals,
 *  framer-motion nodes) try to call removeChild on DOM nodes that their parent
 *  already removed, causing the infamous `Cannot read properties of null
 *  ('removeChild')` crash. That crash corrupts React's reconciler and makes
 *  subsequent state updates (like opening the sidebar) silently fail.
 *
 *  Instead of remounting, we replay a CSS-equivalent animation on the SAME DOM
 *  node via the Web Animations API whenever the pathname changes. Next.js App
 *  Router swaps the {children} content on navigation; we just animate the
 *  stable wrapper so the new screen eases in instead of snapping into place.
 *  A plain CSS `animation` class only runs once at mount, which is why sidebar
 *  clicks used to have no transition at all. */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== "function") return;

    // Honour users who ask the OS for reduced motion: no slide, no fade.
    const reduce =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    const animation = el.animate(
      [
        { opacity: 0, transform: "translateY(8px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 250, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "both" },
    );
    return () => animation.cancel();
  }, [pathname]);

  return (
    <div ref={ref} className="h-full">
      {children}
    </div>
  );
}
