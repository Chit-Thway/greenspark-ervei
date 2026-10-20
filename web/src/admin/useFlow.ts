import { useCallback, useEffect, useRef, useState } from "react";
import { FlowError, applyWithInverse, isNoop, type FlowDoc, type FlowOp } from "@greenspark/shared";
import type { ApiClient } from "../data/api";

export type SaveState = "idle" | "saving" | "saved" | "error";
export interface UndoEntry { inverse: FlowOp; label: string }
export type DispatchResult = { ok: true } | { ok: false; error: string };

/**
 * Holds the flow on the Admin page. Every edit is applied here at once (so the screen feels instant) and
 * sent to the server, which writes it into the JSON file. Edits are sent one at a time, in order. If anything
 * goes wrong, or somebody else changed the file meanwhile, the page reloads from the file, which is always right.
 */
export function useFlow(client: ApiClient) {
  const [doc, setDoc] = useState<FlowDoc | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [save, setSave] = useState<{ state: SaveState; message?: string }>({ state: "idle" });
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const docRef = useRef<FlowDoc | null>(null);
  const hashRef = useRef("");
  const pending = useRef(0);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const needsReload = useRef(false);
  const lastError = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const snap = await client.flow();
      docRef.current = snap.doc;
      hashRef.current = snap.hash;
      setDoc(snap.doc);
      setProblems(snap.problems);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load the flow.");
    }
  }, [client]);

  useEffect(() => { void load(); }, [load]);

  // Pick up changes made elsewhere (another person, or a hand edit of the file) when you come back to the tab.
  useEffect(() => {
    const onFocus = () => { if (pending.current === 0) void load(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const send = useCallback((op: FlowOp) => {
    pending.current += 1;
    setSave({ state: "saving" });
    chain.current = chain.current.then(async () => {
      try {
        const r = await client.flowOps([op]);
        if (r.previousHash !== hashRef.current) needsReload.current = true; // somebody else changed the file too
        hashRef.current = r.hash;
      } catch (e) {
        lastError.current = e instanceof Error ? e.message : "The change could not be saved.";
        needsReload.current = true;
      } finally {
        pending.current -= 1;
        if (pending.current === 0) {
          const message = lastError.current;
          lastError.current = null;
          if (needsReload.current) { needsReload.current = false; await load(); }
          setSave(message ? { state: "error", message } : { state: "saved" });
        }
      }
    });
  }, [client, load]);

  const dispatch = useCallback((op: FlowOp, opts: { label?: string; record?: boolean } = {}): DispatchResult => {
    const current = docRef.current;
    if (!current) return { ok: false, error: "The flow isn't loaded yet." };
    try {
      const { doc: next, inverse } = applyWithInverse(current, op);
      if (isNoop(inverse)) return { ok: true }; // nothing would change
      docRef.current = next;
      setDoc(next);
      if (opts.record !== false) setUndoStack((s) => [...s.slice(-49), { inverse, label: opts.label ?? "change" }]);
      send(op);
      return { ok: true };
    } catch (e) {
      if (e instanceof FlowError) return { ok: false, error: e.message };
      throw e;
    }
  }, [send]);

  const undo = useCallback((): DispatchResult => {
    const entry = undoStack[undoStack.length - 1];
    if (!entry) return { ok: false, error: "Nothing to undo." };
    setUndoStack((s) => s.slice(0, -1));
    return dispatch(entry.inverse, { record: false });
  }, [undoStack, dispatch]);

  return { doc, problems, loadError, save, dispatch, undo, undoStack, reload: load, readOnly: !doc || problems.length > 0 };
}
