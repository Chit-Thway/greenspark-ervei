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

export type Page = "queue" | "case" | "admin";

export function pageFromPath(path: string): Page {
  if (/^\/admin\/?$/.test(path)) return "admin";
  return caseIdFromPath(path) ? "case" : "queue";
}

/** Minimal path router: the queue lives at "/", each case at "/cases/:caseId" and the Admin page at "/admin". */
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
  return { caseId: caseIdFromPath(path), page: pageFromPath(path), navigate };
}
