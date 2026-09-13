import { describe, expect, it } from "vitest";

import { slugify } from "@/lib/format/slug";

/** The rule the create-project form and the service both enforce. */
const SLUG_RULE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe("deriving a slug from a name", () => {
  it("lowercases and joins words with hyphens", () => {
    expect(slugify("Checkout Flow")).toBe("checkout-flow");
  });

  it("turns the underscore people reach for into a hyphen", () => {
    // The exact input that the old required field rejected without explanation.
    expect(slugify("playwright_test")).toBe("playwright-test");
  });

  it("folds accents rather than dropping the letter", () => {
    expect(slugify("Café Payments")).toBe("cafe-payments");
  });

  it("collapses punctuation and trims stray separators", () => {
    expect(slugify("  --Release: v2.0!!  ")).toBe("release-v2-0");
  });

  it("keeps possessives as one word", () => {
    expect(slugify("Aylin's team")).toBe("aylins-team");
    expect(slugify("O’Brien QA")).toBe("obrien-qa");
  });

  it("falls back rather than producing an empty slug", () => {
    // A name with no Latin letters leaves nothing to keep, and an empty slug
    // would fail the rule the service enforces.
    expect(slugify("ھەسەنجان")).toBe("project");
    expect(slugify("")).toBe("project");
  });

  it("always satisfies the slug rule", () => {
    for (const name of ["Checkout Flow", "playwright_test", "Café", "--x--", "ھەسەنجان", "A".repeat(300)]) {
      expect(slugify(name)).toMatch(SLUG_RULE);
      expect(slugify(name).length).toBeLessThanOrEqual(100);
    }
  });
});
