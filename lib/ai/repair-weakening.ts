/**
 * What a repair did to the test it was given.
 *
 * A repair is the one place in this product where "it passes now" can mean
 * "it stopped checking". Everything else is reviewed by a person reading new
 * work; a fix arrives as a small diff on a test they already approved, after
 * a loop that ran until the red went away, and the thing that would make it
 * pass fastest is to delete the assertion that failed.
 *
 * The prompt forbids that in words -- keep the structure, keep the
 * assertions' intent, say so rather than weakening it -- and nothing checked.
 * Every validation this product runs on a repair looks at the new code alone,
 * where a missing assertion is invisible: code with three assertions is
 * perfectly well-formed whether it started with three or with four.
 *
 * So the comparison is against the code it came from, and it is deliberately
 * about shape rather than meaning. It cannot tell a better assertion from a
 * worse one. It can tell that there are fewer of them, that one was turned
 * into its opposite, that the test now skips itself, or that the failure was
 * buried under a swallowed error -- which is what weakening actually looks
 * like when it happens.
 */

export type WeakeningFinding = {
  code: string;
  /** What to say to the person reading the fix. */
  message: string;
};

const countOf = (code: string, pattern: RegExp) => code.match(pattern)?.length ?? 0;

/** Assertions, however they are written. */
const ASSERTION = /\bexpect(?:\.soft)?\s*\(/g;
/** An assertion turned into its opposite, which passes for the opposite reason. */
function negatedAssertions(code: string): number {
  // Counted per line rather than by matching the whole expression: a locator
  // carries its own brackets -- expect(page.getByText("x")).not.toBeVisible()
  // -- and a pattern trying to span them stops at the first one and silently
  // matches nothing, which is the most dangerous way for a rule to be wrong.
  return code
    .split("\n")
    .filter((line) => /\bexpect(?:\.soft)?\s*\(/.test(line) && /\.\s*not\s*\./.test(line)).length;
}
/** Ways to stop a test running at all. */
const SKIPS = /\b(?:test|test\.describe)\.(?:skip|fixme)\s*\(|\.skip\s*\(\s*(?:true|\(\))/g;
/** Ways to make a failure stop being one. */
const SWALLOWS = /\btry\s*\{|\.catch\s*\(|\bexpect\.soft\s*\(/g;
/** Waiting instead of asserting. */
const HARD_WAITS = /waitForTimeout\s*\(|\bsleep\s*\(/g;

/**
 * Everything the repair took away, in the order a reviewer would care.
 *
 * Empty when the repair only changed how the test reaches the page, which is
 * what a repair is for.
 */
export function weakeningFindings(before: string, after: string): WeakeningFinding[] {
  const findings: WeakeningFinding[] = [];

  const assertionsBefore = countOf(before, ASSERTION);
  const assertionsAfter = countOf(after, ASSERTION);
  if (assertionsAfter < assertionsBefore) {
    findings.push({
      code: "assertions_removed",
      message: `The fix checks ${assertionsAfter} thing${assertionsAfter === 1 ? "" : "s"} where the test checked ${assertionsBefore}. A test that passes because it stopped looking is not a fixed test.`,
    });
  }

  const negationsBefore = negatedAssertions(before);
  const negationsAfter = negatedAssertions(after);
  if (negationsAfter > negationsBefore) {
    findings.push({
      code: "assertion_negated",
      message:
        "The fix turned an assertion into its opposite, so it now passes for the opposite reason. If the behaviour is genuinely absent, the test should say so and fail.",
    });
  }

  if (countOf(after, SKIPS) > countOf(before, SKIPS)) {
    findings.push({
      code: "test_skipped",
      message: "The fix makes the test skip itself. A skipped test demonstrates nothing, and the run would report a pass.",
    });
  }

  if (countOf(after, SWALLOWS) > countOf(before, SWALLOWS)) {
    findings.push({
      code: "failure_swallowed",
      message:
        "The fix catches or softens the failure rather than addressing it, which leaves the run green while the behaviour is still wrong.",
    });
  }

  if (countOf(after, HARD_WAITS) > countOf(before, HARD_WAITS)) {
    findings.push({
      code: "waits_instead_of_asserting",
      message: "The fix waits a fixed time instead of asserting. That hides a timing problem rather than proving the behaviour.",
    });
  }

  return findings;
}

/** Whether a repair may be taken at all. */
export function repairKeptItsPromise(before: string, after: string): boolean {
  return weakeningFindings(before, after).length === 0;
}
