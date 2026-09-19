/**
 * Generate, run on the live page, fix the failing step, run again.
 *
 * The three steps already existed as separate buttons, and people pressed them
 * in this order two or three times to get a draft passing. Doing it for them is
 * the difference between "here is a draft" and "here is a test that passes on
 * your page", which is the promise worth paying for.
 *
 * Three properties matter more than cleverness here:
 *
 * - The verifier is not a model. A round ends by replaying the test in a real
 *   browser, so "passed" means it passed, and the run's signed receipt is what
 *   travels with the code afterwards.
 * - The budget is fixed and small. Each fix is a model call out of a visitor's
 *   daily allowance, so the loop stops after a set number of them and says so
 *   rather than grinding through the allowance.
 * - Every round is reported as it happens, including the failures. A loop that
 *   silently retried would hide exactly the evidence the product sells.
 *
 * The loop takes its three operations as dependencies rather than calling fetch
 * itself, so it can be tested without a browser, a model or a network.
 */

export type RunVerdict = "passed" | "partial" | "failed";

export type ProveFailure = { step: string; line: string; reason: string; pageTree: string; skippedEarlier: string[] };

export type ProveRound =
  | { kind: "generating" }
  | { kind: "generated"; title: string }
  | { kind: "running"; attempt: number }
  | { kind: "ran"; attempt: number; verdict: RunVerdict; passed: number; failed: number; skipped: number; failingStep?: string }
  | { kind: "fixing"; attempt: number; failingStep: string }
  | { kind: "fixed"; attempt: number; explanation: string }
  | { kind: "done"; reason: "passed" | "partial" | "out_of_fixes" | "not_fixable" | "limit" | "error"; message?: string };

export type ProveGenerateResult = { ok: true; code: string; title: string; payload: unknown } | { ok: false; limit: boolean; message: string };
export type ProveRunResult =
  | { ok: true; verdict: RunVerdict; passed: number; failed: number; skipped: number; receipt: string | null; failure: ProveFailure | null; payload: unknown }
  | { ok: false; limit: boolean; message: string };
export type ProveFixResult = { ok: true; code: string; explanation: string; payload: unknown } | { ok: false; limit: boolean; message: string };

export type ProveDependencies = {
  generate: () => Promise<ProveGenerateResult>;
  run: (code: string) => Promise<ProveRunResult>;
  fix: (code: string, failure: ProveFailure) => Promise<ProveFixResult>;
  /** Told about each round as it happens, so the page can show progress. */
  report: (round: ProveRound) => void;
};

export type ProveOutcome = {
  /** The code as it stands after the last round, passing or not. */
  code: string | null;
  verdict: RunVerdict | null;
  receipt: string | null;
  fixesUsed: number;
  runs: number;
  stopped: Extract<ProveRound, { kind: "done" }>["reason"];
  message?: string;
  /** The last responses, for the page to show the draft and the run in full. */
  generated: unknown;
  lastRun: unknown;
};

/** The shape of a run this module needs: what each step did, and the page at a failure. */
export type RunLike = {
  tests: Array<{
    steps: Array<{ name: string; operations: Array<{ source: string; status: string; detail?: string }> }>;
    failureSnapshot?: string;
  }>;
};

/**
 * The first failing step, with the page as it was and the earlier lines that
 * could not run, which is everything a fix needs.
 */
export function firstFailureOf(result: RunLike): ProveFailure | null {
  for (const test of result.tests) {
    if (!test.failureSnapshot) continue;
    const operations = test.steps.flatMap((step) => step.operations);
    for (const step of test.steps) {
      const failed = step.operations.find((operation) => operation.status === "failed");
      if (!failed) continue;
      return {
        step: step.name,
        line: failed.source,
        reason: failed.detail ?? "",
        pageTree: test.failureSnapshot,
        skippedEarlier: operations
          .slice(0, Math.max(0, operations.indexOf(failed)))
          .filter((operation) => operation.status === "skipped")
          .map((operation) => operation.source.slice(0, 300))
          .slice(0, 20),
      };
    }
  }
  return null;
}

