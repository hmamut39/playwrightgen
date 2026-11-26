/**
 * Layout faults a single run can prove, without a baseline.
 *
 * Every assertion this product writes is functional: a role, a name, a piece
 * of text. That leaves it blind to a whole class of fault. A test can pass
 * green while the page is visibly broken -- the stylesheet failed to load,
 * the label is clipped to "Add to ca", two controls sit on top of each other
 * -- and the product would report a passing run and call the behaviour
 * proven. That is false confidence of exactly the kind it exists to refuse.
 *
 * Found on 2026-11-26, prompted by a visual-testing tool sent to the owner.
 *
 * **Why not screenshot diffing.** The usual answer is to store an approved
 * image and compare pixels. Three reasons that is the wrong answer here.
 * Baselines are the largest single source of flake in real suites, because
 * fonts, anti-aliasing and animation move pixels nobody can see. They need an
 * approval workflow -- who approved this image, at which version -- which is
 * a whole subsystem. And a product whose identity is declining to assert what
 * it cannot back should not adopt the one technique known for crying wolf.
 *
 * So: only faults a single load can establish on its own evidence. No stored
 * image, nothing to approve, and no threshold anybody has to tune. Each one
 * below is either true of the page or not.
 *
 * The split matters. `readLayoutFaults` runs in the browser and can only be
 * exercised against a real page; `describeLayoutFaults` is pure and holds
 * every judgement about what is worth reporting, so the judgements are
 * testable without a browser.
 */

/**
 * The smallest interactive box that is not a fault.
 *
 * WCAG 2.2 success criterion 2.5.8 (Target Size, Minimum) sets 24 by 24 CSS
 * pixels. The number is cited rather than chosen: a threshold this product
 * invented would be a guess presented as a finding, and the first person to
 * disagree with it would be right to.
 */
const MINIMUM_TARGET_PX = 24;

/**
 * How much two controls must share before it is called an overlap.
 *
 * Interactive elements touch legitimately all the time -- a one-pixel seam
 * between adjacent table cells, a focus ring, a rounded corner. Sixteen
 * square pixels is four by four: smaller than any glyph, so nothing a reader
 * could notice is below it, and above it the controls genuinely cover one
 * another.
 */
const OVERLAP_FLOOR_PX2 = 16;

/**
 * How much text must be cut off before it is called clipped.
 *
 * A container reports a scroll width a pixel or two over its client width
 * from rounding alone, especially under a fractional device pixel ratio. Four
 * pixels is under one character at any readable size, so this reports text a
 * reader has actually lost rather than sub-pixel arithmetic.
 */
const CLIP_FLOOR_PX = 4;

/** At most this many of any one kind, so a systemic fault cannot drown the rest. */
const MAX_PER_KIND = 4;

export type RawLayoutFinding =
  | { kind: "stylesheet_failed"; href: string }
  | { kind: "horizontal_overflow"; overflowPx: number; widest: string }
  | { kind: "clipped_text"; label: string; hiddenPx: number }
  | { kind: "overlap"; a: string; b: string; sharedPx2: number }
  | {
      kind: "small_target";
      label: string;
      width: number;
      height: number;
      /**
       * Whether this target sits inside a sentence.
       *
       * WCAG 2.2's 2.5.8 exempts it then -- the "Inline" exception, for a
       * target "in a sentence or whose size is otherwise constrained by the
       * line-height of non-target text". Without this the check reported
       * every credit link in a footer: measured on the TodoMVC demo, three
       * findings, all of them prose links 11 to 16px tall and all of them
       * allowed by the standard being quoted at them. Citing a standard and
       * then ignoring its exceptions is worse than not citing one.
       */
      inlineInText: boolean;
    };

export type LayoutFaultKind = RawLayoutFinding["kind"];

export type LayoutFault = {
  kind: LayoutFaultKind;
  /** One sentence a reader can act on, naming the evidence. */
  what: string;
};

