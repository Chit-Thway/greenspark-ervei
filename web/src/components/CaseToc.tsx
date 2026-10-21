import { useEffect, useState } from "react";

export interface TocItem { id: string; label: string }

/**
 * "On this page" links for the case page. Each item is the id of a section heading. The link scrolls to the
 * section and moves focus to its heading (so keyboard and screen-reader users land there too) without changing
 * the URL. The section being read is marked as current.
 */
export function CaseToc({ items }: { items: TocItem[] }) {
  const [current, setCurrent] = useState<string | null>(items[0]?.id ?? null);
  const key = items.map((i) => i.id).join(",");

  // Current = the first section, in reading order, that is in the top part of the window.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const band = window.innerHeight * 0.45;
      const first = items.find((i) => {
        const el = document.getElementById(i.id);
        const r = (el?.closest("section") ?? el)?.getBoundingClientRect();
        return r && r.top < band && r.bottom > 0;
      });
      if (first) setCurrent(first.id);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); cancelAnimationFrame(frame); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const jump = (id: string) => {
    const heading = document.getElementById(id);
    if (!heading) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    (heading.closest("section") ?? heading).scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
    setCurrent(id);
  };

  return (
    <nav className="case-toc" aria-label="On this page">
      <p className="case-toc-title">On this page</p>
      <ul>
        {items.map((i) => (
          <li key={i.id}>
            <a
              href={`#${i.id}`}
              aria-current={current === i.id ? "location" : undefined}
              onClick={(e) => { e.preventDefault(); jump(i.id); }}
            >
              {i.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
