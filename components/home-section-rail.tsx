"use client";

import { useEffect, useState } from "react";

/**
 * Where you are on the home page, as a rail down the left margin.
 *
 * Asked for twice by the owner, after imagium.io, which pins a strip of icons
 * to the left edge and reveals each section's name only when you hover that
 * one icon. Built here with the part that bothered me fixed: hovering
 * anywhere on this rail opens every label at once, so it costs one movement
 * to learn what the page contains instead of five.
 *
 * Collapsed it is a column of dashes, with the section you are in drawn
 * longer and in cyan. That is legible at a glance without reading anything,
 * and it takes a strip of margin the layout was not using.
 *
 * **Only where there is margin to put it.** The home page's content is
 * `max-w-7xl`, 1280px, so below about 1440px there is no empty gutter and a
 * fixed rail would sit on top of the text. `min-[1440px]:block` is the width
 * at which the margin is wider than the rail, and that is a measurement
 * rather than a preference -- which is also why this is not on the task
 * pages, where a floating index would compete with a form.
 *
 * Labels stay in the DOM when collapsed, clipped by `max-w-0` rather than
 * removed, so each link keeps its accessible name. They are not reported by
 * this product's own layout check, because a box of zero width is not
 * displaying text to anybody -- see MIN_DISPLAYED_BOX_PX in layout-faults.ts.
 */
export type RailSection = { id: string; label: string };

export function HomeSectionRail({ sections }: { sections: readonly RailSection[] }) {
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    const targets = sections
      .map((section) => document.getElementById(section.id))
      .filter((element): element is HTMLElement => Boolean(element));
    if (targets.length === 0) return;

    /*
     * The section nearest the top, not the first one touching the viewport.
     * These sections are taller than the screen, so "first intersecting"
     * would mark the next one the moment its top edge appeared at the bottom
     * -- a place the reader has not reached yet.
     */
    const pick = () => {
      let best: string | null = null;
      let bestTop = Number.NEGATIVE_INFINITY;
      for (const target of targets) {
        const top = target.getBoundingClientRect().top - 120;
        if (top <= 0 && top > bestTop) {
          bestTop = top;
          best = target.id;
        }
      }
      setCurrent(best ?? targets[0].id);
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
    <nav
      aria-label="Sections of this page"
      className="group fixed left-4 top-1/2 z-30 hidden -translate-y-1/2 min-[1440px]:block"
    >
      <ul className="rounded-2xl border border-transparent p-1.5 transition-colors duration-200 group-focus-within:border-slate-200 group-focus-within:bg-white/95 group-focus-within:shadow-lg group-focus-within:backdrop-blur group-hover:border-slate-200 group-hover:bg-white/95 group-hover:shadow-lg group-hover:backdrop-blur">
        {sections.map((section) => {
          const active = current === section.id;
          return (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                aria-current={active ? "true" : undefined}
                /*
                 * px-2 and py-1.5 around a 12px dash give a 28x26px target,
                 * which clears the 24x24px minimum in WCAG 2.2 (2.5.8) while
                 * collapsed. The first real fault this product's own layout
                 * check ever found was a 20px-tall link in its own footer, so
                 * this is checked rather than assumed.
                 */
                className="flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-slate-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
              >
                <span
                  aria-hidden="true"
                  className={`h-0.5 shrink-0 rounded-full transition-all duration-200 ${
                    active ? "w-6 bg-cyan-600" : "w-3 bg-slate-400 group-hover:bg-slate-500"
                  }`}
                />
                <span
                  className={`max-w-0 overflow-hidden whitespace-nowrap text-sm leading-6 opacity-0 transition-all duration-200 group-focus-within:max-w-[13rem] group-focus-within:opacity-100 group-hover:max-w-[13rem] group-hover:opacity-100 ${
                    active ? "font-semibold text-slate-950" : "text-slate-600"
                  }`}
                >
                  {section.label}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
