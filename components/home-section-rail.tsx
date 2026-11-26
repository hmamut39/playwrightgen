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
 * **Numbers, not dashes, and the panel is always there.** The first version
 * collapsed to six faint dashes with no background, and the owner said what
 * was true of it: on a dark hero they are nearly invisible, nothing says they
 * are a control, and hover-to-discover only works for somebody who already
 * knows it is there. That is the same objection I had raised about the rail
 * this was modelled on.
 *
 * So it carries its panel at all times, and each section is numbered. A
 * numbered column in a margin reads as "six sections, you are on the second"
 * without hovering anything or decoding an icon, and 01/02/03 badges are
 * already how this product numbers steps on the home page and on /mcp.
 * Labels still open on hover, over the content, which is what a transient
 * popover is for -- the permanently-labelled version would need about 1660px
 * of viewport before it stopped sitting on the text.
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
      <ul className="rounded-2xl border border-slate-200/80 bg-white/90 p-1.5 shadow-md backdrop-blur transition-shadow duration-200 group-focus-within:shadow-lg group-hover:shadow-lg">
        {sections.map((section, index) => {
          const active = current === section.id;
          return (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                aria-current={active ? "true" : undefined}
                /*
                 * A 24px number badge with px-1.5/py-1 around it is a 36x32px
                 * target while collapsed, clear of the 24x24px minimum in
                 * WCAG 2.2 (2.5.8). The first real fault this product's own
                 * layout check ever found was a 20px-tall link in its own
                 * footer, so this is measured rather than assumed.
                 */
                className="flex items-center gap-2.5 rounded-xl px-1.5 py-1 transition-colors hover:bg-slate-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
              >
                <span
                  aria-hidden="true"
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[11px] font-bold tabular-nums transition-colors duration-200 ${
                    active
                      ? "bg-cyan-600 text-white"
                      : "bg-slate-100 text-slate-500 group-hover:bg-slate-200/80"
                  }`}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
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
