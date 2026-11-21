/**
 * What to tell somebody standing on an empty Automation page.
 *
 * It said: "Open an approved Test Case and choose the Browser or API engine."
 * True, and useless to the person most likely to be reading it. A project
 * that has no automation usually has no approved test case either -- it is
 * the first week -- so the instruction names a thing they do not have, does
 * not say how to get one, and does not link anywhere. The chain only works
 * if you already knew where it started.
 *
 * Every other list in this workspace offers a link out of its empty state.
 * This was the one that did not, which matters more than one page's worth:
 * the welcome screen promises "Every screen after this tells you what to do
 * next", and a promise made on the first screen is checked on the others.
 *
 * So the message depends on what is actually missing, which is two cheap
 * counts away:
 *
 * - No test cases at all: the chain starts earlier than here.
 * - Test cases, none approved: the work exists and is waiting for a person,
 *   which is a different sentence and a different place to go.
 * - Approved ones ready: the original instruction, now with a way to follow
 *   it.
 */
export type AutomationEmptyState = {
  title: string;
  detail: string;
  action: { label: string; href: string };
};

export function automationEmptyState(
  counts: { testCases: number; approved: number },
  basePath: string,
): AutomationEmptyState {
  if (counts.testCases === 0) {
    return {
      title: "Nothing to automate yet",
      detail:
        "Automation is written from a test case a person has approved, so that is where this starts. Write one — or let the AI propose a set from a requirement — then come back here.",
      action: { label: "Go to Test Cases", href: `${basePath}/test-cases` },
    };
  }

  if (counts.approved === 0) {
    const count = counts.testCases === 1 ? "one test case" : `${counts.testCases} test cases`;
    return {
      title: "Waiting on an approval, not on you writing more",
      detail: `This project has ${count} and none of them approved yet. Approval is what lets code be written against a fixed version, so the next move is a review rather than another draft.`,
      action: { label: "Open the review queue", href: `${basePath}/reviews` },
    };
  }

  return {
    title: "No automation artifacts yet",
    detail:
      "Open an approved test case and choose the Browser or API engine. PlaywrightGen writes the code against that exact version, runs it on your live page, and a person reviews it before it counts.",
    action: { label: "Open Test Cases", href: `${basePath}/test-cases` },
  };
}
