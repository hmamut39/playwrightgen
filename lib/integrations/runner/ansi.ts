/**
 * Removes terminal control sequences from text captured by a test runner.
 *
 * Playwright colours its error output, so a failure arrives carrying escape
 * sequences around the interesting part: "Cannot navigate to invalid URL Call
 * log: ESC[2m - navigating to /cart ESC[22m". A terminal renders those as
 * colour. Stored evidence renders them as litter in the middle of the sentence
 * a reviewer is trying to read.
 *
 * Stripped when a result is ingested rather than when it is displayed, for two
 * reasons. Failure analysis quotes stored evidence exactly and every citation is
 * verified against that stored text, so escape codes left in storage would end
 * up inside quotes a person is asked to check. And each future reader of the
 * field -- an export, an API consumer, a report -- would otherwise have to
 * remember to strip them again.
 *
 * This removes formatting and never content: the sequences carry colour and
 * cursor instructions, and no part of the failure message itself. Written with
 * unicode escapes so the pattern stays readable and diffable rather than
 * embedding invisible bytes in the source.
 */
const CONTROL_SEQUENCE = new RegExp(
  "[\\u001B\\u009B][[\\]()#;?]*" +
    "(?:(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d/#&.:=?%@~_]*)*)?\\u0007)" +
    "|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))",
  "g",
);

export function stripControlSequences(value: string): string {
  return value.replace(CONTROL_SEQUENCE, "");
}
