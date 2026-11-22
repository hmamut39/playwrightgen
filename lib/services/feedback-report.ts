/**
 * One stored feedback report, as the owner reads it back.
 *
 * The route keeps every report for 180 days and sends a notice by mail. When
 * the notice fails the report is still kept -- losing it would be worse --
 * but nothing recorded that it had failed, so a report nobody was told about
 * looked exactly like one that had been read and dealt with.
 *
 * That is not hypothetical: between the sending address being set and the
 * API key being corrected, every notice failed, and the five reports in the
 * store were indistinguishable from five that had arrived.
 *
 * The product's own Release Review asked for this, given the key swap as a
 * change to review: *"The component that stored feedback reports will either
 * be drained automatically by existing retry logic or require an explicit
 * replay."* It has neither, and the honest first step is to know which
 * reports were never sent.
 */
export type StoredFeedback = {
  at?: string;
  who?: string;
  path?: string;
  message?: string;
  /**
   * Whether the notice left. Absent on reports stored before this was
   * recorded, which is not the same as false and must not be shown as it:
   * those are simply unknown.
   */
  notified?: boolean;
};

export function feedbackHeading(report: StoredFeedback): string {
  const when = report.at ?? "(no date)";
  const where = report.path ?? "(no page)";
  const who = report.who ?? "(unknown)";
  const delivery =
    report.notified === undefined
      ? "delivery unrecorded"
      : report.notified
        ? "emailed"
        : "NEVER EMAILED";
  return `${when}  ·  ${where}  ·  ${who}  ·  ${delivery}`;
}

/** How many were never sent, for a line that makes somebody act. */
export function neverEmailed(reports: readonly StoredFeedback[]): number {
  return reports.filter((report) => report.notified === false).length;
}
