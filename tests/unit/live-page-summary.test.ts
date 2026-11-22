import { describe, expect, it } from "vitest";

import { livePageSummary } from "@/lib/free-tools/live-page-summary";

/**
 * The line describing a page the product just read.
 *
 * Coverage Review printed "1 named control: 0 buttons, 1 fields, 3 links",
 * then "3 links to another site left out of the count" -- a colon explaining
 * one thing with four, and a line saying three links were excluded from a
 * count they had just appeared in. Both sentences were true of different
 * measures and neither said which.
 *
 * Found on 2026-11-22 by walking Coverage Review as a stranger, the first
 * time anyone had used that tool at all.
 */
describe("describing what was on the page", () => {
  it("counts in the plural only when there is more than one", () => {
    // "1 fields" and "1 headings" were on two public pages.
    const line = livePageSummary({ counts: { buttons: 0, fields: 1, links: 3, headings: 1 } });

    expect(line).toContain("1 field,");
    expect(line).toContain("1 heading");
    expect(line).not.toContain("1 fields");
    expect(line).not.toContain("1 headings");
    expect(line).toContain("0 buttons");
  });

  it("does not promise that the controls explain the list", () => {
    /*
     * The original used a colon: "1 named control: 0 buttons, 1 fields, 3
     * links". A colon says what follows explains what precedes it. These are
     * two measures -- everything on the page, and the part of it a test can
     * reach by name -- so they get a sentence each.
     */
    const line = livePageSummary({
      counts: { buttons: 0, fields: 1, links: 3 },
      controls: 1,
    });

    expect(line).not.toContain(":");
    expect(line).toContain("One of these is a control a test can reach by name.");
  });

  it("does not exclude links from a count they appear in", () => {
    const line = livePageSummary({
      counts: { buttons: 0, fields: 1, links: 3 },
      controls: 1,
      offSite: 3,
    });

    // The exclusion is from the controls, not from what was on the page.
    expect(line).toContain("not counted among them");
    expect(line).not.toContain("left out of the count");
  });

  it("reads correctly for a single off-site link", () => {
    const line = livePageSummary({ counts: { buttons: 1, fields: 0, links: 1 }, controls: 1, offSite: 1 });

    expect(line).toContain("1 link leads to another site");
    expect(line).toContain("it is not counted");
  });

  it("says nothing about off-site links when there are none", () => {
    const line = livePageSummary({ counts: { buttons: 2, fields: 1, links: 0 }, controls: 3, offSite: 0 });

    expect(line).not.toContain("another site");
  });

  it("says how the page was seen", () => {
    expect(livePageSummary({ counts: { buttons: 1, fields: 1, links: 1 } })).toContain("seen signed out");
    expect(
      livePageSummary({ counts: { buttons: 1, fields: 1, links: 1 }, signedIn: true }),
    ).toContain("seen signed in with your test account");
  });

  it("leaves headings out when the caller does not count them", () => {
    // The coverage page has no heading count; the generator does.
    expect(livePageSummary({ counts: { buttons: 1, fields: 1, links: 1 } })).not.toContain("heading");
  });
});
