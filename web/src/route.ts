import { useCallback, useEffect, useState } from "react";

export const caseHref = (caseId: string) => `/cases/${encodeURIComponent(caseId)}`;

/** The case ID in a /cases/:caseId path, or null for any other path. */
export function caseIdFromPath(path: string): string | null {
  const m = /^\/cases\/([^/]+)\/?$/.exec(path);
  if (!m) return null;
  try { return decodeURIComponent(m[1]!); } catch { return null; }
}

/** True for clicks that should keep the browser's own behaviour (new tab, new window, download). */
export function isModifiedClick(e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button: number }): boolean {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
}

/** Minimal path router: the queue lives at "/" and each case at "/cases/:caseId". */
export function useRoute() {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((to: string) => {
    if (to !== window.location.pathname) window.history.pushState(null, "", to);
    setPath(window.location.pathname);
    window.scrollTo(0, 0);
  }, []);
  return { caseId: caseIdFromPath(path), navigate };
}
