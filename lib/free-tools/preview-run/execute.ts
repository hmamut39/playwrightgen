import "server-only";

import type { Browser, Locator, Page } from "playwright-core";

import { readElementHints } from "@/lib/free-tools/element-hints";
import type { LocatorPlan, Operation, RunPlan, TextMatch } from "@/lib/free-tools/preview-run/plan";

/**
 * Replays a planned draft in a real browser and reports each step.
 *
 * Only the operations the planner produced are performed; nothing from the
 * draft is executed as code. Behaviour follows Playwright's own where it
 * matters to the result: a locator matching several elements is an error
 * (strict mode), assertions retry until a short timeout, and a test stops at
 * its first failure with the rest marked as not reached. Navigation stays on
 * the site of the page the draft was written for. Pattern matching runs inside
 * the remote browser, never on our server, so a hostile regular expression
 * costs the remote page and nothing else.
 */

export type OperationResult = {
  source: string;
  status: "passed" | "failed" | "skipped" | "not_reached";
  detail?: string;
};

export type StepResult = {
  name: string;
  status: "passed" | "failed" | "partial" | "not_reached";
  operations: OperationResult[];
};

export type TestResult = {
  name: string;
  status: "passed" | "failed" | "incomplete";
  steps: StepResult[];
  /** JPEG data URL of the page when the test failed. */
  failureScreenshot?: string;
  /** The page's accessibility tree at the failure, for fixing the step. */
  failureSnapshot?: string;
};

export type PreviewRunResult = {
  tests: TestResult[];
  counts: { passed: number; failed: number; skipped: number; notReached: number };
  durationMs: number;
  timedOut: boolean;
};

const ACTION_TIMEOUT_MS = 7_000;
const ASSERT_TIMEOUT_MS = 5_000;

class StepFailure extends Error {}

function cleanError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text
    .replace(/\[[0-9;]*m/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("at ") && !line.startsWith("="))
    .slice(0, 3)
    .join(" · ")
    .slice(0, 400);
}

function describeMatch(match: TextMatch) {
  return match.kind === "string" ? `"${match.value}"` : `/${match.source}/${match.flags}`;
}

/** Playwright accepts a string or RegExp; the RegExp is evaluated in the browser. */
function toPlaywrightMatch(match: TextMatch): string | RegExp {
  return match.kind === "string" ? match.value : new RegExp(match.source.slice(0, 300), match.flags);
}

function resolveLocator(page: Page, plan: LocatorPlan): Locator {
  let current: Page | Locator = page;
  for (const step of plan) {
    switch (step.by) {
      case "role":
        current = current.getByRole(step.role as Parameters<Page["getByRole"]>[0], {
          ...(step.name ? { name: toPlaywrightMatch(step.name) } : {}),
          ...(step.exact !== undefined ? { exact: step.exact } : {}),
        });
        break;
      case "label":
        current = current.getByLabel(toPlaywrightMatch(step.text), step.exact !== undefined ? { exact: step.exact } : undefined);
        break;
      case "placeholder":
        current = current.getByPlaceholder(toPlaywrightMatch(step.text), step.exact !== undefined ? { exact: step.exact } : undefined);
        break;
      case "text":
        current = current.getByText(toPlaywrightMatch(step.text), step.exact !== undefined ? { exact: step.exact } : undefined);
        break;
      case "testId":
        current = current.getByTestId(step.id);
        break;
      case "css":
        current = current.locator(step.selector);
        break;
      case "first":
        current = (current as Locator).first();
        break;
      case "last":
        current = (current as Locator).last();
        break;
      case "nth":
        current = (current as Locator).nth(step.index);
        break;
      case "filter":
        current = (current as Locator).filter({ hasText: toPlaywrightMatch(step.hasText) });
        break;
    }
  }
  if (!("click" in current) || current === page) throw new StepFailure("the step does not point at an element");
  return current as Locator;
}

