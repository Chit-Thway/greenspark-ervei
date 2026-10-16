import { useEffect, useRef } from "react";
import type { Catalog, CaseItem } from "../data/api";
import { describeFollowUp, initials, shortName, STATUS_LABELS } from "../domain/format";
import { isResolved } from "../domain/query";
import { PriorityBadge } from "./Primitives";

export function CaseTable(props: {
  data: Catalog;
  rows: CaseItem[];
  currentUserId: string;
  selectedIds: Set<string>;
  openCaseId: string | null;
  onToggleRow: (id: string, on: boolean) => void;
  onTogglePage: (on: boolean) => void;
  onOpen: (id: string) => void;
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
                disabled={rows.length === 0}
                onChange={(e) => props.onTogglePage(e.target.checked)}
              />
            </th>
            <th scope="col">Person / case</th>
            <th scope="col">Support needs</th>
            <th scope="col">Priority <span className="sim">simulated</span></th>
            <th scope="col">Assigned to</th>
            <th scope="col">Status / follow-up</th>
            <th scope="col" className="col-action"><span className="sr-only">Open overview</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ case: c, person }) => {
            const assignee = c.workflow.assignedToUserId ? users.get(c.workflow.assignedToUserId) : null;
            const fu = describeFollowUp(c.workflow.followUpAt, isResolved(c), data.asOf);
            const labels = c.circumstances
              .map((x) => data.circumstances.find((d) => d.id === x.circumstanceId)?.label)
              .filter(Boolean) as string[];
            return (
              <tr
                key={c.id}
                className={`${selectedIds.has(c.id) ? "is-selected " : ""}${props.openCaseId === c.id ? "is-open" : ""}`}
                data-case-id={c.id}
                onClick={() => props.onOpen(c.id)}
              >
                <td className="col-check" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${person?.displayName ?? c.id}`}
                    checked={selectedIds.has(c.id)}
                    onChange={(e) => props.onToggleRow(c.id, e.target.checked)}
                  />
                </td>
                <td>
                  <div className="person">
                    <span className="avatar" aria-hidden="true">{initials(person?.displayName ?? "?")}</span>
                    <span>
                      <button
                        type="button"
                        className="name-btn"
                        aria-haspopup="dialog"
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onOpen(c.id);
                        }}
                      >
                        {person?.displayName ?? "Unknown person"}
                      </button>
                      <span className="sub">{c.id} · {person?.suburb}</span>
                    </span>
                  </div>
                </td>
                <td>
                  {labels.length ? (
                    <>
                      <span>{labels[0]}</span>
                      {labels.length > 1 ? <span className="sub">+ {labels.length - 1} more</span> : null}
                    </>
                  ) : (
                    <span className="muted">No circumstances flagged</span>
                  )}
                </td>
                <td>
                  <PriorityBadge c={c} />
                </td>
                <td>
                  {assignee ? (
                    <>
                      <span>{shortName(assignee.displayName)}</span>
                      {assignee.id === props.currentUserId ? <span className="sub">You</span> : null}
                    </>
                  ) : (
                    <span className="unassigned">Unassigned</span>
                  )}
                </td>
                <td>
                  <span className={`status status-${c.workflow.status}`}>{STATUS_LABELS[c.workflow.status]}</span>
                  <span className={`sub follow-${fu.tone}`}>{fu.text}</span>
                </td>
                <td className="col-action" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="btn btn-small"
                    aria-label={`Open overview for ${person?.displayName ?? c.id}`}
                    onClick={() => props.onOpen(c.id)}
                  >
                    Overview
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
