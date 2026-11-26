import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LayoutFaultsPanel } from "@/components/free-tools/layout-faults-panel";

/**
 * What the reader is told about the page's layout.
 *
 * Three inputs, three different meanings, and collapsing any two of them is
 * the product claiming something it did not establish. The first version of
 * the check returned `[]` on failure, the same value as a clean page, so the
 * screen said "No layout faults on this page" for a check that never ran.
 * That is pinned here because the panel is now the only place the wording
 * lives, shared by the generator and Coverage Review.
 */
const markup = (faults: { kind: string; what: string }[] | null | undefined) =>
  renderToStaticMarkup(<LayoutFaultsPanel faults={faults} />);

describe("the layout panel", () => {
  it("says a checked page is clean, out loud", () => {
    // A check that is silent on success cannot be told apart from one that
    // did not run, so success is stated rather than implied by absence.
    const html = markup([]);

    expect(html).toContain("No layout faults on this page");
  });

  it("says nothing at all when the check could not run", () => {
    expect(markup(null)).toBe("");
  });

  it("says nothing for a record made before the check existed", () => {
    expect(markup(undefined)).toBe("");
  });

  it("lists each fault and counts them in the singular", () => {
    const html = markup([
      { kind: "stylesheet_failed", what: "A stylesheet did not load (/app.css), so the page rendered unstyled." },
    ]);

    expect(html).toContain("1 layout fault on this page");
    expect(html).toContain("/app.css");
  });

  it("counts several in the plural and shows all of them", () => {
    const html = markup([
      { kind: "clipped_text", what: "Text is cut off inside button." },
      { kind: "overlap", what: "Two controls overlap." },
      { kind: "small_target", what: "A target is too small." },
    ]);

    expect(html).toContain("3 layout faults on this page");
    expect(html).toContain("Text is cut off inside button.");
    expect(html).toContain("Two controls overlap.");
    expect(html).toContain("A target is too small.");
  });

  it("states that these are not test failures", () => {
    /*
     * The whole reason the faults are reported separately. A reader who takes
     * them as failures will distrust a passing run; a reader who takes a
     * passing run as a verdict on the page will ship a broken one. The
     * sentence is what stops both readings, so it is not decoration.
     */
    const html = markup([{ kind: "overlap", what: "Two controls overlap." }]);

    expect(html).toContain("not test failures");
    expect(html).toContain("never change a run");
  });
});
