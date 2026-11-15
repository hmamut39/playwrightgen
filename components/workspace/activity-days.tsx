"use client";

import { type ReactNode, useSyncExternalStore } from "react";

/**
 * The audit trail, grouped by the reader's own days.
 *
 * This page says, on its own face, that it is the record the audit trail is
 * built from and that nothing in it can be edited or removed. A trail whose
 * dates are a day out is worse than no trail, because it is believed.
 *
 * It has been wrong twice, in opposite directions. On 2026-11-07 it bucketed
 * events by UTC date, built midnight UTC from that string, and formatted that
 * instant in the reader's zone: anywhere west of UTC the heading landed on the
 * previous evening, so a run recorded in New York on Wednesday 28 October at
 * 7:10 PM sat under "TUESDAY, OCTOBER 27" with "7:10 PM" printed beneath it.
 * The heading was then formatted in UTC so that it named the day it had
 * actually grouped -- which fixed the heading and left the buckets wrong:
 * every timestamp on the page renders in the reader's zone, so an event in the
 * small hours UTC still sat under a heading naming a day its own timestamp
 * disagreed with. The contradiction moved; it did not go.
 *
 * Only the browser knows the reader's zone, so the grouping has to happen
 * there. The server renders UTC days, and the first render in the browser
 * matches it -- React calls the server snapshot while hydrating, so the markup
 * lines up -- and then it regroups into local days. The per-event markup is
 * rendered on the server and passed through untouched; only the buckets and
 * their headings are decided here.
 */

const subscribe = () => () => {};

export type ActivityDayEntry = {
  id: string;
  /** The event's instant, as an ISO 8601 string in UTC. */
  iso: string;
  node: ReactNode;
};

/**
 * The calendar day an instant falls on, in a zone, as `YYYY-MM-DD`.
 *
 * Built from `formatToParts` rather than by slicing an ISO string, because
 * slicing an ISO string is how this page answered in UTC while claiming to
 * answer in the reader's zone. `undefined` means the reader's own zone.
 */
export function dayKeyIn(iso: string, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

/** Entries bucketed by day, keeping the order they arrived in. */
export function groupByDay(
  entries: ActivityDayEntry[],
  timeZone?: string,
): Array<{ day: string; entries: ActivityDayEntry[] }> {
  const groups = new Map<string, ActivityDayEntry[]>();
  for (const entry of entries) {
    const day = dayKeyIn(entry.iso, timeZone);
    const bucket = groups.get(day);
    if (bucket) bucket.push(entry);
    else groups.set(day, [entry]);
  }
  return [...groups.entries()].map(([day, grouped]) => ({ day, entries: grouped }));
}

/**
 * The heading over a day's events.
 *
 * `day` is a plain calendar date, so it is formatted as one: midday UTC and
 * read back in UTC, which cannot slip into a neighbouring date whatever zone
 * the reader is in. Getting that wrong is the original bug.
 */
export function dayHeading(day: string, todayKey: string, yesterdayKey: string): string {
  if (day === todayKey) return "Today";
  if (day === yesterdayKey) return "Yesterday";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function ActivityDays({
  entries,
  nowIso,
}: {
  entries: ActivityDayEntry[];
  /** The server's clock, so the server render and the hydrating one agree. */
  nowIso: string;
}) {
  const inBrowser = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  // UTC until the component is running in the browser, where the reader's zone
  // is finally knowable.
  const zone = inBrowser ? undefined : "UTC";
  const now = inBrowser ? new Date() : new Date(nowIso);
  const todayKey = dayKeyIn(now.toISOString(), zone);
  const yesterdayKey = dayKeyIn(new Date(now.getTime() - 86_400_000).toISOString(), zone);
  const days = groupByDay(entries, zone);

  return (
    <div className="mt-8 space-y-8">
      {days.map(({ day, entries: grouped }) => (
        <section key={day}>
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            {dayHeading(day, todayKey, yesterdayKey)}
          </h2>
          <ol className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {grouped.map((entry) => (
              <li key={entry.id} className="border-b border-slate-100 last:border-b-0">
                {entry.node}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
