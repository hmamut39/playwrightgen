import { describe, expect, it } from "vitest";

import { LiveRunUnavailableError } from "@/lib/free-tools/preview-run/run-draft";
import { PageCoverageError, whyItDidNotRun } from "@/lib/services/page-coverage";

/**
 * The sentence a new customer reads when a test on their first plan did not
 * run.
 *
 * It said "Something went wrong while proving this test" whatever had
 * happened. On a first run against TodoMVC two of five items landed there,
 * and the cause -- the live browser could not be reached -- was written to
 * the server log and nowhere a person could see it. The reader is left to
 * conclude that the AI wrote a bad test or that their page is broken, and
 * neither was true.
 */
describe("why a test did not run", () => {
  it("names the live browser when that is what failed", () => {
    const said = whyItDidNotRun(new LiveRunUnavailableError());

    expect(said).toContain("could not be reached");
    // The two conclusions a reader would otherwise draw, ruled out explicitly.
    expect(said).toContain("Nothing is wrong with the test or with your page");
    expect(said).toContain("Try proving it again");
  });

  it("passes on a cause the product already explains in words", () => {
    const said = whyItDidNotRun(new PageCoverageError("allowance_used", "The daily AI allowance is used up."));

    expect(said).toContain("The daily AI allowance is used up.");
    expect(said).toContain("has not been run");
  });

  it("admits it does not know rather than inventing a cause", () => {
    const said = whyItDidNotRun(new Error("ECONNRESET"));

    expect(said).toContain("was not one this page recognises");
    // Not the error's own text: a reader cannot act on ECONNRESET, and an
    // internal message is not written for them.
    expect(said).not.toContain("ECONNRESET");
  });

  it("says the test was not run, whatever the cause", () => {
    // The one fact that is true in every branch, and the one the reader
    // needs: no result exists either way. Without it a person reads an
    // error as a verdict on their test.
    for (const error of [new LiveRunUnavailableError(), new PageCoverageError("allowance_used", "Used up."), new Error("x")]) {
      expect(whyItDidNotRun(error)).toMatch(/has not been run|could not be run/);
    }
  });
});
