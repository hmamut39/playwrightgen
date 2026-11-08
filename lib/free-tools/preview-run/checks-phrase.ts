/**
 * How many checks a live run proved, in words, from the evidence that was kept.
 *
 * The preview runner counts every operation it performs: a `goto`, a `fill`, a
 * `press` and an `expect` were all one "passed". That number was then shown to
 * people -- and to assistants through the MCP server -- as "checks", directly
 * under "proven on your real page". A generated test with three assertions and
 * two actions read "7 checks passed", which is more than twice what it had
 * checked. In a testing product a check is an assertion, and the number beside
 * the product's most load-bearing claim has to be the one a tester would count.
 *
 * Runs recorded before the count existed carry only the operation total, so
 * they say "steps" instead. That is what the stored number is, and calling it a
 * check retroactively would be the same overstatement with a later date on it.
 */
export function checksPhrase(evidence: { passed: number; checks?: number | null }): string {
  const { checks } = evidence;
  if (typeof checks === "number") return `${checks} check${checks === 1 ? "" : "s"}`;
  return `${evidence.passed} step${evidence.passed === 1 ? "" : "s"}`;
}

/**
 * The same number with no unit, for places that supply their own noun.
 *
 * Returns null when the run predates counting assertions, so a caller that
 * cannot say "steps" can leave the claim out rather than make one up.
 */
export function checksCount(evidence: { checks?: number | null }): number | null {
  return typeof evidence.checks === "number" ? evidence.checks : null;
}
