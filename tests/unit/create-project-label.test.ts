import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createProjectLabel } from "@/lib/workspace/create-project-label";

/**
 * The first button a new team presses.
 *
 * Found on 2026-11-21 by walking a new member through the chain: the walk
 * assumed the form had submitted, because nothing on the screen said
 * otherwise -- and nothing stopped a second click, which would have been a
 * second project.
 *
 * The first fix overclaimed, and the timing is why it was caught: the button
 * was given a hint saying the planning "takes about a minute", when press to
 * redirect is two seconds and the planning happens on the next screen.
 */
describe("what the Create project button says", () => {
  it("is itself before it is pressed", () => {
    expect(createProjectLabel({ pending: false, pageUrl: "https://example.com" })).toEqual({
      label: "Create project",
      hint: null,
    });
  });

  it("says where the person is going, not how long it takes", () => {
    /*
     * The first version of this said "Planning the tests this page needs
     * takes about a minute". Timed on a real run, press to redirect is two
     * seconds: the planning is a background task and happens on the Cover
     * page the person lands on. The hint would have been a new false claim
     * shipped while fixing an old one.
     */
    const { label, hint } = createProjectLabel({ pending: true, pageUrl: "https://example.com" });

    expect(label).toBe("Creating the project…");
    expect(hint).toContain("Next: the plan");
    expect(hint).not.toContain("minute");
  });

  it("says nothing extra when there is no page to plan", () => {
    // Without a page there is no plan to land on, so there is nothing to
    // point at.
    const { label, hint } = createProjectLabel({ pending: true, pageUrl: "" });

    expect(label).toBe("Creating the project…");
    expect(hint).toBeNull();
    expect(createProjectLabel({ pending: true, pageUrl: null }).hint).toBeNull();
    expect(createProjectLabel({ pending: true, pageUrl: "   " }).hint).toBeNull();
  });
});

describe("the form that waits longest", () => {
  it("uses a button that disables itself while the form is working", () => {
    /*
     * Not decoration. Nothing disabled the old button, so an impatient second
     * click submitted the form again: a second project, and a second planning
     * run out of the same daily allowance. This asserts the form no longer
     * carries a plain submit button.
     */
    const form = readFileSync("app/workspace/[orgSlug]/projects/new/page.tsx", "utf8");

    expect(form).toContain("<CreateProjectButton />");
    expect(form).not.toMatch(/<button[^>]*type="submit"/);
  });

  it("keeps the pending-aware button honest about being disabled", () => {
    const button = readFileSync("components/workspace/create-project-button.tsx", "utf8");

    expect(button).toContain("disabled={pending}");
    expect(button).toContain("aria-busy");
  });
});
