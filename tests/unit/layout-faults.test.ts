import { describe, expect, it } from "vitest";

import {
  describeLayoutFaults,
  layoutFaultsPhrase,
  readLayoutFaults,
  stylesheetFailures,
  type RawLayoutFinding,
} from "@/lib/free-tools/layout-faults";

/**
 * What the layout check is allowed to claim.
 *
 * Every assertion the product writes is functional -- a role, a name, a piece
 * of text -- so a test can pass green while the page is visibly broken. These
 * pin the other half: faults a single load establishes on its own evidence,
 * with no stored image and no threshold anybody tuned.
 *
 * The floors are the point. A layout report that fires on sub-pixel rounding
 * teaches the reader to ignore it, and then the real fault goes past unread.
 * So each floor is tested from both sides.
 */
describe("which layout findings are worth reporting", () => {
  it("reports text the container actually cuts off", () => {
    const faults = describeLayoutFaults([
      { kind: "clipped_text", label: 'button "Add to cart"', hiddenPx: 31 },
    ]);

    expect(faults).toHaveLength(1);
    expect(faults[0].what).toContain('button "Add to cart"');
    expect(faults[0].what).toContain("31px");
  });

  it("ignores a clip too small for a reader to lose a character to", () => {
    // Fractional device pixel ratios produce a pixel or two of this on pages
    // with nothing wrong with them.
    const faults = describeLayoutFaults([
      { kind: "clipped_text", label: "div", hiddenPx: 3 },
    ]);

    expect(faults).toEqual([]);
  });

  it("ignores two controls sharing less than a glyph", () => {
    const faults = describeLayoutFaults([
      { kind: "overlap", a: "button", b: "link", sharedPx2: 9 },
    ]);

    expect(faults).toEqual([]);
  });

  it("reports an overlap big enough to cover something", () => {
    const faults = describeLayoutFaults([
      { kind: "overlap", a: 'button "Buy"', b: 'link "Terms"', sharedPx2: 2400 },
    ]);

    expect(faults).toHaveLength(1);
    expect(faults[0].what).toContain("covering");
  });

  it("does not call an element an overlap with itself", () => {
    const faults = describeLayoutFaults([
      { kind: "overlap", a: 'button "Buy"', b: 'button "Buy"', sharedPx2: 900 },
    ]);

    expect(faults).toEqual([]);
  });

  it("ignores a pixel of sideways scroll and reports a real one", () => {
    expect(
      describeLayoutFaults([{ kind: "horizontal_overflow", overflowPx: 1, widest: "div" }]),
    ).toEqual([]);

    const real = describeLayoutFaults([
      { kind: "horizontal_overflow", overflowPx: 420, widest: 'img "hero"' },
    ]);
    expect(real[0].what).toContain("420px");
    expect(real[0].what).toContain('img "hero"');
  });
});

describe("the tap-target minimum", () => {
  it("holds a target at exactly the standard's size to be fine", () => {
    // 24x24 is the minimum in WCAG 2.2 (2.5.8), so 24 passes. Reporting the
    // boundary as a fault would make the product disagree with the standard
    // it cites, which is worse than not checking.
    const faults = describeLayoutFaults([
      { kind: "small_target", label: 'link "x"', width: 24, height: 24 },
    ]);

    expect(faults).toEqual([]);
  });

  it("reports a target one pixel under on either axis", () => {
    const narrow = describeLayoutFaults([
      { kind: "small_target", label: 'link "x"', width: 23, height: 24 },
    ]);
    const short = describeLayoutFaults([
      { kind: "small_target", label: 'link "x"', width: 24, height: 23 },
    ]);

    expect(narrow).toHaveLength(1);
    expect(short).toHaveLength(1);
    expect(narrow[0].what).toContain("WCAG 2.2");
  });

  it("ignores a control with no box at all", () => {
    // Zero-sized is a different fault, and usually a deliberately hidden
    // input. Calling it a small target would be a finding about nothing.
    const faults = describeLayoutFaults([
      { kind: "small_target", label: "input", width: 0, height: 0 },
    ]);

    expect(faults).toEqual([]);
  });
});

