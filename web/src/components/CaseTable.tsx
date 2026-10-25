import { useEffect, useId, useRef, useState } from "react";
import type { Catalog, CaseItem } from "../data/api";
import { describeFollowUp, shortName, STATUS_LABELS } from "../domain/format";
import { isResolved } from "../domain/query";
import { accountHref, isModifiedClick } from "../route";
import { PriorityBadge } from "./Primitives";
import { band, percent } from "./predictionText";

export function CaseTable(props: {
  data: Catalog;
  rows: CaseItem[];
  currentUserId: string;
  selectedIds: Set<string>;
  selectionDisabled: boolean;
  onToggleRow: (id: string, on: boolean) => void;
  onTogglePage: (on: boolean) => void;
  /** Opens a case by its account number. */
  onOpen: (accountNumber: string) => void;
}) {
  const { data, rows, selectedIds } = props;
  const users = new Map(data.users.map((u) => [u.id, u]));
  const selectedOnPage = rows.filter((r) => selectedIds.has(r.case.id)).length;
  const headRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headRef.current) headRef.current.indeterminate = selectedOnPage > 0 && selectedOnPage < rows.length;
  }, [selectedOnPage, rows.length]);

  return (
    <div className="table-wrap">
      <table className="case-table">
        <caption className="sr-only">Support cases</caption>
        <thead>
          <tr>
            <th scope="col" className="col-check">
              <input
                ref={headRef}
                type="checkbox"
                aria-label="Select all cases on this page"
                checked={rows.length > 0 && selectedOnPage === rows.length}
                disabled={rows.length === 0 || props.selectionDisabled}
                onChange={(e) => props.onTogglePage(e.target.checked)}
              />
            </th>
            <th scope="col">Person / case</th>
            <th scope="col">Priority</th>
            <th scope="col">Predicted risk <span className="sim">90 days</span></th>
            <th scope="col">Support needs</th>
            <th scope="col">Assigned to</th>
            <th scope="col">Status / follow-up</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => { const { case: c, person } = row;
            const assignee = c.workflow.assignedToUserId ? users.get(c.workflow.assignedToUserId) : null;
            const fu = describeFollowUp(c.workflow.followUpAt, isResolved(c), data.asOf);
            const labels = c.circumstances
              .map((x) => data.circumstances.find((d) => d.id === x.circumstanceId)?.label)
              .filter(Boolean) as string[];
            return (
              <tr
                key={c.id}
                className={selectedIds.has(c.id) ? "is-selected" : undefined}
                data-case-id={c.id}
                onClick={() => person?.accountNumber && props.onOpen(person.accountNumber)}
              >
                <td className="col-check" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${person?.displayName ?? person?.accountNumber ?? "case"}`}
                    checked={selectedIds.has(c.id)}
                    disabled={props.selectionDisabled}
                    onChange={(e) => props.onToggleRow(c.id, e.target.checked)}
                  />
                </td>
                <td>
                  <div className="person">
                    <span>
                      <a
                        className="name-link"
                        href={person?.accountNumber ? accountHref(person.accountNumber) : undefined}
                        data-account-link={person?.accountNumber ?? undefined}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isModifiedClick(e)) return; // let the browser open a new tab or window
                          e.preventDefault();
                          if (person?.accountNumber) props.onOpen(person.accountNumber);
                        }}
                      >
                        {person?.displayName ?? "Unknown person"}
                      </a>
                      <span className="sub">{person?.accountNumber} · {person?.suburb}</span>
                    </span>
                  </div>
                </td>
                <td data-label="Priority">
                  <PriorityBadge c={c} />
                </td>
                <td data-label="Predicted risk">
                  {row.risk ? (() => {
                    const b = band(row.risk.probability, row.risk.baseRate);
                    return <span className={`pred-pill pred-${b.id}`} title={`${percent(row.risk.probability)} chance of any harm in 90 days`}>{b.text} · {percent(row.risk.probability)}</span>;
                  })() : <span className="muted">No prediction</span>}
                </td>
                <td data-label="Support needs">
                  {labels.length ? (
                    <SupportNeeds labels={labels} />
                  ) : (
                    <span className="muted">No circumstances flagged</span>
                  )}
                </td>
                <td data-label="Assigned to">
                  {assignee ? (
                    <>
                      <span>{shortName(assignee.displayName)}</span>
                      {assignee.id === props.currentUserId ? <span className="sub">You</span> : null}
                    </>
                  ) : null}
                </td>
                <td data-label="Status">
                  <span className={`status status-${c.workflow.status}`}>{STATUS_LABELS[c.workflow.status]}</span>
                  <span className={`sub follow-${fu.tone}`}>{fu.text}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The first support need and a count; hovering or focusing shows the full list in a tooltip. */
function SupportNeeds({ labels }: { labels: string[] }) {
  const [at, setAt] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  const show = () => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    // Fixed to the window, so the table's scroll area can't clip it; flips above when near the bottom.
    const above = box.bottom + 260 > window.innerHeight && box.top > 260;
    setAt({ left: Math.min(box.left, window.innerWidth - 336), top: above ? box.top - 6 : box.bottom + 6, above });
  };
  const hide = () => setAt(null);
  useEffect(() => {
    if (!at) return;
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [at]);
  if (labels.length === 1) return <span>{labels[0]}</span>;
  return (
    <span ref={ref} className="needs" tabIndex={0} aria-describedby={at ? id : undefined}
      onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onKeyDown={(e) => { if (e.key === "Escape") hide(); }}>
      <span>{labels[0]}</span>
      <span className="sub">+ {labels.length - 1} more</span>
      {at ? (
        <span role="tooltip" id={id} className={`needs-tip${at.above ? " above" : ""}`} style={{ left: Math.max(8, at.left), top: at.top }}>
          <span className="needs-tip-title">{labels.length} support needs</span>
          <ul>{labels.map((l) => <li key={l}>{l}</li>)}</ul>
        </span>
      ) : null}
    </span>
  );
}