/** Compares text inside the remote browser, so a pattern never runs on our server. */
async function textMatches(page: Page, actual: string, expected: TextMatch, mode: "equals" | "contains") {
  if (expected.kind === "string") {
    const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
    return mode === "equals" ? normalize(actual) === normalize(expected.value) : normalize(actual).includes(normalize(expected.value));
  }
  return page.evaluate(
    ([source, flags, text]) => {
      try {
        return new RegExp(source, flags).test(text);
      } catch {
        return false;
      }
    },
    [expected.source.slice(0, 300), expected.flags, actual.slice(0, 20_000)] as const,
  );
}

async function retry(check: () => Promise<boolean>, timeout: number, describe: () => Promise<string>) {
  const deadline = Date.now() + timeout;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
      lastError = null;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new StepFailure(lastError ? cleanError(lastError) : await describe());
}

async function perform(page: Page, operation: Exclude<Operation, { op: "unsupported" }>, baseUrl: URL) {
  if (operation.op === "goto") {
    const target = new URL(operation.url, baseUrl);
    if (target.origin !== baseUrl.origin) {
      throw new StepFailure(`Not opened: ${target.origin} is outside the site this draft was written for.`);
    }
    await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 15_000 });
    return;
  }

  if (operation.op === "action") {
    const locator = resolveLocator(page, operation.locator);
    const options = { timeout: ACTION_TIMEOUT_MS };
    switch (operation.action) {
      case "click": await locator.click(options); break;
      case "dblclick": await locator.dblclick(options); break;
      case "fill": await locator.fill(operation.value ?? "", options); break;
      case "press": await locator.press(operation.value ?? "", options); break;
      case "check": await locator.check(options); break;
      case "uncheck": await locator.uncheck(options); break;
      case "hover": await locator.hover(options); break;
      case "clear": await locator.clear(options); break;
      case "selectOption": await locator.selectOption(operation.value ?? "", options); break;
    }
    return;
  }

  if (operation.subject === "page") {
    const expected = operation.expected;
    const read = operation.matcher === "toHaveURL" ? () => Promise.resolve(page.url()) : () => page.title();
    const wanted = operation.matcher === "toHaveURL" && expected.kind === "string"
      ? { kind: "string" as const, value: new URL(expected.value, baseUrl).toString() }
      : expected;
    await retry(
      async () => (await textMatches(page, await read(), wanted, "equals")) !== operation.negated,
      ASSERT_TIMEOUT_MS,
      async () => `Expected the ${operation.matcher === "toHaveURL" ? "URL" : "title"} ${operation.negated ? "not " : ""}to match ${describeMatch(expected)}, but it was "${(await read()).slice(0, 200)}".`,
    );
    return;
  }

  const locator = resolveLocator(page, operation.locator);
  const negated = operation.negated;
  const expected = operation.expected;
  switch (operation.matcher) {
    case "toBeVisible":
    case "toBeHidden": {
      const wantVisible = (operation.matcher === "toBeVisible") !== negated;
      try {
        await locator.waitFor({ state: wantVisible ? "visible" : "hidden", timeout: ASSERT_TIMEOUT_MS });
      } catch (error) {
        throw new StepFailure(cleanError(error));
      }
      return;
    }
    case "toBeEnabled":
    case "toBeDisabled": {
      const wantEnabled = (operation.matcher === "toBeEnabled") !== negated;
      await retry(async () => (await locator.isEnabled({ timeout: 1_000 })) === wantEnabled, ASSERT_TIMEOUT_MS,
        async () => `Expected the element to be ${wantEnabled ? "enabled" : "disabled"}.`);
      return;
    }
    case "toBeChecked":
      await retry(async () => (await locator.isChecked({ timeout: 1_000 })) !== negated, ASSERT_TIMEOUT_MS,
        async () => `Expected the element ${negated ? "not " : ""}to be checked.`);
      return;
    case "toHaveCount":
      await retry(async () => ((await locator.count()) === expected) !== negated, ASSERT_TIMEOUT_MS,
        async () => `Expected ${negated ? "not " : ""}${String(expected)} matching elements, found ${await locator.count()}.`);
      return;
    case "toHaveText":
    case "toContainText":
    case "toHaveValue":
    case "toHaveClass": {
      const match = expected as TextMatch;
      const read = async () =>
        operation.matcher === "toHaveValue"
          ? locator.inputValue({ timeout: 1_000 })
          : operation.matcher === "toHaveClass"
            ? (await locator.getAttribute("class", { timeout: 1_000 })) ?? ""
            : locator.innerText({ timeout: 1_000 });
      const mode = operation.matcher === "toContainText" ? "contains" : "equals";
      await retry(async () => (await textMatches(page, await read(), match, mode)) !== negated, ASSERT_TIMEOUT_MS,
        async () => {
          const actual = await read().catch(() => "(could not read)");
          return `Expected ${operation.matcher.replace("to", "").replace(/([A-Z])/g, " $1").trim().toLowerCase()} ${negated ? "not " : ""}to match ${describeMatch(match)}, but it was "${actual.slice(0, 200)}".`;
        });
      return;
    }
  }
}

