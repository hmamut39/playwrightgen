import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The files a customer commits into their own repository.
 *
 * Nothing else in this suite runs them: they execute on somebody else's
 * runner, days later, and a mistake here is discovered by a stranger whose
 * first impression of this product is a red pipeline. Two copies exist on
 * purpose -- the downloadable templates, and the standalone example
 * repository under `examples/ci-proof` -- which is exactly the shape that
 * drifts, so what matters is checked in both.
 *
 * What is checked is what a first push depends on, not the whole file:
 *
 *  - A repository has no tests until the first generated one is pasted in,
 *    and Playwright treats finding none as an error. Without
 *    `--pass-with-no-tests` the very first push fails before anything has
 *    been generated, which reads as "this does not work" rather than "there
 *    is nothing to run yet". Found on 2026-10-17 by running the example's
 *    own configuration against its empty tests folder.
 *  - The reporter is a module that runs under plain Node on three different
 *    CI systems, so it has to parse.
 */
const root = resolve(__dirname, "..", "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

const PIPELINES = [
  "templates/github-actions/playwrightgen.yml",
  "templates/gitlab-ci/playwrightgen.gitlab-ci.yml",
  "templates/jenkins/Jenkinsfile.playwrightgen",
  "examples/ci-proof/.github/workflows/playwrightgen.yml",
];

const REPORTERS = [
  "templates/github-actions/playwrightgen-report.mjs",
  "examples/ci-proof/.github/workflows/playwrightgen-report.mjs",
];

describe("the pipeline files a team commits", () => {
  it("does not fail a repository for having no tests yet", () => {
    for (const file of PIPELINES) {
      const source = read(file);
      const invocations = source.match(/npx playwright test[^\n'"]*/g) ?? [];
      expect(invocations.length, `${file} runs no Playwright at all`).toBeGreaterThan(0);
      for (const invocation of invocations) {
        expect(invocation, `${file}: ${invocation}`).toContain("--pass-with-no-tests");
      }
    }
  });

  it("still decides the job's own result from the tests", () => {
    // Passing with no tests must not become passing with failing tests: each
    // pipeline keeps its own check on the run's outcome after reporting.
    expect(read(PIPELINES[0])).toContain("steps.playwright.outcome == 'failure'");
    expect(read(PIPELINES[1])).toContain('test "$(cat .playwrightgen-outcome)" = "passed"');
    expect(read(PIPELINES[2])).toContain("PLAYWRIGHTGEN_OUTCOME");
    expect(read(PIPELINES[3])).toContain("steps.playwright.outcome == 'failure'");
  });

  it("ships reporters that parse under plain Node", () => {
    for (const file of REPORTERS) {
      expect(() => execFileSync(process.execPath, ["--check", join(root, file)]), file).not.toThrow();
    }
  });

  it("says on the run's own page when nothing was recorded", () => {
    // The answer to "did my push record anything" was in a collapsed step
    // log. Both copies now write one line where the pipeline shows it first.
    for (const file of REPORTERS) {
      const source = read(file);
      expect(source, file).toContain("GITHUB_STEP_SUMMARY");
      expect(source, file).toContain("no tests ran");
      // Best effort: a summary that cannot be written must not break the run.
      expect(source, file).toMatch(/try\s*\{[\s\S]{0,200}appendFileSync[\s\S]{0,200}catch/);
    }
  });
});
