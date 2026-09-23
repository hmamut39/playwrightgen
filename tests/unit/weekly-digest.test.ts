import { describe, expect, it } from "vitest";

import { digestText, isQuietWeek, summariseWeek, type WeekAttempt } from "@/lib/services/weekly-digest";

const day = (index: number, minutes = 0) =>
  new Date(Date.UTC(2026, 8, 14 + index, 6, minutes));

const attempt = (testCaseId: string, title: string, result: string, executedAt: Date): WeekAttempt => ({
  testCaseId,
  title,
  result,
  executedAt,
});

describe("a week of daily checks, in one message", () => {
  it("separates what broke, came back, stayed broken and passed all week", () => {
    const digest = summariseWeek([
      // Passing all week.
      attempt("a", "Sign in works", "PASSED", day(0)),
      attempt("a", "Sign in works", "PASSED", day(1)),
      // Was passing, now failing.
      attempt("b", "Checkout completes", "PASSED", day(0)),
      attempt("b", "Checkout completes", "FAILED", day(2)),
      // Was failing, now passing.
      attempt("c", "Search returns results", "FAILED", day(0)),
      attempt("c", "Search returns results", "PASSED", day(2)),
      // Failing every day.
      attempt("d", "Export downloads", "FAILED", day(0)),
      attempt("d", "Export downloads", "FAILED", day(2)),
    ]);

    expect(digest).toMatchObject({
      broke: ["Checkout completes"],
      recovered: ["Search returns results"],
      stillFailing: ["Export downloads"],
      flaky: [],
      steady: 1,
      checked: 4,
    });
  });

  it("calls a failure and its retry flaky, not a recovery, even when the week ends green", () => {
    const digest = summariseWeek([
      attempt("a", "Adds a todo", "PASSED", day(0)),
      // Same round: failed, then passed four minutes later.
      attempt("a", "Adds a todo", "FAILED", day(3)),
      attempt("a", "Adds a todo", "PASSED", day(3, 4)),
    ]);

    expect(digest.flaky).toEqual(["Adds a todo"]);
    expect(digest.recovered).toEqual([]);
    expect(digest.steady).toBe(0);
    expect(isQuietWeek(digest)).toBe(false);
  });

  it("says nothing happened when nothing did", () => {
    const quiet = summariseWeek([
      attempt("a", "Sign in works", "PASSED", day(0)),
      attempt("a", "Sign in works", "PASSED", day(1)),
    ]);
    expect(isQuietWeek(quiet)).toBe(true);
    expect(summariseWeek([])).toMatchObject({ checked: 0, steady: 0 });
  });

  it("writes a message a person can act on", () => {
    const text = digestText({
      projectName: "Checkout web app",
      liveUrl: "https://shop.example.com/",
      link: "https://playwrightgen.com/workspace/acme/projects/1/health",
      digest: summariseWeek([
        attempt("b", "Checkout completes", "PASSED", day(0)),
        attempt("b", "Checkout completes", "FAILED", day(2)),
        attempt("a", "Sign in works", "PASSED", day(0)),
      ]),
    });

    expect(text).toContain("week in review -- Checkout web app");
    expect(text).toContain("2 tests checked daily; 1 passed every time.");
    expect(text).toContain("Broke this week (1):\n- Checkout completes");
    expect(text).toContain("Evidence: https://playwrightgen.com/workspace/acme/projects/1/health");
    // Nothing recovered, so that heading is not there at all.
    expect(text).not.toContain("Passing again");
  });
});
