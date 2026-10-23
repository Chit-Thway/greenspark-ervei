import { useEffect, useRef, useState } from "react";
import type { FlowDoc, FlowOp, FlowScoring } from "@greenspark/shared";
import type { DispatchResult } from "./useFlow";

type Dispatch = (op: FlowOp, opts?: { label?: string }) => DispatchResult;

const SCORING_LABELS: Record<keyof FlowScoring, string> = {
  flag_when: "Flag a circumstance when", strong: "What a strong signal is", supporting: "What a supporting signal is",
  sensitive_rule: "Rule for sensitive circumstances", safety_rule: "Rule for safety circumstances",
};

function Error({ message }: { message: string | null }) {
  return message ? <p className="ferror" role="alert">{message}</p> : null;
}

function Overview({ doc, dispatch }: { doc: FlowDoc; dispatch: Dispatch }) {
  const m = doc.meta;
  const initial = { title: m.title, region: m.region, flow: m.flow, how_it_works: m.how_it_works, last_verified: m.last_verified };
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const patch = Object.fromEntries(Object.entries(draft).filter(([k, v]) => v !== initial[k as keyof typeof initial]));
  const field = (key: keyof typeof initial, label: string, area = false) => (
    <div className="ffield">
      <label htmlFor={`s-${key}`}>{label}</label>
      {area ? <textarea id={`s-${key}`} rows={3} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
        : <input id={`s-${key}`} type={key === "last_verified" ? "date" : "text"} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />}
    </div>
  );
  return (
    <form className="ssec" onSubmit={(e) => { e.preventDefault(); const r = dispatch({ type: "updateMeta", patch }, { label: "edit the overview" }); setError(r.ok ? null : r.error); setSaved(r.ok); }}>
      <h3>Overview</h3>
      {field("title", "Title")}{field("region", "Region")}{field("flow", "Flow (shown in the file)")}{field("how_it_works", "How it works", true)}{field("last_verified", "File last verified")}
      <Error message={error} />
      <div className="actions"><button type="submit" className="btn btn-primary" disabled={Object.keys(patch).length === 0}>Save overview</button>{saved && Object.keys(patch).length === 0 ? <span className="hint" role="status">Saved</span> : null}</div>
    </form>
  );
}

function Scoring({ doc, dispatch }: { doc: FlowDoc; dispatch: Dispatch }) {
  const initial = doc.meta.scoring;
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const patch = Object.fromEntries((Object.keys(initial) as (keyof FlowScoring)[]).filter((k) => draft[k] !== initial[k]).map((k) => [k, draft[k]]));
  return (
    <form className="ssec" onSubmit={(e) => { e.preventDefault(); const r = dispatch({ type: "updateMeta", patch: { scoring: patch } }, { label: "edit the scoring rules" }); setError(r.ok ? null : r.error); }}>
      <h3>How circumstances are flagged</h3>
      {(Object.keys(SCORING_LABELS) as (keyof FlowScoring)[]).map((k) => (
        <div key={k} className="ffield">
          <label htmlFor={`sc-${k}`}>{SCORING_LABELS[k]}</label>
          <textarea id={`sc-${k}`} rows={2} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
        </div>
      ))}
      <Error message={error} />
      <div className="actions"><button type="submit" className="btn btn-primary" disabled={Object.keys(patch).length === 0}>Save rules</button></div>
    </form>
  );
}

function Guardrails({ doc, dispatch }: { doc: FlowDoc; dispatch: Dispatch }) {
  const initial = doc.meta.guardrails;
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const changed = JSON.stringify(draft) !== JSON.stringify(initial);
  return (
    <form className="ssec" onSubmit={(e) => { e.preventDefault(); const r = dispatch({ type: "updateMeta", patch: { guardrails: draft } }, { label: "edit the guardrails" }); setError(r.ok ? null : r.error); }}>
      <h3>Guardrails <span className="n">{draft.length}</span></h3>
      <ul className="glist">
        {draft.map((g, i) => (
          <li key={i}>
            <label className="sr-only" htmlFor={`g-${i}`}>Guardrail {i + 1}</label>
            <textarea id={`g-${i}`} rows={2} value={g} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? e.target.value : x)))} />
            <button type="button" className="icon-btn" aria-label={`Remove guardrail ${i + 1}`} onClick={() => setDraft(draft.filter((_, j) => j !== i))}>✕</button>
          </li>
        ))}
      </ul>
      <Error message={error} />
      <div className="actions">
        <button type="button" className="btn" onClick={() => setDraft([...draft, ""])}>+ Add a guardrail</button>
        <button type="submit" className="btn btn-primary" disabled={!changed}>Save guardrails</button>
      </div>
    </form>
  );
}

