import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FlowCircumstance, FlowDoc, FlowKind, FlowSignal, FlowSolution } from "@greenspark/shared";
import { UTILITY_LETTER, groupCircumstances, groupSignals, groupSolutions, nodeKey, type FlowIndex, type Group, type Ref, type Trace } from "./flowModel";

interface Props {
  doc: FlowDoc;
  index: FlowIndex;
  selected: Ref | null;
  trace: Trace | null;
  utility: string;
  showAllLinks: boolean;
  strongOnly: boolean;
  matches: Set<string>;
  readOnly: boolean;
  onSelect: (ref: Ref) => void;
  onAdd: (kind: FlowKind) => void;
}

interface Path { key: string; d: string; supporting: boolean; kind: "signal-circumstance" | "circumstance-solution" }

function Utilities({ utilities, all }: { utilities: string[]; all: string[] }) {
  return (
    <span className="ut" role="img" aria-label={`Applies to: ${utilities.join(", ")}`}>
      {all.map((u) => <i key={u} className={utilities.includes(u) ? "y" : undefined} aria-hidden="true">{UTILITY_LETTER[u] ?? u[0]!.toUpperCase()}</i>)}
    </span>
  );
}

const Node = memo(function Node(props: { kind: FlowKind; id: string; label: string; selected: boolean; on: boolean; match: boolean; onSelect: (ref: Ref) => void; children?: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      className={`fnode ${props.className ?? ""}${props.on ? " on" : ""}${props.selected ? " is-sel" : ""}${props.match ? " match" : ""}`}
      data-node={nodeKey(props.kind, props.id)}
      data-testid={`node-${props.kind}-${props.id}`}
      aria-pressed={props.selected}
      onClick={() => props.onSelect({ kind: props.kind, id: props.id })}
    >
      {props.children}
      <span className="sr-only">{props.label}</span>
    </button>
  );
});

function Lane<T extends { id: string }>(props: { groups: Group<T>[]; render: (item: T) => React.ReactNode }) {
  return (
    <>
      {props.groups.map((g) => (
        <section key={g.id} className="fgroup" aria-label={g.label}>
          <h3 className="glabel"><span>{g.label}</span><span className="gc">{g.items.length}</span></h3>
          <div className="gnodes">{g.items.map((item) => props.render(item))}</div>
        </section>
      ))}
    </>
  );
}