export async function executePreviewRun(
  plan: RunPlan,
  options: { browser: Browser; baseUrl: string; budgetMs?: number },
): Promise<PreviewRunResult> {
  const startedAt = Date.now();
  const deadline = startedAt + (options.budgetMs ?? 75_000);
  const baseUrl = new URL(options.baseUrl);
  const results: TestResult[] = [];
  let timedOut = false;

  for (const test of plan.tests) {
    const working = [
      ...(plan.beforeEach.length ? [{ name: "Setup (beforeEach)", operations: plan.beforeEach }] : []),
      ...test.steps,
    ].map((step) => ({
      name: step.name,
      entries: step.operations.map((operation) => ({
        operation,
        result: { source: operation.source, status: "not_reached" } as OperationResult,
      })),
    }));

    const testResult: TestResult = { name: test.name, status: "passed", steps: [] };
    const context = await options.browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    let failed = false;
    try {
      for (const step of working) {
        let stepFailed = false;
        let skipped = 0;
        for (const { operation, result } of step.entries) {
          if (failed) continue;
          if (Date.now() > deadline) {
            timedOut = true;
            failed = true;
            continue;
          }
          if (operation.op === "unsupported") {
            result.status = "skipped";
            result.detail = operation.reason;
            skipped += 1;
            continue;
          }
          try {
            await perform(page, operation, baseUrl);
            result.status = "passed";
          } catch (error) {
            result.status = "failed";
            result.detail = error instanceof StepFailure ? error.message : cleanError(error);
            stepFailed = true;
            failed = true;
            const shot = await page.screenshot({ type: "jpeg", quality: 55, timeout: 5_000 }).catch(() => null);
            if (shot) testResult.failureScreenshot = `data:image/jpeg;base64,${shot.toString("base64")}`;
            const tree = await page.locator("body").ariaSnapshot({ timeout: 3_000 }).catch(() => null);
            const hints = await readElementHints(page);
            if (tree) {
              testResult.failureSnapshot =
                tree.replace(/^\s*- \/url: .*$/gm, "").slice(0, 6_000) +
                (hints.length ? `\n\n# Controls with test attributes\n${hints.join("\n").slice(0, 4_000)}` : "");
            }
          }
        }
        const operations = step.entries.map((entry) => entry.result);
        testResult.steps.push({
          name: step.name,
          status: stepFailed
            ? "failed"
            : operations.every((result) => result.status === "not_reached")
              ? "not_reached"
              : skipped > 0
                ? "partial"
                : "passed",
          operations,
        });
      }
      testResult.status = failed
        ? "failed"
        : testResult.steps.some((step) => step.status === "partial")
          ? "incomplete"
          : "passed";
    } finally {
      await context.close().catch(() => {});
    }
    results.push(testResult);
  }

  const all = results.flatMap((test) => test.steps.flatMap((step) => step.operations));
  return {
    tests: results,
    counts: {
      passed: all.filter((result) => result.status === "passed").length,
      failed: all.filter((result) => result.status === "failed").length,
      skipped: all.filter((result) => result.status === "skipped").length,
      notReached: all.filter((result) => result.status === "not_reached").length,
    },
    durationMs: Date.now() - startedAt,
    timedOut,
  };
}
