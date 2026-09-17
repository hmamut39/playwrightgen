import { describe, expect, it } from "vitest";

import {
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
