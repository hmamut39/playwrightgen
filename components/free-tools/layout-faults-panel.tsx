/**
 * What the page looked like, which no assertion in this product can tell you.
 *
 * Every assertion it writes is functional -- a role, a name, a piece of text
 * -- so a passing run says the behaviour works and says nothing about whether
 * the page is readable. A button clipped to "Add to ca" has the same
 * accessible name as one that is not. Without this a green run reads as a
 * verdict on the page, and it never was.
 *
 * One component, used by the generator and by Coverage Review, because both
 * read the same snapshot and the same fault would otherwise be worded twice
 * and corrected once. This codebase has already paid for that: the masking
 * rule lived in three files and was changed in one.
 *
 * No hooks and no state, so it renders in a server or a client tree.
 */

export type ShownLayoutFault = { kind: string; what: string };

export function LayoutFaultsPanel({
  faults,
}: {
  /**
   * Three states, all of them meant.
   *
   * An array is the result of the check. `null` means the check could not
   * run. `undefined` means this record predates the check existing -- an old
   * saved draft genuinely has no answer.
   *
   * Only the array renders anything. A check that could not run makes no
   * claim, so it says nothing rather than showing the clean line: those two
   * were the same value once, and the screen called both of them "no layout
   * faults", which is the product asserting what it had not established.
   */
  faults: ShownLayoutFault[] | null | undefined;
}) {
  if (!faults) return null;

  if (faults.length === 0) {
    // Said out loud. A check that is silent on success cannot be told apart
    // from a check that did not run.
    return (
      <p className="mt-2 text-xs leading-5 text-emerald-800">
        No layout faults on this page: nothing clipped, overlapping, or scrolling sideways.
      </p>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
      <p className="text-xs font-bold text-amber-900">
        {faults.length === 1 ? "1 layout fault on this page" : `${faults.length} layout faults on this page`}
      </p>
      <ul className="mt-1 space-y-1">
        {faults.map((fault) => (
          <li key={fault.what} className="text-xs leading-5 text-amber-900">
            {fault.what}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs leading-5 text-amber-800">
        These are not test failures. The behaviour can pass while the page still
        looks wrong, so they are reported separately and never change a
        run&rsquo;s verdict.
      </p>
    </div>
  );
}
