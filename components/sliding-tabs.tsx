"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The header's tab group, with the active pill sliding between tabs.
 *
 * It was already a segmented control -- the active tab a white pill with a
 * shadow, the rest plain text -- which is a good deal more than the plain
 * links most sites use. What it did not do is connect one state to the next:
 * the pill vanished from one tab and reappeared on another, so nothing told
 * the eye that the two were the same thing in a new place.
 *
 * One pill, moved. Which is cheap to say and needs real measurement, because
 * the tabs are text of six different widths and nothing knows how wide
 * "Coverage Review" renders until it has rendered.
 *
 * **Three states it has to survive.** Before measurement, on the server and
 * on the first paint, there is no pill and the active tab carries its own
 * colour, so the control is correct with no JavaScript at all and never
 * paints a pill in the wrong place. After measurement it fades in behind the
 * active tab. And on resize or a font swap the measurement is taken again,
 * because a pill that is accurate only at the width it was measured at is
 * worse than no pill.
 */
export type SlidingTab = { href: string; label: string; match: string };

export function SlidingTabs({
  tabs,
  pathname,
}: {
  tabs: readonly SlidingTab[];
  pathname: string;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  const activeHref = tabs.find((tab) => tab.match === pathname)?.href ?? null;

  const measure = useCallback(() => {
    if (!activeHref) {
      setPill(null);
      return;
    }
    const element = tabRefs.current[activeHref];
    const list = listRef.current;
    if (!element || !list) {
      setPill(null);
      return;
    }
    const tab = element.getBoundingClientRect();
    const container = list.getBoundingClientRect();
    setPill({ left: tab.left - container.left, width: tab.width });
  }, [activeHref]);

  /*
   * One observer instead of three code paths.
   *
   * The pill has to be measured on mount, again when the window resizes, and
   * again when a web font swaps in and silently changes every tab's width --
   * that last one fires no event of its own, and a pill measured before the
   * swap is wrong by a few pixels on every tab afterwards.
   *
   * A ResizeObserver covers all three: it delivers an entry as soon as it
   * observes, and again whenever the box it is watching changes size for any
   * reason. It also keeps the measurement out of the effect body, which the
   * React Compiler rightly refuses -- setting state synchronously during an
   * effect is what makes a layout twitch on load.
   */
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(list);
    const active = activeHref ? tabRefs.current[activeHref] : null;
    if (active) observer.observe(active);
    return () => observer.disconnect();
  }, [measure, activeHref]);

  return (
    <div
      ref={listRef}
      className="relative hidden items-center gap-1 rounded-2xl border border-slate-200 bg-slate-100/70 p-1 lg:flex"
    >
      {/*
        * The pill itself: behind the labels, and inert to the pointer so it
        * cannot swallow a click meant for a tab.
        */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-1 top-1 rounded-xl bg-white shadow-sm ring-1 ring-slate-900/5 transition-all duration-300 ease-out"
        style={
          pill
            ? { left: pill.left, width: pill.width, opacity: 1 }
            : { left: 0, width: 0, opacity: 0 }
        }
      />
      {tabs.map((tab) => {
        const active = tab.match === pathname;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            ref={(element) => {
              tabRefs.current[tab.href] = element;
            }}
            aria-current={active ? "page" : undefined}
            className={`relative z-10 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors duration-200 ${
              active ? "text-slate-950" : "text-slate-600 hover:text-slate-950"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
