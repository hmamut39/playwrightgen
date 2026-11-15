import { checksPhrase } from "@/lib/free-tools/preview-run/checks-phrase";

/**
 * The one sentence a visitor reads about their draft.
 *
 * It sits directly above the code and decides what somebody believes they
 * have. It has been wrong twice, both times by being confident about the
 * wrong thing:
 *
 * - It was a fixed label. A visitor who had just been told "Passed on the
 *   live page · 8 checks" read "Generated, not executed" two lines below, and
 *   the only safe thing to conclude from a product that contradicts itself is
 *   that the better half was boilerplate.
 * - It called a missing credential a failure. A login test whose
 *   `process.env.E2E_PASSWORD` the preview could not supply came back "Ran on
 *   the live page and did not pass", with the real reason printed one line
 *   underneath. Measured against saucedemo.com on 2026-11-15.
 *
 * So it lives here, as a function over what is known, instead of inline in a
 * nine-hundred-line page where it could only be checked by looking.
 */

export type HeadlineRun = {
  verdict: "passed" | "partial" | "failed";
  passed: number;
  checks?: number | null;
};

export function liveRunHeadline(
  run: HeadlineRun | null,
  missingEnvironment: string[] = [],
): string {
  if (!run) return "Generated, not executed · Review before use";

  if (run.verdict === "passed") {
    return `Ran on the live page · ${checksPhrase(run)} passed · Review before use`;
  }

  /*
   * Named before anything else is said about the run.
   *
   * Which value is missing is more use than knowing that something was, and
   * it is checked ahead of "partial" for that reason: a run where nothing
   * failed but the password was skipped is still a run that needs the
   * password, and "some steps could not run" sends nobody anywhere.
   */
  if (missingEnvironment.length > 0) {
    const names = missingEnvironment.join(" and ");
    const them = missingEnvironment.length === 1 ? "it" : "them";
    return (
      `Ran on the live page as far as it could · needs ${names} from your environment, ` +
      `which the preview does not have · Supply ${them} below and run it again`
    );
  }

  // Nothing failed; some steps could not run here. Calling that "did not
  // pass" is the same kind of lie as calling it proven.
  if (run.verdict === "partial") {
    return "Ran on the live page · nothing failed, some steps could not run · Review before use";
  }

  return "Ran on the live page and did not pass · Review before use";
}