function Categories({ doc, dispatch }: { doc: FlowDoc; dispatch: Dispatch }) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const run = (r: DispatchResult) => setError(r.ok ? null : r.error);
  const used = (id: string) => doc.circumstances.filter((c) => c.category === id).length;
  return (
    <section className="ssec" aria-label="Categories">
      <h3>Categories <span className="n">{doc.categories.length}</span></h3>
      <p className="hint">Circumstances are grouped by category. A category in use can't be deleted.</p>
      <ul className="srows">
        {doc.categories.map((c) => {
          const name = names[c.id] ?? c.name;
          return (
            <li key={c.id}>
              <label className="sr-only" htmlFor={`cat-${c.id}`}>Name of category {c.id}</label>
              <input id={`cat-${c.id}`} value={name} onChange={(e) => setNames({ ...names, [c.id]: e.target.value })} />
              <span className="sub">{used(c.id)} in use</span>
              <button type="button" className="btn btn-small" disabled={name === c.name} onClick={() => run(dispatch({ type: "upsertCategory", category: { id: c.id, name } }, { label: "rename a category" }))}>Save</button>
              <button type="button" className="btn btn-small btn-danger" aria-label={`Delete category ${c.name}`} onClick={() => run(dispatch({ type: "deleteCategory", id: c.id }, { label: "delete a category" }))}>Delete</button>
            </li>
          );
        })}
      </ul>
      <div className="srows add">
        <input aria-label="New category name" placeholder="New category name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <input aria-label="New category short ID" placeholder="short_id" value={newId} onChange={(e) => setNewId(e.target.value)} />
        <button type="button" className="btn btn-small" disabled={!newName.trim() || !newId.trim()} onClick={() => { const r = dispatch({ type: "upsertCategory", category: { id: newId.trim(), name: newName } }, { label: "add a category" }); run(r); if (r.ok) { setNewId(""); setNewName(""); } }}>Add</button>
      </div>
      <Error message={error} />
    </section>
  );
}

function Types({ doc, dispatch }: { doc: FlowDoc; dispatch: Dispatch }) {
  const [drafts, setDrafts] = useState<Record<string, { name: string; meaning: string; who_acts: string }>>({});
  const [fresh, setFresh] = useState({ id: "", name: "", meaning: "", who_acts: "" });
  const [error, setError] = useState<string | null>(null);
  const run = (r: DispatchResult) => setError(r.ok ? null : r.error);
  const used = (id: string) => doc.circumstances.filter((c) => c.type === id).length;
  return (
    <section className="ssec" aria-label="Circumstance types">
      <h3>Circumstance types <span className="n">{doc.circumstance_types.length}</span></h3>
      <p className="hint">Each type says what kind of thing a circumstance is and who acts on it.</p>
      <ul className="types">
        {doc.circumstance_types.map((t) => {
          const d = drafts[t.id] ?? { name: t.name, meaning: t.meaning, who_acts: t.who_acts };
          const dirty = d.name !== t.name || d.meaning !== t.meaning || d.who_acts !== t.who_acts;
          const set = (k: keyof typeof d, v: string) => setDrafts({ ...drafts, [t.id]: { ...d, [k]: v } });
          return (
            <li key={t.id}>
              <div className="ffield"><label htmlFor={`t-${t.id}-n`}>Name <span className="hint">({t.id}, {used(t.id)} in use)</span></label><input id={`t-${t.id}-n`} value={d.name} onChange={(e) => set("name", e.target.value)} /></div>
              <div className="ffield"><label htmlFor={`t-${t.id}-m`}>Meaning</label><input id={`t-${t.id}-m`} value={d.meaning} onChange={(e) => set("meaning", e.target.value)} /></div>
              <div className="ffield"><label htmlFor={`t-${t.id}-w`}>Who acts</label><input id={`t-${t.id}-w`} value={d.who_acts} onChange={(e) => set("who_acts", e.target.value)} /></div>
              <div className="actions">
                <button type="button" className="btn btn-small" disabled={!dirty} onClick={() => run(dispatch({ type: "upsertCircumstanceType", item: { id: t.id, ...d } }, { label: "edit a circumstance type" }))}>Save</button>
                <button type="button" className="btn btn-small btn-danger" aria-label={`Delete type ${t.name}`} onClick={() => run(dispatch({ type: "deleteCircumstanceType", id: t.id }, { label: "delete a circumstance type" }))}>Delete</button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="types add">
        <h4>Add a type</h4>
        <div className="ffield"><label htmlFor="nt-name">Name</label><input id="nt-name" value={fresh.name} onChange={(e) => setFresh({ ...fresh, name: e.target.value })} /></div>
        <div className="ffield"><label htmlFor="nt-id">Short ID</label><input id="nt-id" value={fresh.id} onChange={(e) => setFresh({ ...fresh, id: e.target.value })} /></div>
        <div className="ffield"><label htmlFor="nt-meaning">Meaning</label><input id="nt-meaning" value={fresh.meaning} onChange={(e) => setFresh({ ...fresh, meaning: e.target.value })} /></div>
        <div className="ffield"><label htmlFor="nt-who">Who acts</label><input id="nt-who" value={fresh.who_acts} onChange={(e) => setFresh({ ...fresh, who_acts: e.target.value })} /></div>
        <button type="button" className="btn btn-small" disabled={!fresh.name.trim() || !fresh.id.trim()} onClick={() => { const r = dispatch({ type: "upsertCircumstanceType", item: { ...fresh, id: fresh.id.trim() } }, { label: "add a circumstance type" }); run(r); if (r.ok) setFresh({ id: "", name: "", meaning: "", who_acts: "" }); }}>Add type</button>
      </div>
      <Error message={error} />
    </section>
  );
}

/** Everything in the file that isn't a signal, circumstance or solution. */
export function FlowSettings({ doc, dispatch, onClose }: { doc: FlowDoc; dispatch: Dispatch; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className="settings" aria-labelledby="settings-title" onClose={onClose} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
      <div className="settings-body">
        <header className="settings-head">
          <h2 id="settings-title">Flow settings</h2>
          <button type="button" className="btn" onClick={() => ref.current?.close()}>Close</button>
        </header>
        <p className="hint">Changes here are saved to the JSON file straight away. Each section has its own Save button.</p>
        <Overview doc={doc} dispatch={dispatch} />
        <Scoring doc={doc} dispatch={dispatch} />
        <Guardrails doc={doc} dispatch={dispatch} />
        <Categories doc={doc} dispatch={dispatch} />
        <Types doc={doc} dispatch={dispatch} />
      </div>
    </dialog>
  );
}
