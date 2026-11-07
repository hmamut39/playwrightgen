// PlaywrightGen step recorder.
//
// Download this file from your PlaywrightGen project's Repositories tab and
// commit it beside your pipeline definition, with the other two. The same file
// serves GitHub Actions, GitLab CI and Jenkins.
//
// Why it exists. Playwright's JSON reporter carries no steps at all -- a
// result there has a status, a duration and an error, and nothing about what
// the test actually did. So every result delivered from a pipeline arrived
// with an empty step list, and "explain this failure" had nothing to read for
// the one kind of run it exists for. Steps live only in Playwright's reporter
// API, which is what this is.
//
// It writes one file and never prints to stdout, because the pipeline sends
// Playwright's JSON report there. It is also the only thing it does: sending
// stays in playwrightgen-report.mjs, after the tests, so that nothing about
// reporting can turn a green suite red.
//
// Nothing here leaves your runner. This file only writes to disk.

import { writeFileSync } from "node:fs";

export const STEPS_PATH = "playwrightgen-steps.json";

/**
 * Playwright nests steps: an `expect` inside a `test.step` inside a hook.
 * Flattened, because what a reader of an attempt wants is the order things
 * happened in, and what this product wants to count is how many of them were
 * checks.
 */
function flatten(steps, out) {
  for (const step of steps ?? []) {
    out.push({
      title: String(step.title ?? "").slice(0, 500),
      // "expect" is Playwright's own word for an assertion step. Counting
      // these is how a passing test can be told from a test that checked
      // nothing: both are green, and only one of them proves anything.
      category: String(step.category ?? "").slice(0, 40),
      failed: Boolean(step.error),
    });
    flatten(step.steps, out);
  }
}

export default class PlaywrightGenStepRecorder {
  constructor() {
    this.tests = [];
  }

  onTestEnd(test, result) {
    const steps = [];
    flatten(result.steps, steps);
    this.tests.push({
      // The title is how a result is matched back to the test: the same
      // string Playwright's JSON report carries, including the [pwg:...]
      // marker that ties it to an approved version.
      title: String(test.title ?? "").slice(0, 500),
      status: String(result.status ?? "").slice(0, 40),
      // Hooks and fixtures are not what the test checked, and a reader does
      // not want "Before Hooks" in a list of what happened.
      steps: steps.filter((step) => step.category !== "hook" && step.category !== "fixture").slice(0, 200),
      assertions: steps.filter((step) => step.category === "expect").length,
    });
  }

  onEnd() {
    try {
      writeFileSync(STEPS_PATH, JSON.stringify({ version: 1, tests: this.tests }));
    } catch (error) {
      // Said, not thrown. A suite that ran must not fail because a file could
      // not be written beside it.
      console.error(`PlaywrightGen: could not write ${STEPS_PATH}: ${error.message}`);
    }
  }
}
