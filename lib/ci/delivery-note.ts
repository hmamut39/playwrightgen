/**
 * What a delivery from a customer's CI actually did, said in words.
 *
 * A result is attached to an approved test by a `[pwg:<version>]` marker in its
 * title, which PlaywrightGen puts there when it writes the test. A team with an
 * existing Playwright suite has no markers anywhere, so their first pipeline run
 * reports hundreds of results and PlaywrightGen records none of them. The counts
 * were already correct; they were just a line of JSON in a CI log and nothing
 * at all in the product, which left a working pipeline looking identical to a
 * broken one.
 *
 * Plain data with no server in it, because both the runner's reply and the
 * project page need the same sentence, and two copies of it would drift.
 */

export type DeliveryCounts = {
  /** Results attached to an approved test version. */
  recorded: number;
  /** Results already recorded for this same run. */
  duplicates: number;
  /** Results that carried no marker, or a marker for nothing in this project. */
  unmatched: number;
  /** Everything the pipeline reported. */
  total: number;
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * One or two sentences a person can act on.
 *
 * It never implies the tests passed or failed: a delivery is evidence that the
 * pipeline reached here, and nothing more.
 */
/**
 * Why a delivery was turned away.
 *
 * A refusal is the one outcome a pipeline cannot diagnose for itself: the
 * runner sees a 401 and the team sees an empty page. These are the refusals
 * the product can attribute, so they are the ones it can explain.
 */
export type RejectionReason = "stale_token" | "connection_inactive";

export function rejectionNote(reason: RejectionReason): string {
  switch (reason) {
    case "stale_token":
      return 'This delivery was signed with a project token that is no longer current, so it was refused. The token was rotated here; update PLAYWRIGHTGEN_TOKEN in your CI with the current value and the next run will be recorded.';
    case "connection_inactive":
      return 'This delivery was signed with a valid token, but this project has no active repository connection, so there is nobody to attribute the evidence to. Reconnect the repository and the next run will be recorded.';
  }
}
export function deliveryNote(counts: DeliveryCounts): string {
  const { recorded, duplicates, unmatched, total } = counts;

  if (total === 0) return "The pipeline reported no results at all.";

  if (recorded === 0 && duplicates === 0) {
    const nothing =
      total === 1 ? "The one result was not recorded." : `None of the ${total} results were recorded.`;
    return `${nothing} A result is attached to an approved test by a [pwg:…] marker in its title, which PlaywrightGen puts there when it writes the test. Tests written elsewhere carry no marker, so they are not recorded here and nothing here claims to have checked them.`;
  }

  const parts = [`Recorded ${recorded} of ${plural(total, "result")}.`];
  if (duplicates > 0) {
    parts.push(`${plural(duplicates, "result")} had already been recorded for this run.`);
  }
  if (unmatched > 0) {
    parts.push(
      `${plural(unmatched, "result")} carried no [pwg:…] marker, so ${unmatched === 1 ? "it belongs" : "they belong"} to tests PlaywrightGen does not know about.`,
    );
  }
  return parts.join(" ");
}
