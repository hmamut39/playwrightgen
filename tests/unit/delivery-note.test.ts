import { describe, expect, it } from "vitest";

import { deliveryNote } from "@/lib/ci/delivery-note";

/**
 * The sentence a team reads when their pipeline reaches PlaywrightGen.
 *
 * The counts were always right and always useless: a build engineer whose first
 * run recorded nothing saw `{"recorded":0,"unmatched":412}` in a CI log and had
 * no way to tell a broken setup from a working one. These tests are about what
 * the sentence says, because that is the whole feature.
 */
describe("what a delivery is told it did", () => {
  it("explains why a suite with no markers records nothing", () => {
    const note = deliveryNote({ recorded: 0, duplicates: 0, unmatched: 412, unknownVersion: 0, total: 412 });

    expect(note).toContain("None of the 412 results were recorded");
    // The cause, and where the marker comes from, so the next step is obvious.
    expect(note).toContain("[pwg:…] marker");
    expect(note).toContain("PlaywrightGen puts there when it writes the test");
    // And it must not imply the tests were checked.
    expect(note).toContain("nothing here claims to have checked them");
    expect(note).not.toMatch(/passed|failed/);
  });

  it("counts what it did record when only some results matched", () => {
    const note = deliveryNote({ recorded: 3, duplicates: 0, unmatched: 9, unknownVersion: 0, total: 12 });

    expect(note).toContain("Recorded 3 of 12 results.");
    expect(note).toContain("9 results carried no [pwg:…] marker");
  });

  it("says plainly when everything matched", () => {
    const note = deliveryNote({ recorded: 5, duplicates: 0, unmatched: 0, unknownVersion: 0, total: 5 });

    expect(note).toBe("Recorded 5 of 5 results.");
  });

  it("distinguishes a redelivery from a first delivery", () => {
    const note = deliveryNote({ recorded: 0, duplicates: 5, unmatched: 0, unknownVersion: 0, total: 5 });

    // Nothing new was recorded, but the run was not rejected and nothing is
    // missing: saying "none were recorded" here would send someone debugging.
    expect(note).toContain("had already been recorded for this run");
    expect(note).not.toContain("None of the");
  });

  it("tells a marker that points nowhere from a missing one", () => {
    // PlaywrightGen's own delivery on 2026-09-22 was this case and was told
    // it carried no marker. The marker was there; it named a version this
    // project does not have. The two need opposite advice, and sending
    // somebody to add a marker that already exists costs an afternoon.
    const note = deliveryNote({
      recorded: 0,
      duplicates: 0,
      unmatched: 0,
      unknownVersion: 2,
      total: 2,
    });

    expect(note).toContain("None of the 2 results were recorded");
    expect(note).toContain("a test version this project does not have");
    expect(note).toContain("belong to a different PlaywrightGen project");
    // The wrong advice must not appear.
    expect(note).not.toContain("Tests written elsewhere carry no marker");
  });

  it("says both when a delivery carries some of each", () => {
    const note = deliveryNote({
      recorded: 0,
      duplicates: 0,
      unmatched: 3,
      unknownVersion: 1,
      total: 4,
    });

    expect(note).toContain("Tests written elsewhere carry no marker");
    expect(note).toContain("a test version this project does not have");
  });

  it("counts both apart when something was recorded", () => {
    const note = deliveryNote({
      recorded: 2,
      duplicates: 0,
      unmatched: 1,
      unknownVersion: 1,
      total: 4,
    });

    expect(note).toContain("Recorded 2 of 4 results.");
    expect(note).toContain("1 result carried no [pwg:…] marker");
    expect(note).toContain("1 result carried a marker for a test version this project does not have");
  });

  it("says so when a pipeline reports nothing at all", () => {
    expect(deliveryNote({ recorded: 0, duplicates: 0, unmatched: 0, unknownVersion: 0, total: 0 })).toBe(
      "The pipeline reported no results at all.",
    );
  });

  it("reads correctly for exactly one result", () => {
    expect(deliveryNote({ recorded: 0, duplicates: 0, unmatched: 1, unknownVersion: 0, total: 1 })).toContain(
      "The one result was not recorded.",
    );
    expect(deliveryNote({ recorded: 1, duplicates: 0, unmatched: 1, unknownVersion: 0, total: 2 })).toContain(
      "1 result carried no [pwg:…] marker, so it belongs",
    );
  });
});