export function FlowBoard(props: Props) {
  const { doc, index, selected, trace, utility, showAllLinks, strongOnly } = props;
  const boardRef = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<Path[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const focus = trace !== null;

  const signalGroups = useMemo(() => groupSignals(doc, utility), [doc, utility]);
  const circGroups = useMemo(() => groupCircumstances(doc, utility), [doc, utility]);
  const solGroups = useMemo(() => groupSolutions(doc, utility), [doc, utility]);

  const visibleLinks = useMemo(() => {
    const shown = new Set<string>();
    for (const g of [...signalGroups, ...circGroups, ...solGroups]) for (const item of g.items as { id: string }[]) shown.add(item.id);
    return index.links.filter((l) => {
      if (strongOnly && l.strength === "supporting") return false;
      const a = l.from.slice(l.from.indexOf(":") + 1), b = l.to.slice(l.to.indexOf(":") + 1);
      return shown.has(a) && shown.has(b);
    });
  }, [index, signalGroups, circGroups, solGroups, strongOnly]);

  const measure = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;
    const box = board.getBoundingClientRect();
    const rects = new Map<string, DOMRect>();
    board.querySelectorAll<HTMLElement>("[data-node]").forEach((el) => rects.set(el.dataset.node!, el.getBoundingClientRect()));
    const next: Path[] = [];
    for (const l of visibleLinks) {
      const a = rects.get(l.from), b = rects.get(l.to);
      if (!a || !b) continue;
      const x1 = a.right - box.left, y1 = a.top + a.height / 2 - box.top, x2 = b.left - box.left, y2 = b.top + b.height / 2 - box.top;
      const dx = (x2 - x1) * 0.5;
      next.push({ key: l.key, d: `M${x1.toFixed(1)} ${y1.toFixed(1)}C${(x1 + dx).toFixed(1)} ${y1.toFixed(1)} ${(x2 - dx).toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`, supporting: l.strength === "supporting", kind: l.kind });
    }
    setPaths(next);
    setSize({ w: box.width, h: box.height });
  }, [visibleLinks]);

  // Links are drawn between the measured positions of the boxes, so measure after every change to the layout.
  useLayoutEffect(() => {
    measure();
    const board = boardRef.current;
    if (!board || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); });
    observer.observe(board);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [measure, doc]);

  const isOn = (kind: FlowKind, id: string) => !!trace?.nodes.has(nodeKey(kind, id));
  const isSel = (kind: FlowKind, id: string) => selected?.kind === kind && selected.id === id;
  const isMatch = (kind: FlowKind, id: string) => props.matches.has(nodeKey(kind, id));
  const count = (groups: Group<{ id: string }>[]) => groups.reduce((n, g) => n + g.items.length, 0);
  const utilities = doc.meta.utilities;

  return (
    <div ref={boardRef} className={`fboard${focus ? " focus" : ""}${!showAllLinks && !focus ? " quiet" : ""}`} id="flow-board">
      <svg className="flinks" width={size.w} height={size.h} aria-hidden="true" focusable="false">
        {paths.map((p) => (
          <path key={p.key} d={p.d} className={`lk ${p.supporting ? "sup " : ""}${p.kind === "signal-circumstance" ? "sc" : "cs"}${trace?.links.has(p.key) ? " on" : ""}`} />
        ))}
      </svg>

      <div className="fhead" style={{ gridColumn: 1 }}>
        <i className="mk acct" aria-hidden="true" /><h2>Signals</h2><span className="n" data-testid="count-signals">{count(signalGroups)}</span>
        <button type="button" className="add-btn" disabled={props.readOnly} onClick={() => props.onAdd("signal")} aria-label="Add a signal">+ Add</button>
      </div>
      <div className="fhead arrow" style={{ gridColumn: 2 }} aria-hidden="true">→</div>
      <div className="fhead" style={{ gridColumn: 3 }}>
        <i className="dot ink" aria-hidden="true" /><h2>Circumstances</h2><span className="n" data-testid="count-circumstances">{count(circGroups)}</span>
        <button type="button" className="add-btn" disabled={props.readOnly} onClick={() => props.onAdd("circumstance")} aria-label="Add a circumstance">+ Add</button>
      </div>
      <div className="fhead arrow" style={{ gridColumn: 4 }} aria-hidden="true">→</div>
      <div className="fhead" style={{ gridColumn: 5 }}>
        <i className="sq" aria-hidden="true" /><h2>Solutions</h2><span className="n" data-testid="count-solutions">{count(solGroups)}</span>
        <button type="button" className="add-btn" disabled={props.readOnly} onClick={() => props.onAdd("solution")} aria-label="Add a solution">+ Add</button>
      </div>

      <div className="flane" style={{ gridColumn: 1 }}>
        <Lane
          groups={signalGroups}
          render={(s: FlowSignal) => (
            <Node key={s.id} kind="signal" id={s.id} label={`Signal: ${s.name}`} selected={isSel("signal", s.id)} on={isOn("signal", s.id)} match={isMatch("signal", s.id)} onSelect={props.onSelect}>
              <i className={`mk ${s.source === "account" ? "acct" : "ask"}`} aria-hidden="true" />
              <span className="nl">{s.name}</span>
              {s.sensitive ? <i className="dot sensitive" aria-label="Sensitive" /> : null}
            </Node>
          )}
        />
      </div>
      <div className="flane" style={{ gridColumn: 3 }}>
        <Lane
          groups={circGroups}
          render={(c: FlowCircumstance) => (
            <Node key={c.id} kind="circumstance" id={c.id} label={`Circumstance: ${c.name}`} className="circ" selected={isSel("circumstance", c.id)} on={isOn("circumstance", c.id)} match={isMatch("circumstance", c.id)} onSelect={props.onSelect}>
              {c.sensitivity !== "standard" ? <i className={`dot ${c.sensitivity}`} aria-label={c.sensitivity === "safety" ? "Safety" : "Sensitive"} /> : null}
              <span className="nl">{c.name}</span>
              <Utilities utilities={c.utilities} all={utilities} />
            </Node>
          )}
        />
      </div>
      <div className="flane" style={{ gridColumn: 5 }}>
        <Lane
          groups={solGroups}
          render={(s: FlowSolution) => (
            <Node key={s.id} kind="solution" id={s.id} label={`Solution: ${s.name}`} className="sol" selected={isSel("solution", s.id)} on={isOn("solution", s.id)} match={isMatch("solution", s.id)} onSelect={props.onSelect}>
              <span className="nl">{s.name}</span>
              <span className="sub">{s.provider}{!s.verified ? <span className="uc"> · not re-checked</span> : null}</span>
            </Node>
          )}
        />
      </div>
    </div>
  );
}

