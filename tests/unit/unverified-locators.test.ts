import { describe, expect, it } from "vitest";

import { reviewUnverifiedLocators } from "@/lib/free-tools/unverified-locators";

/**
 * The model's "confirm these before the first run" list, against the page the
 * product actually read.
 *
 * Found on 2026-11-22 by the owner running the TodoMVC example. One screen
 * said "1 of 1 locators match the page" and, below it, listed two locators as
 * not on the page -- one of them the main input, which the tree contained,
 * which the generated code quoted from the tree, and which the passing run
 * had just used. One number was measured, the other repeated from the model,
 * and nothing told a reader which.
 */
const TODO_TREE = [
  "- heading: todos",
  '- textbox "What needs to be done?"',
  "- link: All",
  "- link: Active",
].join("\n");

describe("checking the model's unverified list against the page", () => {
  it("drops a locator the page plainly contains", () => {
    const review = reviewUnverifiedLocators(
      ["page.getByRole('textbox', { name: 'What needs to be done?' })"],
      TODO_TREE,
    );

    expect(review.kept).toEqual([]);
    expect(review.dropped).toHaveLength(1);
  });

  it("keeps one that really is not there yet", () => {
    /*
     * The todo does not exist until the test creates it, so this is exactly
     * what the panel is for. Dropping it would empty the warning of its
     * only true entry.
     */
    const review = reviewUnverifiedLocators(["page.getByText('buy milk')"], TODO_TREE);

    expect(review.kept).toEqual(["page.getByText('buy milk')"]);
    expect(review.dropped).toEqual([]);
  });

  it("sorts the real example correctly", () => {
    const review = reviewUnverifiedLocators(
      [
        "page.getByText('buy milk')",
        "page.getByRole('textbox', { name: 'What needs to be done?' })",
      ],
      TODO_TREE,
    );

    expect(review.kept).toEqual(["page.getByText('buy milk')"]);
    expect(review.dropped).toEqual([
      "page.getByRole('textbox', { name: 'What needs to be done?' })",
    ]);
  });

  it("keeps a claim it cannot check rather than guessing", () => {
    // A CSS selector has no accessible name to compare. Unverifiable is not
    // the same as contradicted, and dropping it would be the same mistake
    // pointing the other way.
    const review = reviewUnverifiedLocators(["page.locator('.todo-list li')"], TODO_TREE);

    expect(review.kept).toEqual(["page.locator('.todo-list li')"]);
  });

  it("keeps a locator whose name is only partly on the page", () => {
    const review = reviewUnverifiedLocators(
      ["page.getByRole('button', { name: 'Clear completed' })"],
      TODO_TREE,
    );

    expect(review.kept).toHaveLength(1);
  });

  it("ignores case and spacing, because a tree is not typed by hand", () => {
    const review = reviewUnverifiedLocators(
      ["page.getByRole('textbox', { name: 'what needs   to be done?' })"],
      TODO_TREE,
    );

    expect(review.dropped).toHaveLength(1);
  });

  it("says nothing about an empty list", () => {
    expect(reviewUnverifiedLocators([], TODO_TREE)).toEqual({ kept: [], dropped: [] });
  });

  it("keeps everything when no page was read", () => {
    // Without a tree there is nothing to contradict, and every locator is
    // genuinely unverified -- which is what the prompt asks for in that case.
    const claims = ["page.getByRole('textbox', { name: 'Email' })"];

    expect(reviewUnverifiedLocators(claims, "").kept).toEqual(claims);
  });
});