/**
 * Worst first, and the order is a claim about consequence rather than taste.
 *
 * A stylesheet that did not load breaks the whole page, so it leads. Clipped
 * text and overlapping controls cost the reader something specific. Sideways
 * scrolling is usually one wide element and usually survivable. A small tap
 * target is a real barrier but a local one, so it goes last -- and a page
 * built of small targets would otherwise fill the whole report.
 */
const SEVERITY: LayoutFaultKind[] = [
  "stylesheet_failed",
  "clipped_text",
  "overlap",
  "horizontal_overflow",
  "small_target",
];

function round(value: number) {
  return Math.round(value);
}

function sentence(finding: RawLayoutFinding): string {
  switch (finding.kind) {
    case "stylesheet_failed":
      return `A stylesheet did not load (${finding.href}), so the page rendered unstyled.`;
    case "clipped_text":
      return `Text is cut off inside ${finding.label}: ${round(finding.hiddenPx)}px of it cannot be read.`;
    case "overlap":
      return `${finding.a} and ${finding.b} overlap, sharing ${round(finding.sharedPx2)}px² -- one is covering the other.`;
    case "horizontal_overflow":
      return `The page scrolls sideways by ${round(finding.overflowPx)}px; the widest element is ${finding.widest}.`;
    case "small_target":
      return `${finding.label} is ${round(finding.width)}×${round(finding.height)}px, under the ${MINIMUM_TARGET_PX}×${MINIMUM_TARGET_PX}px minimum in WCAG 2.2 (2.5.8).`;
  }
}

/**
 * Whether a raw finding clears its own floor.
 *
 * Kept separate from the sentence so that a finding dropped here can never
 * be described: the floors are the whole reason this output can be trusted,
 * and a reported fault that sits under one would discredit the rest.
 */
function worthReporting(finding: RawLayoutFinding): boolean {
  switch (finding.kind) {
    case "stylesheet_failed":
      return finding.href.length > 0;
    case "clipped_text":
      return finding.hiddenPx >= CLIP_FLOOR_PX;
    case "overlap":
      return finding.sharedPx2 >= OVERLAP_FLOOR_PX2 && finding.a !== finding.b;
    case "horizontal_overflow":
      // One pixel of sideways scroll is rounding, not a layout fault.
      return finding.overflowPx >= CLIP_FLOOR_PX;
    case "small_target":
      // The standard's own Inline exception, applied before its minimum.
      if (finding.inlineInText) return false;
      return (
        finding.width > 0 &&
        finding.height > 0 &&
        (finding.width < MINIMUM_TARGET_PX || finding.height < MINIMUM_TARGET_PX)
      );
  }
}

/**
 * The faults worth telling a reader about, worst first.
 *
 * Deduplicated by the sentence itself rather than by element, because the
 * same fault reached through two selectors is one fault to the reader, and a
 * report that says the same thing twice reads as a report that is not
 * counting.
 */
export function describeLayoutFaults(findings: readonly RawLayoutFinding[]): LayoutFault[] {
  const kept: LayoutFault[] = [];
  const seen = new Set<string>();
  const countByKind = new Map<LayoutFaultKind, number>();

  const ordered = [...findings].sort(
    (left, right) => SEVERITY.indexOf(left.kind) - SEVERITY.indexOf(right.kind),
  );

  for (const finding of ordered) {
    if (!worthReporting(finding)) continue;
    const used = countByKind.get(finding.kind) ?? 0;
    if (used >= MAX_PER_KIND) continue;
    const what = sentence(finding);
    if (seen.has(what)) continue;
    seen.add(what);
    countByKind.set(finding.kind, used + 1);
    kept.push({ kind: finding.kind, what });
  }

  return kept;
}

/**
 * One line naming what the layout check found, or that it found nothing.
 *
 * "Nothing" is said out loud on purpose. A check that is silent when it
 * passes is indistinguishable from a check that did not run, and the reader
 * has no way to tell which they got.
 */
export function layoutFaultsPhrase(faults: readonly LayoutFault[]): string {
  if (faults.length === 0) {
    return "No layout faults found: nothing clipped, overlapping, or scrolling sideways.";
  }
  if (faults.length === 1) return "1 layout fault found.";
  return `${faults.length} layout faults found.`;
}

