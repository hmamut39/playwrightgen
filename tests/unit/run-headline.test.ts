import { describe, expect, it } from "vitest";

import { liveRunHeadline } from "@/lib/free-tools/preview-run/run-headline";

/**
 * The sentence above the draft, which is what a visitor walks away believing.
 *
 * It has been wrong twice. It was a fixed label, so it read "Generated, not
 * executed" two lines under "Passed on the live page · 8 checks". Then it
 * called a missing credential a failure: a login test the preview could not
 * run without E2E_PASSWORD came back "did not pass", with the real reason
 * printed one line below it.
 *
 * Both were visible to anyone who looked at the page and invisible to the
 * test suite, because the sentence was built inline in a nine-hundred-line
 * component. These assert the exact words, since the exact words are the
 * product here.
 */
describe("what the page says about a draft", () => {
  it("says nothing ran when nothing ran", () => {
    expect(liveRunHeadline(null)).toBe("Generated, not executed · Review before use");
  });

  it("counts checks, not steps, when it passed", () => {
    expect(liveRunHeadline({ verdict: "passed", passed: 5, checks: 2 })).toBe(
      "Ran on the live page · 2 checks passed · Review before use",
    );
  });

  it("falls back to steps when the run counted no checks of its own", () => {
    expect(liveRunHeadline({ verdict: "passed", passed: 1 })).toBe(
      "Ran on the live page · 1 step passed · Review before use",
    );
  });

  it("names the credentials instead of calling the draft a failure", () => {
    const headline = liveRunHeadline({ verdict: "failed", passed: 5 }, [
      "E2E_USERNAME",
      "E2E_PASSWORD",
    ]);

    expect(headline).toContain("E2E_USERNAME and E2E_PASSWORD");
    expect(headline).toContain("Supply them below and run it again");
    // The words this exists to stop.
    expect(headline).not.toContain("did not pass");
  });

  it("says it in the singular for one variable", () => {
    const headline = liveRunHeadline({ verdict: "failed", passed: 5 }, ["E2E_PASSWORD"]);

    expect(headline).toContain("needs E2E_PASSWORD from your environment");
    expect(headline).toContain("Supply it below");
  });

  it("names the credential even when nothing actually failed", () => {
    // A run where the password was skipped and no later step failed is still
    // a run that needs the password. "Some steps could not run" sends nobody
    // anywhere.
    const headline = liveRunHeadline({ verdict: "partial", passed: 3 }, ["E2E_PASSWORD"]);

    expect(headline).toContain("E2E_PASSWORD");
    expect(headline).not.toContain("some steps could not run");
  });

  it("does not call a partial run a failure", () => {
    expect(liveRunHeadline({ verdict: "partial", passed: 3 })).toBe(
      "Ran on the live page · nothing failed, some steps could not run · Review before use",
    );
  });

  it("says it did not pass when it did not pass", () => {
    expect(liveRunHeadline({ verdict: "failed", passed: 3 })).toBe(
      "Ran on the live page and did not pass · Review before use",
    );
  });
});
