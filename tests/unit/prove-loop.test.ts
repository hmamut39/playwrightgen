import { describe, expect, it } from "vitest";

import {
  assertsErrorPage,
  environmentNeeded,
  firstFailureOf,
  linesNotRun,
  proveDraftOnLivePage,
  type ProveFailure,
  type ProveRound,
  type ProveRunResult,
} from "@/lib/free-tools/prove-loop";

const failure: ProveFailure = {
  step: "Add the item to the cart",
  line: "await expect(addButton).toBeVisible()",
  reason: "locator.waitFor: Timeout 5000ms exceeded.",
  pageTree: '- button "Add to cart"',
  skippedEarlier: [],
  environmentNeeded: [],
};

const failed = (passed: number): ProveRunResult => ({
  ok: true,
  verdict: "failed",
  passed,
  failed: 1,
  skipped: 0,
  receipt: null,
  failure,
  payload: { round: "failed" },
});
const passedRun: ProveRunResult = {
  ok: true,
  verdict: "passed",
  passed: 12,
  failed: 0,
  skipped: 0,
  receipt: "pwgr1.body.mac",
  failure: null,
  payload: { round: "passed" },
};

function harness(runs: ProveRunResult[]) {
  const rounds: ProveRound[] = [];
  const calls: string[] = [];
  let index = 0;
  return {
    rounds,
    calls,
    dependencies: {
      generate: async () => {
        calls.push("generate");
        return { ok: true as const, code: "draft-0", title: "Adds an item to the cart", payload: { draft: true } };
      },
      run: async (code: string) => {
        calls.push(`run:${code}`);
        return runs[Math.min(index++, runs.length - 1)];
      },
      fix: async (code: string) => {
        calls.push(`fix:${code}`);
        return { ok: true as const, code: `${code}+fix`, explanation: "Used the exact accessible name.", payload: { fixed: true } };
      },
      report: (round: ProveRound) => rounds.push(round),
    },
  };
}

describe("proving a draft on the live page", () => {
  it("stops as soon as a run passes, and reports every round", async () => {
    const { dependencies, rounds, calls } = harness([failed(3), passedRun]);

    const outcome = await proveDraftOnLivePage(dependencies);

    expect(calls).toEqual(["generate", "run:draft-0", "fix:draft-0", "run:draft-0+fix"]);
    expect(outcome).toMatchObject({ code: "draft-0+fix", verdict: "passed", receipt: "pwgr1.body.mac", fixesUsed: 1, runs: 2, stopped: "passed" });
    expect(rounds.map((round) => round.kind)).toEqual([
      "generating", "generated", "running", "ran", "fixing", "fixed", "running", "ran", "done",
    ]);
    expect(rounds[3]).toMatchObject({ verdict: "failed", failingStep: failure.step });
  });

  it("spends no more than the fix budget", async () => {
    const { dependencies, calls } = harness([failed(1)]);

    const outcome = await proveDraftOnLivePage(dependencies, { maxFixes: 2 });

    expect(outcome).toMatchObject({ verdict: "failed", fixesUsed: 2, runs: 3, stopped: "out_of_fixes" });
    expect(calls.filter((call) => call.startsWith("fix")).length).toBe(2);
    expect(outcome.code).toBe("draft-0+fix+fix");
  });

  it("does not try to fix a run that only left steps unrun", async () => {
    const { dependencies } = harness([
      { ok: true, verdict: "partial", passed: 4, failed: 0, skipped: 2, receipt: "pwgr1.partial", failure: null, payload: {} },
    ]);

    const outcome = await proveDraftOnLivePage(dependencies);

    expect(outcome).toMatchObject({ verdict: "partial", fixesUsed: 0, runs: 1, stopped: "partial", receipt: "pwgr1.partial" });
  });

  it("stops on the daily limit and keeps what it had", async () => {
    const rounds: ProveRound[] = [];
    const outcome = await proveDraftOnLivePage({
      generate: async () => ({ ok: true, code: "draft-0", title: "t", payload: {} }),
      run: async () => failed(2),
      fix: async () => ({ ok: false, limit: true, message: "You've used today's 5 free runs of this tool." }),
      report: (round) => rounds.push(round),
    });

    expect(outcome).toMatchObject({ stopped: "limit", code: "draft-0", verdict: "failed", fixesUsed: 0, runs: 1 });
    expect(rounds.at(-1)).toMatchObject({ kind: "done", reason: "limit" });
  });

  it("reports a refused generation without running anything", async () => {
    const calls: string[] = [];
    const outcome = await proveDraftOnLivePage({
      generate: async () => ({ ok: false, limit: false, message: "Quick Generate failed." }),
      run: async () => {
        calls.push("run");
        return passedRun;
      },
      fix: async () => ({ ok: false, limit: false, message: "no" }),
      report: () => {},
    });

    expect(calls).toEqual([]);
    expect(outcome).toMatchObject({ stopped: "error", message: "Quick Generate failed.", code: null, runs: 0 });
  });
});