/**
 * What the page itself reports about its layout.
 *
 * Runs as one function inside the browser, so it takes no imports and every
 * threshold it needs is passed in. It gathers evidence and makes no
 * judgements: everything about what counts lives in `describeLayoutFaults`,
 * where it can be tested.
 */
/**
 * Stylesheets the browser said it could not fetch, as findings.
 *
 * Kept pure and separate from the page read because the evidence comes from
 * somewhere else: the network, during navigation, where a refused or 404'd
 * request is a fact the browser reports. Inside the page the same fault is
 * invisible -- see the note in the reader.
 *
 * The address is shortened to its path. A full URL with a cache-busting
 * query is unreadable in a one-line finding, and the query is never the part
 * that is wrong.
 */
export function stylesheetFailures(urls: readonly string[]): RawLayoutFinding[] {
  const seen = new Set<string>();
  const findings: RawLayoutFinding[] = [];
  for (const url of urls) {
    let href = url;
    try {
      const parsed = new URL(url);
      href = parsed.pathname || url;
    } catch {
      // Not an absolute URL; the raw value is the most honest thing to show.
    }
    if (!href || seen.has(href)) continue;
    seen.add(href);
    findings.push({ kind: "stylesheet_failed", href: href.slice(0, 120) });
  }
  return findings;
}

export type LayoutReadablePage = {
  evaluate(
    fn: (argument: { minimumTarget: number }) => RawLayoutFinding[],
    argument: { minimumTarget: number },
  ): Promise<RawLayoutFinding[]>;
};

/**
 * Whether the page could be read at all, kept apart from what was found.
 *
 * The first version of this returned `[]` when the read failed, which is the
 * same value it returns for a page with nothing wrong. So a browser that
 * refused evaluation and a clean page were indistinguishable, and the screen
 * said "No layout faults on this page" for both. That is the product
 * asserting something it did not establish -- the exact failure it exists to
 * refuse -- and it was found on 2026-11-26 by running the reader against a
 * fixture built with five faults in it and getting zero back.
 *
 * Making the two cases different shapes means no caller can collapse them by
 * accident; a caller that wants to show a verdict has to say which it has.
 */
export type LayoutRead = { read: true; findings: RawLayoutFinding[] } | { read: false };

