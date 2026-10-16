import type { ReactNode } from "react";
import type { QueueCase } from "../domain/types";
import { PRIORITY_TEXT } from "../domain/format";

export function PriorityBadge({ c, showScore = true }: { c: QueueCase; showScore?: boolean }) {
  const a = c.modelAssessment;
  if (a.status === "ready" && a.priority) {
    return (
      <span className={`badge badge-${a.priority.label}`}>
        <span aria-hidden="true">●</span> {PRIORITY_TEXT[a.priority.label]}
        {showScore ? <span className="badge-score"> · {a.priority.score}/100</span> : null}
      </span>
    );
  }
  return (
    <span className="badge badge-none">{a.status === "pending" ? "Assessment pending" : "Assessment unavailable"}</span>
  );
}

export function Checkbox(props: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  count?: number;
  ariaLabel?: string;
}) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={props.checked}
        aria-label={props.ariaLabel}
        ref={(el) => {
          if (el) el.indeterminate = !!props.indeterminate;
        }}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span className="check-label">{props.label}</span>
      {props.count !== undefined ? <span className="count">{props.count}</span> : null}
    </label>
  );
}