describe("a fix that expects an error page", () => {
  it("is not kept: the test opened the wrong address", async () => {
    const test = harness([failed(1), passedRun]);
    const outcome = await proveDraftOnLivePage(
      {
        ...test.dependencies,
        fix: async () => ({
          ok: true as const,
          code: "await expect(page.getByRole('heading', { name: '404' })).toBeVisible();",
          explanation: "The page shows a 404 heading.",
          payload: null,
        }),
      },
      { maxFixes: 2 },
    );
    expect(outcome).toMatchObject({ code: "draft-0", verdict: "failed", stopped: "not_fixable", runs: 1 });
    expect(outcome.message).toContain("opened the wrong address");
  });

  it("recognises error-page assertions and nothing else", () => {
    expect(assertsErrorPage("await expect(page.getByText('Page not found')).toBeVisible();")).toBe(true);
    expect(assertsErrorPage('await expect(page).toHaveTitle("500 Internal Server Error");')).toBe(true);
    expect(assertsErrorPage("await page.goto('/404-help');")).toBe(false);
    expect(assertsErrorPage("await expect(page.getByText('Epic sadface: Username is required')).toBeVisible();")).toBe(false);
    expect(assertsErrorPage("await expect(page.getByText('1 item left')).toBeVisible();")).toBe(false);
  });
});

describe("what did not run, and why", () => {
  /**
   * A reviewer facing "3 steps could not run there" beside an Approve button
   * is told that something is missing and not what. The preview recorded a
   * reason for every line it refused; the workspace threw them away and kept
   * the count. The reasons differ in exactly the way the decision turns on:
   * a step that needs a credential will run in the team's own pipeline, and
   * a step the preview cannot replay has been exercised nowhere.
   */
  const run = {
    tests: [
      {
        steps: [
          {
            name: "Sign in",
            operations: [
              { source: "await page.goto('./')", status: "passed" },
              {
                source: "await page.getByLabel('Password').fill(process.env.E2E_PASSWORD)",
                status: "skipped",
                detail: "needs E2E_PASSWORD from your environment",
              },
            ],
          },
          {
            name: "Intercept the order call",
            operations: [
              { source: "await page.route('**/api/orders', route => route.fulfill())", status: "skipped", detail: "page.route() is not run in the preview" },
              { source: "await expect(page.getByText('Thanks')).toBeVisible()", status: "not_reached" },
            ],
          },
        ],
      },
    ],
  };

  it("names each line the preview refused, with its reason", () => {
    expect(linesNotRun(run)).toEqual([
      {
        line: "await page.getByLabel('Password').fill(process.env.E2E_PASSWORD)",
        reason: "needs E2E_PASSWORD from your environment",
      },
      {
        line: "await page.route('**/api/orders', route => route.fulfill())",
        reason: "page.route() is not run in the preview",
      },
    ]);
  });

  it("leaves out the lines a failure stopped, and repeats nothing", () => {
    // "not reached" is a consequence of the failure, not a reason of its own,
    // and the same line refused in two tests is one thing to tell somebody.
    const twice = { tests: [run.tests[0], run.tests[0]] };
    expect(linesNotRun(twice)).toHaveLength(2);
    expect(linesNotRun(run).map((entry) => entry.line)).not.toContain(
      "await expect(page.getByText('Thanks')).toBeVisible()",
    );
    expect(linesNotRun({ tests: [] })).toEqual([]);
  });

  it("stops at a readable number, because this sits inside a review", () => {
    const many = {
      tests: [
        {
          steps: [
            {
              name: "Many",
              operations: Array.from({ length: 30 }, (_, index) => ({
                source: `await page.route('**/api/${index}', r => r.abort())`,
                status: "skipped",
                detail: "page.route() is not run in the preview",
              })),
            },
          ],
        },
      ],
    };
    expect(linesNotRun(many)).toHaveLength(6);
    expect(linesNotRun(many, 2)).toHaveLength(2);
  });
});

