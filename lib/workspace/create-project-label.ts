/**
 * What the Create project button says while it is working.
 *
 * It is the first action a new team takes. Given a page address, creating a
 * project does more than insert a row: it keeps the address, starts a plan of
 * that page's tests, and redirects to the plan.
 *
 * **Measured before being described, after the first version of this file got
 * it wrong.** That comment claimed thirty to ninety seconds of inline work
 * and the button said "Planning the tests this page needs takes about a
 * minute". Timed on a real run, the whole press-to-redirect is **two
 * seconds**: the planning is handed to a background task and happens on the
 * Cover page the person lands on, which has its own progress of its own. A
 * hint promising a minute would have been a new false claim shipped while
 * fixing an old one.
 *
 * The workspace already has `PendingButton` for precisely this, and its own
 * comment says why: "nobody waiting can tell 'working' from 'broken', so they
 * click again, reload, or give up. The first report of this came from someone
 * testing the product as a customer would, which is precisely the person it
 * fails." Every AI action in the workspace uses it. This form -- the one that
 * every single person meets first, and the one that waits longest -- did not.
 *
 * Clicking again was not harmless either: nothing disabled the button, so a
 * second press submitted the form again, which is a second project and a
 * second planning run out of the same daily allowance.
 *
 * The wording depends on what was actually submitted, because "Creating…" for
 * ninety seconds is its own small lie about what is taking the time.
 */
export type CreateProjectLabel = { label: string; hint: string | null };

export function createProjectLabel(input: {
  pending: boolean;
  pageUrl: string | null | undefined;
}): CreateProjectLabel {
  if (!input.pending) return { label: "Create project", hint: null };

  const hasPage = Boolean(input.pageUrl?.trim());
  return {
    label: "Creating the project…",
    // Where they are about to be, not how long this takes: this takes two
    // seconds, and the waiting happens on the next screen, which says so
    // itself. Saying "about a minute" here would move a true sentence onto
    // the wrong button.
    hint: hasPage ? "Next: the plan of the tests your page needs." : null,
  };
}
