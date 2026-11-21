import { checksPhrase } from "@/lib/free-tools/preview-run/checks-phrase";

/**
 * The badge over a generated test, saying how its run on the real page went.
 *
 * Three verdicts, and until now they counted two different things. "Passed"
 * used `checksPhrase`, which says assertions -- the number a tester would
 * count. "Partly run" used `liveRun.passed`, which is every operation the
 * runner performed: a goto, a fill and a press are each one.
 *
 * So a partial run showed **"Partly run on the live page · 16 passed"**
 * directly above the sentence **"5 checks passed, 2 steps could not run
 * there"**. Sixteen and five, on one screen, about one run, with nothing to
 * tell a reader that one is operations and the other assertions. Found on
 * 2026-11-21 by walking a new team from an empty project to a generated test
 * and reading the screen it ends on.
 *
 * This is the same fault `checksPhrase` was written to fix. Its own comment
 * says it: "In a testing product a check is an assertion, and the number
 * beside the product's most load-bearing claim has to be the one a tester
 * would count." One branch was corrected then and the other was not, which is
 * what happens when the rule lives in a helper that each caller may or may
 * not reach for.
 */
export type LiveRunBadge = { text: string; tone: "passed" | "partial" | "failed" };

export function automationLiveRunBadge(run: {
  verdict: "passed" | "partial" | "failed";
  passed: number;
  checks?: number | null;
  notRun?: number;
}): LiveRunBadge {
  if (run.verdict === "passed") {
    return { text: `Passed on the live page · ${checksPhrase(run)}`, tone: "passed" };
  }

  if (run.verdict === "partial") {
    // The same unit as the sentence underneath it, and the part that makes
    // "partly" mean something: how much did not run.
    const notRun = run.notRun ?? 0;
    const rest = notRun > 0 ? `, ${notRun} step${notRun === 1 ? "" : "s"} could not run` : "";
    return { text: `Partly run on the live page · ${checksPhrase(run)} passed${rest}`, tone: "partial" };
  }

  return { text: "Did not pass on the live page", tone: "failed" };
}
