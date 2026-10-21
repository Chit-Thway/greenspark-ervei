import { useState } from "react";
import type { PriorityLabel, QueueQuery, QueueView } from "../domain/types";
import type { Catalog, Facets } from "../data/api";
import { ASSISTANCE_OPTIONS, PRIORITY_LABELS, activeFilterCount } from "../domain/query";
import { PRIORITY_TEXT, STATUS_LABELS } from "../domain/format";
import { Checkbox } from "./Primitives";

const VIEWS: { id: QueueView; label: string }[] = [
  { id: "all", label: "All cases" },
  { id: "mine", label: "Assigned to me" },
  { id: "needs_review", label: "Needs review" },
];

function toggle<T>(list: T[], item: T, on: boolean): T[] {
  return on ? [...list.filter((x) => x !== item), item] : list.filter((x) => x !== item);
}

export function FilterSidebar(props: {
  data: Catalog;
  facets: Facets | null;
  query: QueueQuery;
  onChange: (patch: Partial<QueueQuery>) => void;
  onReset: () => void;
}) {
  const { data, query, onChange } = props;
  const facets = props.facets;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const workers = data.users.filter((u) => u.role === "support_worker");

  return (
    <div className="sidebar-inner">
      <div className="sidebar-head">
        <h2>Filters</h2>
        <button type="button" className="link-btn" onClick={props.onReset} disabled={activeFilterCount(query) === 0}>
          Reset
        </button>
      </div>

      <nav aria-label="Case views" className="views">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`view-btn${query.view === v.id ? " is-active" : ""}`}
            aria-pressed={query.view === v.id}
            onClick={() => onChange({ view: v.id })}
          >
            <span>{v.label}</span>
            <span className="count">{facets?.view[v.id] ?? "–"}</span>
          </button>
        ))}
      </nav>

      <fieldset className="group">
        <legend>Support areas</legend>
        {data.supportAreas.map((area) => {
          // The flowchart has many circumstances; only list ones that match a case, or are selected.
          const children = data.circumstances.filter((c) => c.supportAreaId === area.id && (!facets || (facets.circumstances[c.id] ?? 0) > 0 || query.circumstanceIds.includes(c.id)));
          if (!children.length) return null;
          const selected = children.filter((c) => query.circumstanceIds.includes(c.id));
          const all = selected.length === children.length;
          const open = expanded[area.id] ?? false; // areas start collapsed
          return (
            <div key={area.id} className="area">
              <div className="area-row">
                <Checkbox
                  checked={all}
                  indeterminate={selected.length > 0 && !all}
                  label={area.label}
                  count={facets?.areas[area.id]}
                  onChange={(on) =>
                    onChange({
                      circumstanceIds: on
                        ? [...new Set([...query.circumstanceIds, ...children.map((c) => c.id)])]
                        : query.circumstanceIds.filter((id) => !children.some((c) => c.id === id)),
                    })
                  }
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-expanded={open}
                  aria-label={`${open ? "Collapse" : "Expand"} ${area.label}`}
                  onClick={() => setExpanded({ ...expanded, [area.id]: !open })}
                >
                  {open ? "▾" : "▸"}
                </button>
              </div>
              {open ? (
                <div className="children">
                  {children.map((c) => (
                    <Checkbox
                      key={c.id}
                      checked={query.circumstanceIds.includes(c.id)}
                      label={c.label}
                      count={facets?.circumstances[c.id]}
                      onChange={(on) => onChange({ circumstanceIds: toggle(query.circumstanceIds, c.id, on) })}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
        <p className="hint">Matches any selected circumstance.</p>
      </fieldset>

      <fieldset className="group">
        <legend>Assistance reported</legend>
        {(["current", "history"] as const).map((g) => (
          <div key={g}>
            <p className="subhead">{g === "current" ? "Current at report" : "Historical, past 12 months"}</p>
            {ASSISTANCE_OPTIONS.filter((o) => o.group === g).map((o) => (
              <Checkbox
                key={o.id}
                checked={query.assistanceIds.includes(o.id)}
                label={o.label.replace(/ \((at report|past 12 months)\)$/, "")}
                count={facets?.assistance[o.id]}
                onChange={(on) => onChange({ assistanceIds: toggle(query.assistanceIds, o.id, on) })}
              />
            ))}
          </div>
        ))}
        <p className="hint">Past support is not treated as a current plan.</p>
      </fieldset>

      <fieldset className="group">
        <legend>{data.circumstanceSource === "flow" ? "Priority" : "Model priority · simulated"}</legend>
        {PRIORITY_LABELS.map((l: PriorityLabel) => (
          <Checkbox
            key={l}
            checked={query.priorityLabels.includes(l)}
            label={PRIORITY_TEXT[l]}
            count={facets?.priority[l]}
            onChange={(on) => onChange({ priorityLabels: toggle(query.priorityLabels, l, on) })}
          />
        ))}
        <label className="field">
          <span className="field-row">
            <span>Minimum priority score</span>
            <output>{query.minPriorityScore}</output>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={query.minPriorityScore}
            onChange={(e) => onChange({ minPriorityScore: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Assessment availability</span>
          <select
            value={query.assessmentStatus}
            onChange={(e) => onChange({ assessmentStatus: e.target.value as QueueQuery["assessmentStatus"] })}
          >
            <option value="">Any</option>
            <option value="ready">Ready</option>
            <option value="pending">Pending</option>
            <option value="unavailable">Unavailable</option>
          </select>
        </label>
      </fieldset>

      <fieldset className="group">
        <legend>Workflow</legend>
        <label className="field">
          <span>Case status</span>
          <select value={query.status} onChange={(e) => onChange({ status: e.target.value as QueueQuery["status"] })}>
            <option value="">Any status</option>
            {Object.entries(STATUS_LABELS).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Assigned worker</span>
          <select value={query.assignedToUserId} onChange={(e) => onChange({ assignedToUserId: e.target.value })}>
            <option value="">Any worker</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>{w.displayName}</option>
            ))}
          </select>
        </label>
      </fieldset>

      <p className="demo-note">Demo workspace · fictional people</p>
    </div>
  );
}
