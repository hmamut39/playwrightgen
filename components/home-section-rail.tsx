"use client";

import { useEffect, useState } from "react";

import { SECTION_ICONS, type SectionIconName } from "@/components/section-icons";

/**
 * Where you are on the home page, as a rail down the left margin.
 *
 * Two rounds of the owner's own eyes on it, and both were right.
 *
 * It first collapsed to six faint dashes with no background: on a dark hero
 * they are nearly invisible, nothing said they were a control, and
 * hover-to-discover only works for somebody who already knows it is there.
 * That was the same objection I had raised about the rail this was modelled
 * on, now true of mine.
 *
 * It then became numbers, 01 to 06, in a white panel. "Too simple", and the
 * panel read as a grey smudge against the dark hero -- which the photograph
 * of it showed plainly. A number says how many things there are and nothing
 * about what any of them is.
 *
 * So: an icon per section, from the one vocabulary the header tabs draw from
 * too, on a dark glass panel that belongs to the hero instead of sitting on
 * top of it. The icon says what the section is before any text loads; the
 * active one is cyan with a glow behind it; and hovering anywhere on the rail
 * still opens every label at once, which is the part worth keeping -- one
 * movement to learn the whole page instead of five.
 *
 * **Only where there is margin to put it.** The home page's content is
 * `max-w-7xl`, 1280px, so below about 1440px there is no empty gutter and a
 * fixed rail would sit on the text. `min-[1440px]:block` is where the margin
 * is wider than the rail, measured rather than guessed -- at 1512px the panel
 * ends at 76px and the content starts at 116px. It is also why this is not on
 * the task pages, where a floating index would compete with a form.
 *
 * Labels stay in the DOM when collapsed, clipped by `max-w-0` rather than
 * removed, so each link keeps its accessible name. A box of zero width is not
 * displaying text to anybody, so this product's own layout check does not
 * report them -- see MIN_DISPLAYED_BOX_PX in layout-faults.ts.
 */
export type RailSection = { id: string; label: string; icon: SectionIconName };

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
      className="group fixed left-5 top-1/2 z-30 hidden -translate-y-1/2 min-[1440px]:block"
    >
      <ul className="rounded-2xl border border-white/10 bg-slate-950/85 p-2 shadow-xl shadow-slate-950/20 ring-1 ring-black/5 backdrop-blur-md">
        {sections.map((section) => {
          const active = current === section.id;
          const Icon = SECTION_ICONS[section.icon];
          return (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                aria-current={active ? "true" : undefined}
                /*
                 * A 28px icon tile with px-1/py-1 around it is a 36x36px
                 * target while collapsed, clear of the 24x24px minimum in
                 * WCAG 2.2 (2.5.8). The first real fault this product's own
                 * layout check ever found was a 20px-tall link in its own
                 * footer, so this is measured rather than assumed.
                 */
                className="group/item flex items-center gap-2.5 rounded-xl p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                <span
                  className={`relative grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-all duration-200 ${
                    active
                      ? "bg-cyan-400/15 text-cyan-300 ring-1 ring-cyan-300/30"
                      : "text-slate-400 group-hover/item:bg-white/10 group-hover/item:text-slate-100"
                  }`}
                >
                  {active ? (
                    // A soft bloom behind the active icon, so the rail has a
                    // focal point at a glance and not only on inspection.
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 rounded-lg bg-cyan-400/20 blur-[6px]"
                    />
                  ) : null}
                  <Icon className="relative h-4 w-4" />
                </span>
                <span
                  className={`max-w-0 overflow-hidden whitespace-nowrap text-sm leading-6 opacity-0 transition-all duration-200 group-focus-within:max-w-[13rem] group-focus-within:opacity-100 group-hover:max-w-[13rem] group-hover:opacity-100 ${
                    active ? "font-semibold text-white" : "text-slate-300"
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
