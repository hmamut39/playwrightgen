import { describe, expect, it } from "vitest";

import { pullRequestNoteBody, type DeliveryForNote } from "@/lib/services/ci-pull-request-note";
import { NOTE_MARKER } from "@/lib/integrations/github/pull-request-note";

/**
 * What the pull request is told.
 *
 * A developer who broke a test never opens PlaywrightGen; the decision to
 * merge happens in the pull request. CI already lists which tests failed, so
 * repeating that is noise. The sentence worth travelling is the one about
 * requirements: that the test which just started failing is the only thing
 * verifying a behaviour, and that the behaviour is now unverified. That is
 * assembled from the approval chain, the version pinning and the run evidence,
 * and nothing else in the pipeline holds all three.
 *
 * These assert the wording, because the wording is the feature. The comment is
 * read in thirty seconds by somebody deciding whether to merge.
 */

const delivery = (overrides: Partial<DeliveryForNote> = {}): DeliveryForNote => ({
  organizationId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  ref: "feature/saved-card",
  commitSha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  provider: "github_actions",
  counts: { recorded: 2, duplicates: 0, unmatched: 0, unknownVersion: 0, total: 2 },
  recordedTestCaseIds: ["t1"],
  ...overrides,
});

const body = (
  touched: Array<{ title: string; verdict: "VERIFIED" | "FAILING" | "UNVERIFIED"; reason: string }>,
  overrides: Partial<DeliveryForNote> = {},
) =>
  pullRequestNoteBody({
    delivery: delivery(overrides),
    touched,
    projectUrl: "https://playwrightgen.com/workspace/acme/projects/p1/release",
  });

describe("the note left on a pull request", () => {
  it("leads with the requirement, not the test name", () => {
    const note = body([
      {
        title: "A returning customer can pay with a saved card",
        verdict: "FAILING",
        reason: "Its only approved test last ran and failed.",
      },
    ]);

    // The test name is what CI already said. The requirement is what nobody
    // else in the pipeline can name.
    expect(note).toContain("A returning customer can pay with a saved card");
    expect(note).toContain("1 requirement this change touches is not verified");
    expect(note).toContain("Its only approved test last ran and failed.");
  });

  it("separates what still holds from what does not", () => {
    const note = body([
      { title: "Paying with a saved card", verdict: "FAILING", reason: "It failed." },
      { title: "Searching the catalogue", verdict: "VERIFIED", reason: "It passed." },
    ]);

    expect(note).toContain("1 requirement this change touches is not verified");
    expect(note).toContain("1 still verified");
    // A reader scanning for trouble should not have to read the good news to
    // find the bad.
    expect(note.indexOf("not verified")).toBeLessThan(note.indexOf("still verified"));
  });

  it("counts a blocked test as not verified, not as fine", () => {
    // A skipped test satisfying a green pipeline is the documented way a
    // quality gate silently stops guarding anything.
    const note = body([
      {
        title: "A refund reaches the original card",
        verdict: "UNVERIFIED",
        reason: "Its approved test was blocked and did not run.",
      },
    ]);

    expect(note).toContain("not verified");
    expect(note).toContain("did not run");
  });

  it("says plainly that it is not a gate", () => {
    const note = body([{ title: "Anything", verdict: "FAILING", reason: "It failed." }]);

    // A product that refuses to let somebody ship has claimed an authority
    // this one spent its whole design avoiding.
    expect(note).toContain("not a gate");
    expect(note).toContain("Merging is your decision");
  });

  it("carries a marker so the next push edits rather than repeats", () => {
    // One comment per pull request. A comment per push turns a conversation
    // into a log, and the second one is where people stop reading.
    expect(body([])).toContain(NOTE_MARKER);
  });

  it("says when recorded tests are linked to no requirement", () => {
    const note = body([]);

    // Silence here would read as "nothing is wrong", when the truth is that
    // nothing is connected yet.
    expect(note).toContain("None of the tests recorded here are linked to a requirement yet");
  });

  it("repeats what the delivery itself did, in the same words as everywhere else", () => {
    const note = body([], {
      counts: { recorded: 1, duplicates: 0, unmatched: 11, unknownVersion: 0, total: 12 },
    });

    expect(note).toContain("Recorded 1 of 12 results.");
    expect(note).toContain("a1b2c3d4");
  });
});