/** How a run came out, from its counts: the page and the loop agree on this. */
const ERROR_PAGE_TEXT = /(['"`])[^'"`]*\b(404|not found|page not found|500|internal server error|bad gateway|service unavailable)\b[^'"`]*\1/i;

/**
 * Whether code expects an error page -- a "404" heading, "Not Found" text.
 * A test that reaches one opened the wrong address; a fix that makes it
 * expect the error page would turn a broken test into a passing one.
 */
export function assertsErrorPage(code: string) {
  return code.split("\n").some((line) => /\bexpect\s*\(/.test(line) && ERROR_PAGE_TEXT.test(line));
}

export function verdictFromCounts(
  counts: { passed: number; failed: number; skipped: number; notReached: number },
  timedOut: boolean,
): RunVerdict {
  if (counts.failed > 0) return "failed";
  if (counts.skipped > 0 || counts.notReached > 0 || timedOut || counts.passed === 0) return "partial";
  return "passed";
}

/** One generation, then at most `maxFixes` rounds of fix-and-run. */
export async function proveDraftOnLivePage(
  dependencies: ProveDependencies,
  options: { maxFixes?: number } = {},
): Promise<ProveOutcome> {
  const maxFixes = Math.max(0, options.maxFixes ?? 2);
  const { generate, run, fix, report } = dependencies;

  report({ kind: "generating" });
  const generated = await generate();
  if (!generated.ok) {
    const reason = generated.limit ? "limit" : "error";
    report({ kind: "done", reason, message: generated.message });
    return { code: null, verdict: null, receipt: null, fixesUsed: 0, runs: 0, stopped: reason, message: generated.message, generated: null, lastRun: null };
  }
  report({ kind: "generated", title: generated.title });

  let code = generated.code;
  let fixesUsed = 0;
  let runs = 0;
  let lastRun: unknown = null;
  let verdict: RunVerdict | null = null;
  let receipt: string | null = null;

  for (;;) {
    const attempt = runs + 1;
    report({ kind: "running", attempt });
    const outcome = await run(code);
    if (!outcome.ok) {
      const reason = outcome.limit ? "limit" : "error";
      report({ kind: "done", reason, message: outcome.message });
      return { code, verdict, receipt, fixesUsed, runs, stopped: reason, message: outcome.message, generated: generated.payload, lastRun };
    }
    runs += 1;
    lastRun = outcome.payload;
    verdict = outcome.verdict;
    receipt = outcome.receipt;
    report({
      kind: "ran",
      attempt,
      verdict: outcome.verdict,
      passed: outcome.passed,
      failed: outcome.failed,
      skipped: outcome.skipped,
      ...(outcome.failure ? { failingStep: outcome.failure.step } : {}),
    });

    if (outcome.verdict !== "failed") {
      // "partial" means nothing failed but some steps could not run here, which
      // no amount of fixing changes.
      const reason = outcome.verdict === "passed" ? "passed" : "partial";
      report({ kind: "done", reason });
      return { code, verdict, receipt, fixesUsed, runs, stopped: reason, generated: generated.payload, lastRun };
    }
    if (!outcome.failure) {
      report({ kind: "done", reason: "not_fixable", message: "The run failed without a step to fix." });
      return { code, verdict, receipt, fixesUsed, runs, stopped: "not_fixable", generated: generated.payload, lastRun };
    }
    if (fixesUsed >= maxFixes) {
      report({ kind: "done", reason: "out_of_fixes" });
      return { code, verdict, receipt, fixesUsed, runs, stopped: "out_of_fixes", generated: generated.payload, lastRun };
    }

    report({ kind: "fixing", attempt, failingStep: outcome.failure.step });
    const fixed = await fix(code, outcome.failure);
    if (!fixed.ok) {
      const reason = fixed.limit ? "limit" : "error";
      report({ kind: "done", reason, message: fixed.message });
      return { code, verdict, receipt, fixesUsed, runs, stopped: reason, message: fixed.message, generated: generated.payload, lastRun };
    }
    fixesUsed += 1;
    if (assertsErrorPage(fixed.code) && !assertsErrorPage(code)) {
      const message =
        "The page at the failure was an error page, so the test opened the wrong address. The fix tried to expect that error page instead, so it was not kept; check where the test navigates.";
      report({ kind: "done", reason: "not_fixable", message });
      return { code, verdict, receipt, fixesUsed, runs, stopped: "not_fixable", message, generated: generated.payload, lastRun };
    }
    code = fixed.code;
    report({ kind: "fixed", attempt, explanation: fixed.explanation });
  }
}
