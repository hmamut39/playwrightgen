import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Whether every public page is recognisably the same product.
 *
 * The site grew one page at a time and nothing checked that a new one looked
 * like the others, so one quietly did not. Measured by hand on 2026-11-26:
 * /about was a bare column of text with no panel of any kind, on the one page
 * a stranger is sent to and a search engine quotes. A grep found it once;
 * this is the same measure kept, so the next page cannot drift the same way
 * without somebody deciding to let it.
 *
 * **What is asserted universally, and what is not.** Only the panel is. Three
 * attempts at a stronger rule each turned out to encode a preference rather
 * than the language:
 *
 * - "Every page leads with a dark hero" fails /engineering-review, which
 *   leads with a white panel and a cyan eyebrow. That is a choice on a task
 *   page, not a defect, and a test that forced a dark panel onto it would be
 *   making the code serve the test.
 * - "Every page has an eyebrow" fails /pricing, which opens with a badge pill
 *   instead. Also a choice.
 * - A loose "contains bg-slate-950" passes a page whose only dark thing is a
 *   button -- which is exactly what the old /about was, so the first version
 *   of this file reported that page as having a hero. The predicate has to
 *   require the dark background and the rounded surface in one class
 *   attribute to mean anything.
 *
 * **What this cannot do.** It reads source text. That catches a page built
 * without the language at all, which is the failure that happened. It cannot
 * judge whether a page looks good, and it is not a substitute for opening one:
 * every real fault in this area, including the index that silently stopped
 * sticking, was found in a screenshot and not here.
 */
const PUBLIC_PAGES = [
  "page.tsx",
  "about/page.tsx",
  "pricing/page.tsx",
  "mcp/page.tsx",
  "terms/page.tsx",
  "privacy/page.tsx",
  "generator/page.tsx",
  "coverage-review/page.tsx",
  "engineering-review/page.tsx",
] as const;

/** Pages that lead with the dark panel. /engineering-review leads with a light one. */
const DARK_LED_PAGES = PUBLIC_PAGES.filter((page) => page !== "engineering-review/page.tsx");

/** A page whose design lives in a shell component it renders instead. */
const RENDERS_A_SHELL: Record<string, string> = {
  "onboarding/page.tsx": "components/auth/clerk-auth-shell.tsx",
};

function source(relative: string): string {
  return readFileSync(join(process.cwd(), "app", relative), "utf8");
}

/** The rounded surface the product's content sits on, anywhere on the page. */
const hasPanel = (text: string) => /rounded-\[2rem\]|rounded-3xl/.test(text);

/** The small uppercase label above a heading. */
const hasEyebrow = (text: string) => /uppercase tracking-\[0\.1/.test(text);

/**
 * A dark panel: the rounded surface and the dark background in one class
 * attribute. Two separate matches anywhere in the file would be satisfied by a
 * white card and a black button, which is not a hero.
 */
const hasDarkPanel = (text: string) =>
  /class[Nn]ame="[^"]*(rounded-\[2rem\]|rounded-3xl)[^"]*(bg-slate-950|bg-\[#0)[^"]*"/.test(text) ||
  /class[Nn]ame="[^"]*(bg-slate-950|bg-\[#0)[^"]*(rounded-\[2rem\]|rounded-3xl)[^"]*"/.test(text);

describe("every public page speaks the product's design language", () => {
  it.each(PUBLIC_PAGES)("%s puts its content on a panel", (page) => {
    // The one rule that holds everywhere, and the one the old /about broke.
    expect(hasPanel(source(page))).toBe(true);
  });

  it.each(DARK_LED_PAGES)("%s leads with a dark panel", (page) => {
    expect(hasDarkPanel(source(page))).toBe(true);
  });

  it("names /about, the page that failed this", () => {
    // On its own so a regression reads as what it is rather than as one row
    // of a parameterised list.
    const text = source("about/page.tsx");

    expect(hasDarkPanel(text)).toBe(true);
    expect(hasEyebrow(text)).toBe(true);
    expect(hasPanel(text)).toBe(true);
  });

  it("looks in the shell for a page that renders one", () => {
    /*
     * /onboarding reads as bare by every measure above and is not: its hero
     * and eyebrow come from ClerkAuthShell. The first version of this measure
     * was a grep over app/ alone, which reported onboarding as the worst page
     * on the site -- it was about to be rebuilt before the shell was read.
     */
    for (const [page, shell] of Object.entries(RENDERS_A_SHELL)) {
      const pageText = source(page);
      const shellText = readFileSync(join(process.cwd(), shell), "utf8");

      expect(hasPanel(pageText) || hasPanel(shellText)).toBe(true);
      expect(hasEyebrow(pageText) || hasEyebrow(shellText)).toBe(true);
    }
  });
});

describe("long documents can be navigated and linked into", () => {
  /*
   * A reader arrives at terms or privacy with one question. Without anchors
   * nothing can be linked to, and without an index the only way to find the
   * answer is to read the whole page.
   */
  const DOCUMENTS = ["about/page.tsx", "terms/page.tsx", "privacy/page.tsx"] as const;

  it.each(DOCUMENTS)("%s carries a section index", (page) => {
    expect(source(page)).toContain("PageSectionIndex");
  });

  it.each(DOCUMENTS)("%s offsets its anchors past the sticky header", (page) => {
    /*
     * The site header is `sticky top-0`, so a browser jumping to a heading
     * parks it underneath the header and the reader lands on a section whose
     * title they cannot see. Without this the index is worse than no index.
     */
    expect(source(page)).toContain("scroll-mt-24");
  });

  it.each(DOCUMENTS)("%s writes its anchor ids down rather than deriving them", (page) => {
    /*
     * A slug generated from a heading changes the moment the heading is
     * edited, and the link a reader saved stops working with nothing to show
     * that it broke. The ids are part of the content.
     */
    expect(source(page)).toMatch(/id: "[a-z0-9-]+"|id="[a-z0-9-]+"/);
  });
});
