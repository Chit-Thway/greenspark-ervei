import { useEffect, useRef } from "react";
import type { Catalog, CaseItem } from "../data/api";
import { describeFollowUp, shortName, STATUS_LABELS } from "../domain/format";
import { isResolved } from "../domain/query";
import { accountHref, isModifiedClick } from "../route";
import { PriorityBadge } from "./Primitives";

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
            <th scope="col">Priority{data.circumstanceSource === "flow" ? null : <> <span className="sim">simulated</span></>}</th>
            <th scope="col">Support needs</th>
            <th scope="col">Assigned to</th>
            <th scope="col">Status / follow-up</th>
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
                <td data-label="Support needs">
                  {labels.length ? (
                    <>
                      <span>{labels[0]}</span>
                      {labels.length > 1 ? <span className="sub">+ {labels.length - 1} more</span> : null}
                    </>
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
