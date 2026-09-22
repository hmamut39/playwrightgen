import { afterAll, describe, expect, it } from "vitest";

import { generateAutomation } from "@/lib/ai/automation-generation";
import { generateQuickDraft } from "@/lib/ai/quick-generation";
import { alignRootNavigation } from "@/lib/free-tools/navigation";
import { capturePageSnapshot } from "@/lib/free-tools/page-snapshot";
import { runVerdict } from "@/lib/free-tools/preview-run/receipt";
import { firstFailureOf } from "@/lib/free-tools/prove-loop";
import { executeLiveRun, prepareLiveRun } from "@/lib/free-tools/preview-run/run-draft";
import { alignContainerNames, alignTestIdLocators, siteTestIdAttribute } from "@/lib/free-tools/test-id-attribute";

/**
 * Do generated tests pass on the real page the first time, before any fix?
 *
 * Every other eval grades the text a model returns. This one runs it: each
 * generator writes a test from a live page, the test is replayed in the remote
 * browser, and the first run's verdict is the grade. The page deliberately sits
 * in a folder (/todomvc/), because that is where a test that opens '/' lands on
 * the site root instead -- a bug that went unnoticed while the demos were
 * site roots. It records whether the model itself wrote '/', separately from
 * whether the shipped pipeline (which rewrites it) passed, so a prompt
 * regression shows even while the safety net hides it.
 *
 * Needs OPENAI_API_KEY and the remote browser; costs two generations.
 */

const PAGE = "https://demo.playwright.dev/todomvc/";
const ROOT_GOTO = /\.goto\(\s*(['"`])\/(?:[?#][^'"`]*)?\1/;

const results: Array<{ id: string; verdict: string; modelWroteRoot: boolean; checks: number; failure?: string | null }> = [];

async function firstRun(code: string, pageUrl: string) {
  const prepared = prepareLiveRun({ code, pageUrl });
  if (!prepared.ok) throw new Error(prepared.error);
  const { result } = await executeLiveRun(prepared.run);
  const failure = firstFailureOf(result);
  return {
    verdict: runVerdict(result),
    checks: result.counts.passed,
    // Printed on a failure, so a red eval says which step and why.
    failure: failure ? `${failure.step}: ${failure.line} -- ${failure.reason}`.slice(0, 200) : null,
  };
}

const ready = Boolean(process.env.OPENAI_API_KEY?.trim() && process.env.BROWSERLESS_API_KEY?.trim());

describe.skipIf(!ready)("eval: generated tests pass on a page in a folder", () => {
  afterAll(() => {
    console.log(`\n  live-page eval: ${results.filter((entry) => entry.verdict !== "failed").length}/${results.length} passed on the first run`);
    for (const entry of results) {
      console.log(`   ${entry.verdict.toUpperCase().padEnd(7)} ${entry.id}  checks=${entry.checks}  model wrote goto('/')=${entry.modelWroteRoot}`);
      if (entry.failure) console.log(`           ${entry.failure}`);
    }
  });

  it("Quick Generate", async () => {
    const snapshot = await capturePageSnapshot(PAGE);
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    const draft = await generateQuickDraft({
      mode: "FLOW",
      request: "Add a todo called Buy milk and check it is listed with 1 item left.",
      pageUrl: PAGE,
      depth: "FOCUSED",
      fileContext: "",
      imageDataUrls: [],
      pageSnapshot: snapshot,
    });
    // The shipped draft is already aligned, so the model's own '/' cannot be seen here.
    expect(draft.code).not.toMatch(ROOT_GOTO);
    const run = await firstRun(draft.code, snapshot.finalUrl);
    results.push({ id: "quick-generate", verdict: run.verdict, modelWroteRoot: false, checks: run.checks, failure: run.failure });
    expect(run.verdict).not.toBe("failed");
  }, 240_000);

  it("workspace automation", async () => {
    const snapshot = await capturePageSnapshot(PAGE);
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    const output = await generateAutomation({
      engine: "PLAYWRIGHT_BROWSER",
      title: "A visitor adds a todo and sees it in the list",
      objective: "Adding a todo lists it and updates the items-left counter.",
      preconditions: "The list is empty.",
      steps: ["Type Buy milk into the new todo field", "Press Enter"],
      expectedResults: ["Buy milk is listed", "The counter shows 1 item left"],
      testType: "END_TO_END",
      priority: "HIGH",
      tags: [],
      guidance: "",
      pageSnapshot: snapshot,
    });
    const modelWroteRoot = ROOT_GOTO.test(output.code);
    // The same corrections the service makes before it runs the code.
    const aligned = alignTestIdLocators(output.code, siteTestIdAttribute(snapshot.elementHints)).code;
    const code = alignRootNavigation(alignContainerNames(aligned, snapshot.aria).code, PAGE).code;
    const run = await firstRun(code, PAGE);
    results.push({ id: "workspace-automation", verdict: run.verdict, modelWroteRoot, checks: run.checks, failure: run.failure });
    expect(run.verdict).not.toBe("failed");
  }, 240_000);
});