export async function readLayoutFaults(page: LayoutReadablePage): Promise<LayoutRead> {
  try {
    const findings = await page.evaluate(
      ({ minimumTarget }: { minimumTarget: number }) => {
        /*
         * One pass, and deliberately no helper functions.
         *
         * This function's source is serialized and evaluated inside the
         * browser, where nothing from this module exists. A bundler that
         * preserves function names (esbuild's keepNames, which `tsx` turns
         * on) rewrites a named inner function into `__name(fn, "fn")`, and
         * `__name` is a helper that lives in the bundle, not in the page. The
         * whole read then dies with "ReferenceError: __name is not defined".
         *
         * Collecting everything in one pass removes the need for helpers
         * entirely, which is both bundler-proof and cheaper: each element is
         * measured once rather than once per check.
         */
        const found: RawLayoutFinding[] = [];
        const root = document.documentElement;
        const viewportWidth = root.clientWidth;

        type Record = {
          element: Element;
          label: string;
          rect: DOMRect;
          interactive: boolean;
          visible: boolean;
          inlineInText: boolean;
          clipsContent: boolean;
          hasText: boolean;
          hiddenPx: number;
        };
        const records: Record[] = [];

        for (const element of Array.from(document.body.querySelectorAll("*")).slice(0, 2000)) {
          const style = getComputedStyle(element);
          const visible =
            style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) !== 0;

          const role = element.getAttribute("role") || element.tagName.toLowerCase();
          const text = element instanceof HTMLElement ? element.innerText : "";
          const labelText =
            element.getAttribute("aria-label") ||
            (text ? text.trim().slice(0, 40) : "") ||
            element.getAttribute("name") ||
            element.getAttribute("placeholder") ||
            "";

          records.push({
            element,
            label: labelText ? `${role} "${labelText}"` : role,
            rect: element.getBoundingClientRect(),
            interactive: element.matches(
              'a[href], button, input, select, textarea, [role="button"], [role="link"]',
            ),
            visible,
            /*
             * An inline element carrying text is in the text flow, so its
             * height is the line-height of the prose around it -- which is
             * exactly the condition WCAG 2.2's 2.5.8 Inline exception
             * describes. An inline-block or block control is laid out on its
             * own and gets no exemption.
             */
            inlineInText: style.display === "inline" && Boolean(text && text.trim()),
            // `text-overflow: ellipsis` is text cut off on purpose, and the
            // page already signals it to the reader, so it is not a fault.
            clipsContent:
              (style.overflowX === "hidden" || style.overflow === "hidden") &&
              style.textOverflow !== "ellipsis",
            hasText: Boolean(text && text.trim()),
            hiddenPx: element.scrollWidth - element.clientWidth,
          });
        }

        /*
         * A failed stylesheet is not detectable from here, and the attempt to
         * do it was wrong. `link.sheet === null` was the test; measured in
         * Chromium on 2026-11-26, an aborted stylesheet leaves `link.sheet`
         * as an *empty* CSSStyleSheet, and `document.styleSheets` counts it,
         * so the failed sheet and the working one were indistinguishable --
         * both reported `sheetIsNull: false`. Falling back to "a sheet with
         * no rules" would have been a guess: an empty stylesheet is legal,
         * and a cross-origin one throws on access while being perfectly
         * loaded.
         *
         * So it is read from the network instead, where the browser states
         * the outcome rather than implying it. See `stylesheetFailures` and
         * its caller in page-snapshot.
         */

        // Sideways scrolling, with the widest element named so it is actionable.
        const overflowPx = root.scrollWidth - viewportWidth;
        if (overflowPx > 0) {
          let widest = "(unknown)";
          let widestPx = viewportWidth;
          for (const record of records) {
            if (record.rect.width > widestPx) {
              widestPx = record.rect.width;
              widest = record.label;
            }
          }
          found.push({ kind: "horizontal_overflow", overflowPx, widest });
        }

        for (const record of records) {
          // Text its own container cuts off.
          if (record.clipsContent && record.hasText && record.hiddenPx > 0) {
            found.push({ kind: "clipped_text", label: record.label, hiddenPx: record.hiddenPx });
          }
          // Tap targets below the standard's minimum.
          if (
            record.interactive &&
            record.visible &&
            record.rect.width > 0 &&
            record.rect.height > 0 &&
            (record.rect.width < minimumTarget || record.rect.height < minimumTarget)
          ) {
            found.push({
              kind: "small_target",
              label: record.label,
              width: record.rect.width,
              height: record.rect.height,
              inlineInText: record.inlineInText,
            });
          }
        }

        /*
         * Controls covering one another. Nesting is skipped: a button inside
         * a link overlaps it by construction and that is not a fault, so only
         * pairs where neither contains the other are considered.
         */
        const controls = records.filter((record) => record.interactive && record.visible).slice(0, 300);
        for (let i = 0; i < controls.length; i += 1) {
          for (let j = i + 1; j < controls.length; j += 1) {
            const first = controls[i];
            const second = controls[j];
            if (first.element.contains(second.element) || second.element.contains(first.element)) continue;
            const a = first.rect;
            const b = second.rect;
            const sharedWidth = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const sharedHeight = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (sharedWidth <= 0 || sharedHeight <= 0) continue;
            found.push({
              kind: "overlap",
              a: first.label,
              b: second.label,
              sharedPx2: sharedWidth * sharedHeight,
            });
          }
        }

        return found;
      },
      { minimumTarget: MINIMUM_TARGET_PX },
    );
    return { read: true, findings };
  } catch {
    /*
     * The read failed, and that is reported as a failure rather than as an
     * empty result. It must never fail the page capture it rides along with
     * -- the draft and the proving run are the product, and this is extra
     * evidence beside them -- but the caller has to be able to tell "nothing
     * is wrong" from "nobody looked".
     */
    return { read: false };
  }
}
