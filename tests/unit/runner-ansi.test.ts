import { describe, expect, it } from "vitest";

import { stripControlSequences } from "@/lib/integrations/runner/ansi";

/**
 * Built rather than typed, so no invisible byte sits in this file where a
 * reader cannot see it and a diff cannot show it.
 */
const ESC = String.fromCharCode(27);

/**
 * The sample below is the real thing. The first failure ingested from GitHub
 * Actions arrived with Playwright's colour codes wrapped around its call log,
 * which rendered in the workspace as "[2m" and "[22m" sitting inside the
 * sentence a reviewer was trying to read.
 */
describe("stripping runner control sequences", () => {
  it("removes the colour codes Playwright wraps around a call log", () => {
    const raw =
      "Error: page.goto: Protocol error (Page.navigate): Cannot navigate to " +
      `invalid URL Call log: ${ESC}[2m - navigating to "/cart", waiting until "load"${ESC}[22m`;

    expect(stripControlSequences(raw)).toBe(
      "Error: page.goto: Protocol error (Page.navigate): Cannot navigate to " +
        'invalid URL Call log:  - navigating to "/cart", waiting until "load"',
    );
  });

  it("keeps text that merely looks like an escape sequence", () => {
    // Without a real escape character these are ordinary characters in a
    // message, and removing them would delete part of the failure.
    const raw = "Expected [2m] but received [22m] in the array";

    expect(stripControlSequences(raw)).toBe(raw);
  });

  it("leaves ordinary failure text untouched", () => {
    const raw = 'expect(received).toBeVisible() — locator: getByRole("button")';

    expect(stripControlSequences(raw)).toBe(raw);
  });

  it("removes multi-parameter and reset sequences", () => {
    expect(stripControlSequences(`${ESC}[1;31mfailed${ESC}[0m`)).toBe("failed");
  });

  it("handles an empty string", () => {
    expect(stripControlSequences("")).toBe("");
  });
});
