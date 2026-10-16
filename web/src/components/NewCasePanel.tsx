import { useEffect, useRef, useState } from "react";

export interface NewCaseInput {
  displayName: string;
  suburb: string;
}

export function NewCasePanel(props: { busy: boolean; onSubmit: (input: NewCaseInput) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [suburb, setSuburb] = useState("");
  const [touched, setTouched] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const invalid = !name.trim() || !suburb.trim();
  return (
    <aside className="overview" role="dialog" aria-modal="false" aria-labelledby="nc-title">
      <header className="ov-head">
        <span className="eyebrow">New case</span>
        <button type="button" className="icon-btn" aria-label="Close new case" onClick={props.onClose}>✕</button>
      </header>
      <h2 id="nc-title">Add a person to the queue</h2>
      <p className="hint">Minimal queue details only. Evidence and model results start as unknown and pending; the full profile belongs to the profile team.</p>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!invalid) props.onSubmit({ displayName: name.trim(), suburb: suburb.trim() });
        }}
      >
        <label className="field">
          <span>Display name (fictional)</span>
          <input ref={first} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={touched && !name.trim()} aria-describedby={touched && !name.trim() ? "nc-name-err" : undefined} />
          {touched && !name.trim() ? <span id="nc-name-err" className="error">Enter a name.</span> : null}
        </label>
        <label className="field">
          <span>Suburb</span>
          <input value={suburb} onChange={(e) => setSuburb(e.target.value)} aria-invalid={touched && !suburb.trim()} aria-describedby={touched && !suburb.trim() ? "nc-sub-err" : undefined} />
          {touched && !suburb.trim() ? <span id="nc-sub-err" className="error">Enter a suburb.</span> : null}
        </label>
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={props.busy}>Create case</button>
          <button type="button" className="btn" onClick={props.onClose}>Cancel</button>
        </div>
      </form>
    </aside>
  );
}
