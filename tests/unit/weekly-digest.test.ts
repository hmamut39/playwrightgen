import { describe, expect, it } from "vitest";

import { coverageText, digestText, isQuietWeek, summariseWeek, type WeekAttempt } from "@/lib/services/weekly-digest";

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
    // No standings were passed, so none are invented.
    expect(text).not.toContain("requirements:");
  });

  it("says where the project stands, not only what moved", () => {
    const week = summariseWeek([attempt("a", "Sign in works", "PASSED", day(0))]);
    const line = (coverage: Parameters<typeof coverageText>[0]) =>
      digestText({
        projectName: "Checkout web app",
        liveUrl: "https://shop.example.com/",
        link: "https://playwrightgen.com/workspace/acme/projects/1/health",
        digest: week,
        coverage,
      });

    expect(line({ verified: 9, failing: 1, unverified: 2, stale: 3 })).toContain(
      "12 requirements: 9 verified, 1 failing, 2 not verified. 3 of the verified were last checked over a month ago.",
    );
    // Nothing to report is left unsaid rather than padded with zeroes.
    expect(line({ verified: 4, failing: 0, unverified: 0, stale: 0 })).toContain("4 requirements: 4 verified.");
    expect(line({ verified: 1, failing: 0, unverified: 0, stale: 1 })).toContain(
      "1 requirement: 1 verified. 1 of the verified was last checked over a month ago.",
    );
    // A project with no requirements has no standings to give.
    expect(coverageText({ verified: 0, failing: 0, unverified: 0, stale: 0 })).toBeNull();
  });
});
