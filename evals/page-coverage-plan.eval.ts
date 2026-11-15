import { describe, expect, it } from "vitest";

import { planPageCoverage } from "@/lib/ai/page-coverage-plan";

/**
 * Measures the planner behind "cover this page".
 *
 * It proposes test cases from one page's real accessibility tree, and each
 * item a person keeps is then proven separately on the live page. That order
 * is what makes its mistakes expensive: a plan that invents a control costs a
 * day's AI allowance to discover, one test at a time, and every one of those
 * failures looks like the product being broken rather than the plan being
 * wrong.
 *
 * Four promises, each of which breaks without the output looking any
 * different:
 *
 *  - every control it names is one the page actually has;
 *  - it does not plan a test whose only outcome is that text is present,
 *    because such a test passes while the product is broken;
 *  - it leaves alone what a test must not do to a live site, and says so;
 *  - it skips what the project already covers rather than filling the list.
 *
 * The tree is written here rather than fetched. A planner is graded on what
 * it does with a page, and a page that changes under the eval grades nothing.
 */

/** A settings page with real work on it, and two things a test must not do. */
const TREE = `- heading "Team settings" [level=1]
- textbox "Invite by email"
- combobox "Role":
  - option "Member"
  - option "Admin"
- button "Send invitation"
- heading "Members" [level=2]
- list:
  - listitem:
    - text: dilnur@example.com
    - button "Change role"
    - button "Remove from team"
  - listitem:
    - text: aylin@example.com
    - button "Change role"
    - button "Remove from team"
- heading "Danger zone" [level=2]
- button "Delete this workspace"
- contentinfo:
  - link "Documentation"
  - link "Status page"
  - text: Built by Mamuti Aishan`;

const page = {
  pageUrl: "https://app.example.com/settings/team",
  title: "Team settings",
  aria: TREE,
  elementHints: ['button "Send invitation" [data-test="invite-submit"]'],
  focus: "",
  existingTitles: [] as string[],
  maxItems: 6,
};

const ready = Boolean(process.env.OPENAI_API_KEY?.trim());

/**
 * Every control name the plan tells a tester to operate.
 *
 * Only quotes that follow a control word. The first version of this took
 * every quoted string in a step and called `type 'not-an-email' into the
 * textbox "Invite by email"` an invented control: the test data was quoted
 * too, and the eval blamed the planner for a case it had written correctly.
 */
const namedControls = (steps: string[]) =>
  steps.flatMap((step) =>
    [
      ...step.matchAll(
        /\b(?:button|link|textbox|combobox|checkbox|radio|option|tab|field|menuitem)\s+["“]([^"”]{2,60})["”]/gi,
      ),
    ].map((match) => match[1]),
  );

describe.skipIf(!ready)("planning the tests one page needs", () => {
  it("names only controls the page actually has", async () => {
    const plan = await planPageCoverage(page);

    // An invented control is not a bad guess, it is a test that cannot pass
    // and that costs a request each to find out.
    const invented = plan.items
      .flatMap((item) => namedControls(item.steps))
      .filter((name) => !TREE.toLowerCase().includes(name.toLowerCase()));

    expect(invented, `named controls the page does not have: ${invented.join(", ")}`).toEqual([]);
  }, 180_000);

  it("plans no test whose only outcome is that something is on the screen", async () => {
    const plan = await planPageCoverage(page);

    // The footer is the trap: three static items a planner can fill a list
    // with, every one of which passes while the product is broken.
    const staticOnly = plan.items.filter((item) =>
      item.expectedResults.every((result) =>
        /\b(?:documentation|status page|built by|heading|footer|link)\b/i.test(result),
      ),
    );

    expect(
      staticOnly.map((item) => item.title),
      "planned a test that only checks something is displayed",
    ).toEqual([]);
  }, 180_000);

  it("leaves what a test must not do to a live site, and says it left it", async () => {
    const plan = await planPageCoverage(page);

    const deletesTheWorkspace = plan.items.filter((item) =>
      item.steps.some((step) => /delete this workspace/i.test(step)),
    );
    expect(
      deletesTheWorkspace.map((item) => item.title),
      "planned a test that deletes the workspace it runs against",
    ).toEqual([]);
    // Said out loud, because silence here reads as "there was nothing else".
    expect(
      plan.outOfScope.join(" ").toLowerCase(),
      `nothing was recorded as left out: ${JSON.stringify(plan.outOfScope)}`,
    ).toMatch(/delete|workspace|destructive/);
  }, 180_000);

  it("adds to what a project already has rather than repeating it", async () => {
    // The half that can fail. A planner that ignores existingTitles passes
    // every case above and quietly proposes the same two tests a team already
    // approved, which costs them a request each to notice.
    const plan = await planPageCoverage({
      ...page,
      existingTitles: [
        "An admin invites a new member by email",
        "An admin changes a member's role",
        "An admin removes a member from the team",
      ],
    });

    /*
     * Matched on the behaviour, not on a keyword. The first version of this
     * flagged "Invite fails with invalid email format" as a repeat of "An
     * admin invites a new member by email", which is the validation case the
     * instructions ask for once the happy path is covered -- the planner was
     * right and the eval was wrong.
     *
     * It was wrong a second way until 2026-11-15, and that one made this case
     * flake. The filter also matched every item whenever the plan held more
     * than four, a clause that does not look at the item it is filtering --
     * so a plan of five tests that repeated nothing was reported as five
     * repeats, under a message saying they "proposed the covered behaviour
     * again". Untrue of every one of them.
     *
     * The threshold contradicted the fixture it ran against, which asks for
     * maxItems: 6. Asking for up to six and failing at five is not a
     * measurement of the planner; it is a measurement of which number the
     * sampling happened to land on, and across four runs this case reported
     * fail, pass, pass, fail on the same input.
     *
     * So the promise is asserted, and only the promise: a plan told what is
     * already covered does not propose those behaviours again, and does not
     * pad itself by proposing the same new thing twice.
     */
    const happyPath = /^an admin (?:invites|changes|removes)\b/i;
    const repeats = plan.items.filter((item) => happyPath.test(item.title));
    expect(
      repeats.map((item) => item.title),
      "proposed a behaviour the project already covers",
    ).toEqual([]);

    // Padding, measured as padding. Two items for one behaviour is the thing
    // "filled the list" was reaching for, and unlike a count it is true or
    // false regardless of how many the planner returns.
    const titles = plan.items.map((item) => item.title.trim().toLowerCase());
    const duplicated = titles.filter((title, index) => titles.indexOf(title) !== index);
    expect(duplicated, "proposed the same test twice").toEqual([]);

    // The cap it was given is the cap it must honour.
    expect(
      plan.items.length,
      `asked for at most ${page.maxItems} and returned ${plan.items.length}`,
    ).toBeLessThanOrEqual(page.maxItems);
  }, 180_000);
});
