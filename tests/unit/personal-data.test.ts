import { describe, expect, it } from "vitest";

import { redactionNote, redactPersonalData } from "@/lib/ai/personal-data";

/**
 * Masking a customer's page before a model reads it.
 *
 * Two ways to get this wrong, and the second is the one that would be
 * discovered late. Masking too little sends people's addresses and card
 * numbers to a third party with nothing on screen saying so. Masking too much
 * destroys the accessibility tree the product exists to build locators from,
 * and the generated test then fails on the real page for a reason nobody can
 * see in the code.
 *
 * So the over-masking cases below matter as much as the under-masking ones. A
 * tree is mostly labels, prices, counts, dates and version numbers, and every
 * one of them has to survive.
 */
describe("masking personal data in a page tree", () => {
  it("masks an address but leaves it recognisable as one", () => {
    const { text, found } = redactPersonalData('- textbox "Email": priya.raman@acme.co.uk');

    expect(found.emails).toBe(1);
    expect(text).not.toContain("priya.raman");
    expect(text).not.toContain("acme.co.uk");
    // Still an address shape: the model must know this field takes an email.
    expect(text).toContain("@");
  });

  it("leaves the label beside it alone, so a locator still works", () => {
    // getByRole('textbox', { name: 'Email' }) has to keep working. The label
    // carries no digits and no @, which is why this holds by construction.
    const { text } = redactPersonalData('- textbox "Email address"\n- textbox "Phone number"');

    expect(text).toContain('"Email address"');
    expect(text).toContain('"Phone number"');
  });

  it("masks a card number", () => {
    const { text, found } = redactPersonalData("- text: 4111 1111 1111 1111");

    expect(found.longNumbers).toBe(1);
    expect(text).not.toContain("4111");
  });

  it("masks a phone number in the shapes people write them", () => {
    const written = ["+44 20 7946 0958", "(020) 7946-0958", "020 7946 0958"];

    for (const number of written) {
      const { found } = redactPersonalData(`- text: ${number}`);
      expect(found.total, `did not mask ${number}`).toBeGreaterThan(0);
    }
  });

  it("counts several on one page", () => {
    const { found } = redactPersonalData(
      ['- text: ana@example.com', '- text: bo@example.com', "- text: 4111111111111111"].join("\n"),
    );

    expect(found.emails).toBe(2);
    expect(found.longNumbers).toBe(1);
    expect(found.total).toBe(3);
  });
});

describe("what it must not touch", () => {
  const untouched = (label: string, tree: string) =>
    it(`leaves ${label} alone`, () => {
      const { text, found } = redactPersonalData(tree);

      expect(found.total, `masked something in: ${tree}`).toBe(0);
      expect(text).toBe(tree);
    });

  untouched("a counter", '- status: 1 item left');
  untouched("a price", '- text: "$1,299.00"');
  untouched("a quantity and a total", '- text: 3 items · 42 results');
  untouched("a version number", "- text: PlaywrightGen 16.4.6");
  untouched("a year", "- heading: Orders 2026");
  untouched("a short id", '- row "Order #88214"');
  untouched("a time", "- text: 09:37");
  untouched("the labels a locator is built from", '- textbox "Email"\n- button "Send invitation"');

  it("leaves an ISO date alone", () => {
    // Reaches the phone pattern through its separators, and is ordinary page
    // furniture on every list screen there is.
    const { found, text } = redactPersonalData("- text: 2026-11-21");

    expect(found.phones).toBe(0);
    expect(text).toContain("2026-11-21");
  });

  it("does not touch an empty tree", () => {
    expect(redactPersonalData("").found.total).toBe(0);
  });
});

describe("what the reader is told", () => {
  it("says nothing when there was nothing", () => {
    expect(redactionNote({ emails: 0, longNumbers: 0, phones: 0, total: 0 })).toBeNull();
  });

  it("names what it masked, and admits what it cannot catch", () => {
    const note = redactionNote({ emails: 12, longNumbers: 0, phones: 4, total: 16 });

    expect(note).toContain("12 email addresses");
    expect(note).toContain("4 phone numbers");
    expect(note).toContain("never sent to the model");
    // The honest half: a name in a table cell is indistinguishable from a
    // product name, and saying otherwise would be the more dangerous claim.
    expect(note).toContain("Names and free text cannot be detected");
  });

  it("reads correctly for exactly one", () => {
    const note = redactionNote({ emails: 1, longNumbers: 0, phones: 0, total: 1 });

    expect(note).toContain("1 email address");
    expect(note).not.toContain("addresses");
    expect(note).toContain("it was");
  });
});
