import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ActivityDays } from "@/components/workspace/activity-days";

/**
 * What the server sends for the audit trail.
 *
 * The grouping had to move to the browser, because only the browser knows the
 * reader's time zone. That leaves a render the server has to produce anyway,
 * and which the first render in the browser has to match while hydrating --
 * so it must be decided by something fixed rather than by the server's own
 * idea of today. It is UTC, and `nowIso` is passed in rather than read from
 * the clock, so the markup is the same whenever it is produced.
 *
 * Nothing here can catch a hydration mismatch; that needs a browser. What it
 * can catch is the server render drifting from UTC, which is what the
 * mismatch would be.
 */
const row = (id: string, iso: string, text: string) => ({
  id,
  iso,
  node: <span>{text}</span>,
});

const render = (nowIso: string, entries: ReturnType<typeof row>[]) =>
  renderToStaticMarkup(<ActivityDays nowIso={nowIso} entries={entries} />);

const headings = (html: string) =>
  [...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((match) => match[1]);

describe("the activity trail as the server sends it", () => {
  it("buckets by UTC day, whatever the machine's own zone is", () => {
    const before = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const html = render("2026-11-07T12:00:00.000Z", [
        row("late", "2026-10-29T02:30:00.000Z", "a late run"),
        row("afternoon", "2026-10-28T19:00:00.000Z", "an afternoon run"),
      ]);

      // Two UTC days, so two sections. In the reader's zone these are one day
      // and the browser will say so -- but the server cannot know that, and
      // guessing is what produced a heading above a timestamp that disagreed
      // with it.
      expect(headings(html)).toHaveLength(2);
      expect(headings(html)[0]).toContain("October 29");
      expect(headings(html)[1]).toContain("October 28");
    } finally {
      process.env.TZ = before;
    }
  });

  it("calls the UTC day of nowIso Today, not the day the machine is having", () => {
    const html = render("2026-11-07T01:00:00.000Z", [
      row("now", "2026-11-07T00:30:00.000Z", "just now"),
      row("before", "2026-11-06T23:30:00.000Z", "half an hour earlier"),
    ]);

    expect(headings(html)).toEqual(["Today", "Yesterday"]);
  });

  it("passes the rows through in the order it was given them", () => {
    const html = render("2026-11-07T12:00:00.000Z", [
      row("a", "2026-11-07T10:00:00.000Z", "newest"),
      row("b", "2026-11-07T09:00:00.000Z", "middle"),
      row("c", "2026-11-07T08:00:00.000Z", "oldest"),
    ]);

    expect(html.indexOf("newest")).toBeLessThan(html.indexOf("middle"));
    expect(html.indexOf("middle")).toBeLessThan(html.indexOf("oldest"));
    // One section, three rows: the markup the server-rendered content sits in.
    expect(headings(html)).toEqual(["Today"]);
    expect([...html.matchAll(/<li/g)]).toHaveLength(3);
  });

  it("renders nothing rather than an empty day when there is nothing to show", () => {
    const html = render("2026-11-07T12:00:00.000Z", []);

    expect(headings(html)).toEqual([]);
    expect(html).not.toContain("<li");
  });
});