/**
 * A password the preview was never given, and the conclusion drawn from it.
 *
 * Walked on 2026-11-15 as a stranger would: "log in with the username
 * standard_user and the password secret_sauce" against saucedemo.com. The
 * generator did the right thing and refused to put the password in the file,
 * emitting process.env.E2E_PASSWORD. The preview has no environment, so it
 * skipped that line and said so beside the step -- "needs E2E_PASSWORD from
 * your environment" -- the login did not happen, and the next step failed on
 * a page that had not changed.
 *
 * The product then spent two fix attempts on it. The second explained,
 * accurately, that the page still read "Epic sadface: Username is required".
 * The third call came back 429. And the heading over the draft said "Ran on
 * the live page and did not pass", of a draft that was not wrong, with the
 * real cause printed one line below it.
 *
 * Nothing in the loop can mend a missing credential, so it stops, says which
 * value it needs, and keeps the allowance.
 */
const skippedForEnvironment = {
  tests: [
    {
      failureSnapshot: '- text "Epic sadface: Username is required"',
      steps: [
        {
          name: "Fill username and password and submit",
          operations: [
            { source: "await page.goto('https://www.saucedemo.com/')", status: "passed" },
            {
              source: "await usernameField.fill(USERNAME)",
              status: "skipped",
              detail: "needs E2E_USERNAME from your environment",
            },
            {
              source: "await passwordField.fill(PASSWORD)",
              status: "skipped",
              detail: "needs E2E_PASSWORD from your environment",
            },
          ],
        },
        {
          name: "Wait for navigation to inventory",
          operations: [
            {
              source: "await expect(page).toHaveURL(/inventory/)",
              status: "failed",
              detail: "expect(page).toHaveURL: Timeout 5000ms exceeded.",
            },
          ],
        },
      ],
    },
  ],
};

describe("a value the preview was never given", () => {
  it("names each variable once, in the order the test needed them", () => {
    expect(environmentNeeded(skippedForEnvironment)).toEqual(["E2E_USERNAME", "E2E_PASSWORD"]);
  });

  it("ignores a step skipped for any other reason", () => {
    expect(
      environmentNeeded({
        tests: [
          {
            steps: [
              {
                name: "Intercept",
                operations: [
                  {
                    source: "await page.route('**/api', (route) => route.fulfill())",
                    status: "skipped",
                    detail: "page.route() is not run in the preview",
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toEqual([]);
  });

  it("carries the variables onto the failure, so a caller cannot miss them", () => {
    const failure = firstFailureOf(skippedForEnvironment);

    expect(failure?.step).toBe("Wait for navigation to inventory");
    expect(failure?.environmentNeeded).toEqual(["E2E_USERNAME", "E2E_PASSWORD"]);
  });

  it("stops rather than spending a fix on it, and says what it needs", async () => {
    const { dependencies, rounds, calls } = harness([
      {
        ok: true as const,
        verdict: "failed" as const,
        passed: 5,
        failed: 1,
        skipped: 2,
        receipt: null,
        failure: firstFailureOf(skippedForEnvironment),
        payload: { round: "needs env" },
      },
    ]);

    const outcome = await proveDraftOnLivePage(dependencies);

    // The allowance is not spent on a cause no fix can remove.
    expect(calls.filter((call) => call.startsWith("fix:"))).toEqual([]);
    expect(outcome.fixesUsed).toBe(0);
    expect(outcome.runs).toBe(1);
    expect(outcome.stopped).toBe("needs_environment");
    // And the message names the values rather than the failing step.
    expect(outcome.message).toContain("E2E_USERNAME");
    expect(outcome.message).toContain("E2E_PASSWORD");
    expect(outcome.message).toContain("The draft is not wrong");

    const done = rounds.find((round) => round.kind === "done");
    expect(done).toMatchObject({ reason: "needs_environment" });
    expect(rounds.some((round) => round.kind === "fixing")).toBe(false);
  });

  it("still fixes an ordinary failure, so the stop is narrow", async () => {
    // The guard must not swallow the loop's whole purpose: a failure with no
    // missing value is repaired exactly as before.
    const { dependencies, calls } = harness([failed(3), passedRun]);

    const outcome = await proveDraftOnLivePage(dependencies);

    expect(calls.filter((call) => call.startsWith("fix:"))).toHaveLength(1);
    expect(outcome.stopped).toBe("passed");
  });
});
