"use client";

import { useEffect, useState } from "react";

/**
 * Where you are in a long page, and how to get to the rest of it.
 *
 * Prompted by the rail on imagium.io, which pins a strip of icons to the left
 * edge and reveals each section's name only when you hover it. The idea is
 * right -- a long page should say what it contains -- and the execution costs
 * the reader five hovers to learn what a list of words would have told them at
 * a glance. So this is the same idea in words.
 *
 * It is only worth putting on a page somebody reads top to bottom. A page with
 * a form on it is a page where a floating index competes with the work, which
 * is why this is not in the site layout and has to be asked for.
 *
 * The current section is tracked rather than guessed: reading which heading is
 * nearest the top needs the browser, so this is the one piece that cannot be
 * rendered on the server. It renders the full list either way, so a reader
 * with no JavaScript loses the highlight and keeps every link.
 */
export type PageSection = { id: string; label: string };

export function PageSectionIndex({ sections }: { sections: readonly PageSection[] }) {
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    const headings = sections
      .map((section) => document.getElementById(section.id))
      .filter((element): element is HTMLElement => Boolean(element));
    if (headings.length === 0) return;

    /*
     * The heading nearest the top of the viewport, not the first one
     * intersecting it. A tall section keeps its own heading off screen while
     * the reader is still inside it, and "first intersecting" would then
     * highlight the next section the moment its heading appeared at the
     * bottom edge -- marking a place the reader has not reached.
     */
    const pick = () => {
      let best: string | null = null;
      let bestTop = Number.NEGATIVE_INFINITY;
      for (const heading of headings) {
        const top = heading.getBoundingClientRect().top - 96;
        if (top <= 0 && top > bestTop) {
          bestTop = top;
          best = heading.id;
        }
      }
      setCurrent(best ?? headings[0].id);
    };

    pick();
    window.addEventListener("scroll", pick, { passive: true });
    window.addEventListener("resize", pick);
    return () => {
      window.removeEventListener("scroll", pick);
      window.removeEventListener("resize", pick);
    };
  }, [sections]);

  return (
    /*
     * `self-start` is what makes `sticky` work here, and it is not optional.
     *
     * A grid item stretches to its row by default, so this box was already as
     * tall as the whole article: sticky had nothing to pin, and the list
     * simply scrolled away inside a full-height box. Verified by screenshot
     * on 2026-11-26 -- the index was correct at the top of the page and gone
     * by the time the reader needed it. With the box sized to its content, it
     * pins at top-24, which clears the sticky site header.
     */
    <nav aria-label="On this page" className="lg:sticky lg:top-24 lg:self-start">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">On this page</p>
      <ul className="mt-3 space-y-0.5">
        {sections.map((section) => {
          const active = current === section.id;
          return (
            <li key={section.id}>
              {/*
                * py-1.5 is not decoration: these are 20px of text, and a link
                * that small was the first real fault this product's own
                * layout check found, in its own footer, on 2026-11-26. The
                * minimum is 24x24px -- WCAG 2.2 (2.5.8).
                */}
              <a
                href={`#${section.id}`}
                aria-current={active ? "true" : undefined}
                className={`block rounded-lg px-3 py-1.5 text-sm leading-6 transition ${
                  active
                    ? "bg-slate-100 font-semibold text-slate-950"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                }`}
              >
                {section.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
