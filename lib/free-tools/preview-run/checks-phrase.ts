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

/**
 * The detail under a verdict, where both numbers have to appear at once.
 *
 * The free generator showed "Passed on the live page: 2 checks in 3s" and,
 * directly beneath it, "5 passed · 0 failed · 3s". Both came from the same
 * run. Two is the assertions; five is every operation, each goto and fill
 * among them. Neither line said which it meant, so the screen read as a
 * product that could not count -- the owner found it within a minute of
 * using his own tool on 2026-11-22.
 *
 * Saying them together, in one phrase, is what makes them stop fighting: the
 * larger number is the work, the smaller one is the proof inside it.
 */
export function stepsPhrase(evidence: { passed: number; checks?: number | null }): string {
  const steps = `${evidence.passed} step${evidence.passed === 1 ? "" : "s"} passed`;
  const checks = checksCount(evidence);
  // Runs recorded before assertions were counted have no second number, and
  // inventing one is exactly what checksPhrase exists to prevent.
  return checks === null ? steps : `${steps}, ${checks} of them check${checks === 1 ? "" : "s"}`;
}
