"use client";

import { useSyncExternalStore } from "react";

type Style = "datetime" | "date" | "time";

const OPTIONS: Record<Style, Intl.DateTimeFormatOptions> = {
  datetime: { dateStyle: "medium", timeStyle: "short" },
  date: { dateStyle: "medium" },
  time: { hour: "numeric", minute: "2-digit" },
};

const subscribe = () => () => {};

/**
 * A moment, shown in the reader's own time zone.
 *
 * Pages are rendered on a server that runs in UTC, so every timestamp in the
 * workspace read as UTC with nothing saying so: a run someone had just recorded
 * at nine in the morning appeared to have happened in the middle of the night.
 * For evidence -- "when was this approved, when did it last pass" -- a time
 * that is silently off by hours is worse than no time.
 *
 * The server can only guess, so it renders the UTC time and says it is UTC;
 * once in the browser the same element switches to local time. The full
 * timestamp stays in the `dateTime` attribute and the hover title, so nothing
 * is lost in either form.
 */
export function LocalTime({ value, style = "datetime" }: { value: Date | string; style?: Style }) {
  const date = typeof value === "string" ? new Date(value) : value;
  const inBrowser = useSyncExternalStore(subscribe, () => true, () => false);

  const text = inBrowser
    ? new Intl.DateTimeFormat(undefined, OPTIONS[style]).format(date)
    : `${new Intl.DateTimeFormat("en-US", { ...OPTIONS[style], timeZone: "UTC" }).format(date)} UTC`;

  return (
    <time dateTime={date.toISOString()} title={date.toISOString()}>
      {text}
    </time>
  );
}
