/**
 * A run's recent attempts, in one sentence.
 *
 * The list already shows a status and a count ("FAILED", "7 attempts"), which
 * leaves the reader to open the run and piece together what happened. Since a
 * daily live check can record a failure and the retry that passed, the same
 * two numbers can mean "broken" or "flaky" -- so the list says which.
 *
 * It describes only what the attempts show, in the order they happened, and
 * never guesses a cause.
 */

export type AttemptForStory = {
  result: "PASSED" | "FAILED" | "BLOCKED" | "SKIPPED" | string;
  executedAt: Date;
};

/** Attempts close enough together to be the same round rather than another day. */
const SAME_ROUND_MS = 30 * 60_000;

/** The one sentence that means "flaky": a failure and its retry, minutes apart. */
export const FAILED_THEN_PASSED = "Failed, then passed when run again.";

export function describeAttempts(attempts: readonly AttemptForStory[]): string | null {
  if (attempts.length === 0) return null;
  // Newest first, whatever order the query gave.
  const ordered = [...attempts].sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime());
  const [latest, previous] = ordered;

  if (latest.result === "PASSED") {
    if (
      previous &&
      previous.result === "FAILED" &&
      latest.executedAt.getTime() - previous.executedAt.getTime() <= SAME_ROUND_MS
    ) {
      return FAILED_THEN_PASSED;
    }
    const inARow = ordered.findIndex((attempt) => attempt.result !== "PASSED");
    const passes = inARow === -1 ? ordered.length : inARow;
    if (passes >= 2) return `Passed the last ${passes} times.`;
    return previous && previous.result === "FAILED" ? "Failing before, passing now." : "The last attempt passed.";
  }

  if (latest.result === "FAILED") {
    const failuresInARow = ordered.findIndex((attempt) => attempt.result !== "FAILED");
    const failures = failuresInARow === -1 ? ordered.length : failuresInARow;
    if (failures >= 2) return `Failed the last ${failures} times.`;
    return previous && previous.result === "PASSED" ? "Passed before, failing now." : "The last attempt failed.";
  }

  return "The last attempt could not run.";
}
