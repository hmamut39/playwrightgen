import { extractLocatorNames, normalizeName } from "@/lib/free-tools/locator-names";

/**
 * The model's list of "confirm these before the first run", checked against
 * the page that was actually read.
 *
 * The draft comes back with `unverifiedLocators`: the model's own account of
 * which elements it could not see. The product showed that list verbatim,
 * under the heading **"Not on the page we opened"**, which turns a model's
 * self-report into a statement of fact about a page the product has in front
 * of it.
 *
 * On 2026-11-22 the owner ran the TodoMVC example and the result said, on one
 * screen:
 *
 *   - a badge: **"1 of 1 locators match the page"**
 *   - and below it, two locators listed as not on the page, one of them
 *     `getByRole('textbox', { name: 'What needs to be done?' })` -- the main
 *     input, which the tree plainly contained, which the generated code's own
 *     comment quoted from the tree, and which the passing run had just used.
 *
 * Both numbers came from the product. One was measured and one was repeated,
 * and the repeated one was wrong. A reader cannot tell which is which, so the
 * honest fix is not to explain the discrepancy but to stop printing it: a
 * claim the evidence contradicts is dropped before anybody sees it.
 *
 * What is kept is as important. `getByText('buy milk')` is genuinely absent
 * -- the todo does not exist until the test creates it -- and that is exactly
 * what this panel is for. A locator with no literal name to compare, such as
 * one built from a CSS selector, is kept too: unverifiable is not the same as
 * contradicted, and dropping it would be the same sin pointing the other way.
 */
export type UnverifiedLocatorReview = {
  /** Claims the page could not contradict. */
  kept: string[];
  /** Claims the page did contradict, and why they were dropped. */
  dropped: string[];
};

export function reviewUnverifiedLocators(
  claimed: readonly string[],
  aria: string,
): UnverifiedLocatorReview {
  const page = normalizeName(aria);
  const kept: string[] = [];
  const dropped: string[] = [];

  for (const claim of claimed) {
    const names = extractLocatorNames(claim);
    // Nothing to compare: keep it, and let a person decide.
    if (names.length === 0) {
      kept.push(claim);
      continue;
    }
    // Every name it targets was on the page, so the model could see it after
    // all. One name missing is enough to keep the whole claim: the locator
    // still reaches for something that was not there.
    const allPresent = names.every((name) => page.includes(normalizeName(name)));
    if (allPresent) dropped.push(claim);
    else kept.push(claim);
  }

  return { kept, dropped };
}
