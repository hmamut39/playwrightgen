import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every reason the page reader can give has a sentence somewhere.
 *
 * The reader returns a code and the free tools turn it into English. Add a
 * code without adding the sentence and a visitor meets the fallback, which
 * says the page "could not be opened" whatever actually happened -- a page
 * that answered 404 and a page behind a sign-in wall get the same shrug.
 *
 * Checked by reading the source rather than by importing it: the reader
 * pulls in Playwright and a remote browser, and this question is about text.
 *
 * The code that prompted it, on 2026-10-18: a real 404 page was read as a
 * success. It loads, it has a title and a heading, so the reader handed it
 * over as though it were the application and the draft was written from the
 * wrong page -- under the words "Live page read". The status is the signal
 * that needs no guessing, and `error_page` is what it reports now.
 */
const root = resolve(__dirname, "..", "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

/** The reason codes the snapshot type allows, taken from its own union. */
function reasonsFromSource(): string[] {
  const source = read("lib/free-tools/page-snapshot.ts");
  const start = source.indexOf("      reason:");
  const end = source.indexOf(";", start);
  const union = source.slice(start, end);
  return [...union.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
}

describe("what a visitor is told when the page cannot be read", () => {
  const reasons = reasonsFromSource();

  it("knows the reasons the reader can give", () => {
    expect(reasons).toContain("error_page");
    expect(reasons).toContain("blocked_address");
    expect(reasons.length).toBeGreaterThanOrEqual(6);
  });

  it("has a sentence for every one, on every tool that shows them", () => {
    for (const file of ["app/generator/page.tsx", "app/coverage-review/page.tsx"]) {
      const source = read(file);
      for (const reason of reasons) {
        // `not_configured` and the rest are keys in the page's own map; the
        // test is that the key exists, not what it says.
        expect(source, `${file} has no message for ${reason}`).toContain(`${reason}:`);
      }
    }
  });

  it("refuses an error page rather than reading it", () => {
    const source = read("lib/free-tools/page-snapshot.ts");
    // The status is taken from the navigation response, not guessed from the
    // page's text, and anything from 400 up is refused.
    expect(source).toContain("const status = response?.status();");
    expect(source).toMatch(/status >= 400/);
    expect(source).toContain('reason: "error_page"');
  });
});
