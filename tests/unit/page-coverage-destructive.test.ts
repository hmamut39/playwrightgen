import { describe, expect, it } from "vitest";

import { setAsideDestructiveItems } from "@/lib/ai/page-coverage-plan";
import type { PageCoveragePlan } from "@/lib/ai/page-coverage-plan";

/**
 * Measured on 2026-10-17 against a settings page with a danger zone. The
 * planner proposed "Clicking Delete this workspace opens a confirmation",
 * one step: click the button "Delete this workspace". It had listed the
 * actual deletion as out of scope, so it meant well. But the page's tree
 * showed no confirmation dialog, and the planner cannot know there is one.
 * If there is not, the test deletes the workspace it runs against, once,
 * and everything after it fails for a reason nobody will understand.
 *
 * The rule has to be narrow. "Remove from team" is ordinary behaviour teams
 * want tested, and a guard that swallowed it would be a guard that stopped
 * the product doing its job.
 */
const item = (title: string, steps: string[]): PageCoveragePlan["items"][number] => ({
  title,
  objective: "Checks the behaviour.",
  steps,
  expectedResults: ["Something observable happens."],
  priority: "MEDIUM",
  rationale: "Worth testing.",
});

const plan = (items: PageCoveragePlan["items"], outOfScope: string[] = []): PageCoveragePlan => ({
  summary: "A plan.",
  items,
  outOfScope,
});

describe("a plan that would destroy what it runs against", () => {
  it("sets aside a step that deletes the workspace, and says so", () => {
    const result = setAsideDestructiveItems(
      plan([
        item("Invite fails with an invalid email", ['type "nope" into the textbox "Invite by email"']),
        item("Clicking Delete this workspace opens a confirmation", ['click the button "Delete this workspace"']),
      ]),
    );

    expect(result.items.map((entry) => entry.title)).toEqual(["Invite fails with an invalid email"]);
    // Said out loud, because a plan that quietly returns one item where it
    // meant two has lied about what the page needs.
    expect(result.outOfScope.join(" ")).toContain("Clicking Delete this workspace opens a confirmation");
    expect(result.outOfScope.join(" ")).toContain("destroy the account this test runs against");
  });

  it("sets aside closing the account and wiping the data", () => {
    const result = setAsideDestructiveItems(
      plan([
        item("Close the account", ['click the button "Close account"']),
        item("Wipe everything", ['click the button "Delete all data"']),
      ]),
    );

    expect(result.items).toEqual([]);
    expect(result.outOfScope).toHaveLength(2);
  });

  it("leaves ordinary destructive-sounding work alone", () => {
    // Every one of these is a behaviour a team wants a test for.
    const kept = plan([
      item("An admin removes a member", ['click the button "Remove from team"']),
      item("A shopper empties the cart", ['click the button "Remove item"']),
      item("A writer deletes a draft post", ['click the button "Delete draft"']),
      item("A todo is cleared when completed", ['click the button "Clear completed"']),
    ]);

    expect(setAsideDestructiveItems(kept)).toEqual(kept);
  });

  it("is not fooled by the words appearing in prose rather than on a control", () => {
    // The step talks about deletion; it does not operate a control that does
    // it, so there is nothing here to stop.
    const kept = plan([
      item("The danger zone warns before deleting the workspace", [
        'check that the heading "Danger zone" explains the workspace will be deleted',
      ]),
    ]);

    expect(setAsideDestructiveItems(kept)).toEqual(kept);
  });

  it("returns the plan untouched when nothing is destructive", () => {
    const untouched = plan([item("Invite a member", ['click the button "Send invitation"'])], ["Real emails"]);
    expect(setAsideDestructiveItems(untouched)).toBe(untouched);
  });
});
