import { describe, expect, it } from "vitest";

import { activityDetail } from "@/lib/activity/detail";
import { toCsv } from "@/lib/services/activity-export";

/**
 * The feed held all of this and printed the verb.
 *
 * Eleven rows reading "received results from CI" told a lead nothing, while
 * the metadata underneath knew that ten of those deliveries recorded nothing.
 * These tests are about what gets said, and about staying quiet when the row
 * does not actually know.
 */
describe("the line of detail behind an activity entry", () => {
  it("names the pipeline and what it recorded", () => {
    expect(
      activityDetail("CI_RESULTS_DELIVERED", {
        provider: "gitlab_ci",
        ref: "release/2026-10",
        recorded: 0,
        total: 3,
      }),
    ).toBe("GitLab CI · release/2026-10 · 0 of 3 recorded");
  });

  it("names the attempt, its result and the commit", () => {
    expect(
      activityDetail("TEST_RUN_ATTEMPT_RECORDED", {
        attemptNumber: 2,
        result: "FAILED",
        provider: "github_actions",
        commitSha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      }),
    ).toBe("attempt 2 · failed · GitHub Actions · a1b2c3d4");
  });

  it("describes generated automation by version and engine", () => {
    expect(
      activityDetail("AUTOMATION_VERSION_GENERATED", {
        versionNumber: 3,
        engine: "PLAYWRIGHT_BROWSER",
        generationStatus: "SUCCEEDED",
      }),
    ).toBe("v3 · Playwright Browser · succeeded");
  });

  it("names the pull request it opened", () => {
    expect(
      activityDetail("AUTOMATION_PULL_REQUEST_OPENED", {
        repository: "acme/web",
        pullRequestNumber: 42,
      }),
    ).toBe("acme/web #42");
  });

  it("says what an import found", () => {
    expect(
      activityDetail("REPOSITORY_IMPORT_COMPLETED", {
        sourceRef: "main",
        commitSha: "f".repeat(40),
        testFileCount: 12,
        discoveredTestCount: 318,
      }),
    ).toBe("main @ ffffffff · 12 test files · 318 tests found");
  });

  it("falls back to the version an event happened to", () => {
    expect(activityDetail("REQUIREMENT_APPROVED", { versionNumber: 4 })).toBe("version 4");
  });

  it("says nothing rather than something empty", () => {
    // These rows are history and outlive the shape that wrote them, so an
    // unexpected or missing field must not produce a confident-looking blank.
    expect(activityDetail("CI_RESULTS_DELIVERED", null)).toBeNull();
    expect(activityDetail("CI_RESULTS_DELIVERED", "not an object")).toBeNull();
    expect(activityDetail("CI_RESULTS_DELIVERED", [1, 2, 3])).toBeNull();
    expect(activityDetail("CI_RESULTS_DELIVERED", {})).toBeNull();
    expect(activityDetail("REQUIREMENT_APPROVED", { versionNumber: "four" })).toBeNull();
    expect(activityDetail("TEST_RUN_ATTEMPT_RECORDED", { result: "   " })).toBeNull();
  });

  it("reports a partial row with the part it has", () => {
    expect(activityDetail("CI_RESULTS_DELIVERED", { provider: "jenkins" })).toBe("Jenkins");
    expect(activityDetail("CI_RESULTS_DELIVERED", { recorded: 2, total: 2 })).toBe(
      "2 of 2 recorded",
    );
  });
});

describe("the trail as a file", () => {
  it("quotes anything a spreadsheet would misread", () => {
    const csv = toCsv([
      ["recorded_at_utc", "actor", "detail"],
      ["2026-10-10T14:39:50.246Z", "Smith, Alex", 'said "no"'],
      ["2026-10-10T14:40:00.000Z", "Line\nbreak", null],
    ]);

    expect(csv).toBe(
      [
        "recorded_at_utc,actor,detail",
        '2026-10-10T14:39:50.246Z,"Smith, Alex","said ""no"""',
        '2026-10-10T14:40:00.000Z,"Line\nbreak",',
      ].join("\r\n"),
    );
  });
});