describe("how the report is ordered and bounded", () => {
  it("leads with the fault that breaks the whole page", () => {
    const faults = describeLayoutFaults([
      { kind: "small_target", label: 'link "a"', width: 10, height: 10 },
      { kind: "horizontal_overflow", overflowPx: 300, widest: "div" },
      { kind: "stylesheet_failed", href: "/app.css" },
      { kind: "clipped_text", label: "h1", hiddenPx: 40 },
    ]);

    expect(faults.map((fault) => fault.kind)).toEqual([
      "stylesheet_failed",
      "clipped_text",
      "horizontal_overflow",
      "small_target",
    ]);
  });

  it("says the same thing only once", () => {
    const twice: RawLayoutFinding[] = [
      { kind: "clipped_text", label: 'button "Save"', hiddenPx: 12 },
      { kind: "clipped_text", label: 'button "Save"', hiddenPx: 12 },
    ];

    expect(describeLayoutFaults(twice)).toHaveLength(1);
  });

  it("does not let one systemic fault drown every other kind", () => {
    /*
     * A page whose every icon button is 16px would otherwise return fifty
     * identical findings and bury the broken stylesheet underneath them.
     */
    const many: RawLayoutFinding[] = Array.from({ length: 30 }, (_, index) => ({
      kind: "small_target" as const,
      label: `link "${index}"`,
      width: 16,
      height: 16,
    }));

    const faults = describeLayoutFaults([...many, { kind: "stylesheet_failed", href: "/app.css" }]);

    expect(faults.filter((fault) => fault.kind === "small_target")).toHaveLength(4);
    expect(faults[0].kind).toBe("stylesheet_failed");
  });
});

describe("what the reader is told", () => {
  it("says out loud that nothing was found", () => {
    // A check that is silent when it passes cannot be told apart from a check
    // that never ran, and the reader has no way to know which they got.
    expect(layoutFaultsPhrase([])).toContain("No layout faults found");
  });

  it("counts in the singular and the plural", () => {
    expect(layoutFaultsPhrase([{ kind: "overlap", what: "x" }])).toBe("1 layout fault found.");
    expect(
      layoutFaultsPhrase([
        { kind: "overlap", what: "x" },
        { kind: "clipped_text", what: "y" },
      ]),
    ).toBe("2 layout faults found.");
  });
});

describe("reading the page", () => {
  it("says it could not read, rather than that it found nothing", async () => {
    /*
     * These were the same value once -- an empty array for both -- so a
     * browser that refused evaluation and a page with nothing wrong were
     * indistinguishable, and the screen said "No layout faults on this page"
     * for both. Found on 2026-11-26 by running the reader against a fixture
     * built with five faults in it and getting zero back.
     *
     * It must still never fail the capture it rides along with: the draft and
     * the proving run are the product, and this is evidence beside them.
     */
    const read = await readLayoutFaults({
      evaluate: async () => {
        throw new Error("execution context was destroyed");
      },
    });

    expect(read.read).toBe(false);
    expect(read).not.toHaveProperty("findings");
  });

  it("passes the findings through untouched, leaving judgement to the describer", async () => {
    const raw: RawLayoutFinding[] = [{ kind: "clipped_text", label: "p", hiddenPx: 2 }];
    const read = await readLayoutFaults({ evaluate: async () => raw });

    expect(read).toEqual({ read: true, findings: raw });
    // Still under the floor: the reader gathers, it does not decide.
    expect(describeLayoutFaults(read.read ? read.findings : [])).toEqual([]);
  });
});

describe("stylesheets the browser refused", () => {
  /*
   * This one fault cannot be seen from inside the page. Measured in Chromium
   * on 2026-11-26: an aborted stylesheet leaves `link.sheet` as an empty
   * CSSStyleSheet and `document.styleSheets` counts it, so the failed sheet
   * and a working one both reported `sheetIsNull: false`. The network states
   * the outcome the DOM only implies, so it is read from there.
   */
  it("names the path, not the cache-busting URL", () => {
    const faults = describeLayoutFaults(
      stylesheetFailures(["https://shop.example.com/assets/app.css?v=8c21f0"]),
    );

    expect(faults).toHaveLength(1);
    expect(faults[0].what).toContain("/assets/app.css");
    expect(faults[0].what).not.toContain("8c21f0");
    expect(faults[0].what).toContain("unstyled");
  });

  it("reports one sheet once, however many times the browser retried it", () => {
    const faults = describeLayoutFaults(
      stylesheetFailures([
        "https://example.com/app.css",
        "https://example.com/app.css",
        "https://example.com/theme.css",
      ]),
    );

    expect(faults).toHaveLength(2);
  });

  it("keeps a value it cannot parse rather than dropping the fault", () => {
    // A relative or malformed address is still a stylesheet that failed, and
    // showing the raw value tells the reader more than silence.
    const faults = describeLayoutFaults(stylesheetFailures(["/css/app.css"]));

    expect(faults[0].what).toContain("/css/app.css");
  });

  it("finds nothing when no stylesheet failed", () => {
    expect(stylesheetFailures([])).toEqual([]);
  });

  it("leads the report, because it breaks the whole page", () => {
    const faults = describeLayoutFaults([
      { kind: "small_target", label: 'link "a"', width: 8, height: 8 },
      ...stylesheetFailures(["https://example.com/app.css"]),
    ]);

    expect(faults[0].kind).toBe("stylesheet_failed");
  });
});
