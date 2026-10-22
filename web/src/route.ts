import { useCallback, useEffect, useState } from "react";

/** Each customer's case lives at /accounts/:accountNumber; the account number is the main ID on screen. */
export const accountHref = (accountNumber: string) => `/accounts/${encodeURIComponent(accountNumber)}`;

/** The account number in an /accounts/:accountNumber path, or null for any other path. */
export function accountFromPath(path: string): string | null {
  const m = /^\/accounts\/([^/]+)\/?$/.exec(path);
  if (!m) return null;
  try { return decodeURIComponent(m[1]!); } catch { return null; }
}

/** True for clicks that should keep the browser's own behaviour (new tab, new window, download). */
export function isModifiedClick(e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button: number }): boolean {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
}

export type Page = "queue" | "case" | "admin" | "data" | "priority" | "casepage";

/** Behind-the-scenes pages, under the BTS menu. */
export const FLOWCHART_PATH = "/bts/flowchart";
export const DATA_SOURCES_PATH = "/bts/data-sources";
export const PRIORITY_MODEL_PATH = "/bts/priority-model";
export const CASE_PAGE_PATH = "/bts/case-page";

export function pageFromPath(path: string): Page {
  if (/^\/(bts\/flowchart|flowchart|admin)\/?$/.test(path)) return "admin"; // the Flowchart page; old /flowchart and /admin links still work
  if (/^\/bts\/data-sources\/?$/.test(path)) return "data";
  if (/^\/bts\/priority-model\/?$/.test(path)) return "priority";
  if (/^\/bts\/case-page\/?$/.test(path)) return "casepage";
  return accountFromPath(path) ? "case" : "queue";
}

/** Minimal path router: the queue lives at "/", each case at "/accounts/:accountNumber" and the BTS pages under "/bts/". */
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
  return { accountNumber: accountFromPath(path), page: pageFromPath(path), navigate };
}
