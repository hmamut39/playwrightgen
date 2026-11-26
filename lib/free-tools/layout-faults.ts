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

/**
 * The smallest box that is displaying text to anybody.
 *
 * Text meant only for a screen reader is hidden with the long-standing
 * `width: 1px; height: 1px; overflow: hidden` pattern, which by construction
 * reports its full text width as overflow. Measured on PlaywrightGen's own
 * pages on 2026-11-26: `label "Page URL"` said 71px of its text could not be
 * read, and 71px is exactly how wide "Page URL" is. The text was not clipped;
 * it was never meant to be seen, and it is doing its job.
 *
 * Four pixels, because no box that small is showing a glyph to anyone.
 */
const MIN_DISPLAYED_BOX_PX = 4;

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
 * What one reading of the page, at one width, found.
 *
 * The width is carried rather than assumed, because a fault that exists only
 * at one width has to say so. "The page scrolls sideways by 420px" is
 * bewildering to somebody reading it on the desktop where it does not happen;
 * "at 390px wide, the page scrolls sideways by 420px" is a thing they can go
 * and look at.
 */
export type WidthReading = { width: number; findings: readonly RawLayoutFinding[] };

/**
 * The faults across every width the page was read at, attributed.
 *
 * Reading one width was the check's largest blind spot. Measured on
 * 2026-11-26 across eleven pages at six widths: every real fault it has ever
 * found appeared only at phone width -- including the four in this product's
 * own site. A layout fault is usually a width problem, so a check at one
 * width finds the minority of them.
 *
 * A fault present at every width is stated plainly. One present at some gets
 * the widths in front of it, because that is the part the reader needs first.
 * A failed stylesheet is never attributed: it is a network outcome and has
 * nothing to do with how wide the window is.
 */
export function describeLayoutFaultsAcrossWidths(
  readings: readonly WidthReading[],
): LayoutFault[] {
  if (readings.length === 0) return [];
  if (readings.length === 1) return describeLayoutFaults(readings[0].findings);

  /*
   * First occurrence of each distinct fault, and every width it appeared at.
   * The first is kept rather than the worst: the numbers differ by width and
   * picking the largest would quietly report a measurement from one width
   * under a sentence attributed to all of them.
   */
  const merged: RawLayoutFinding[] = [];
  const widthsByKey = new Map<string, number[]>();
  for (const reading of readings) {
    for (const finding of reading.findings) {
      if (!worthReporting(finding)) continue;
      const key = faultKey(finding);
      const widths = widthsByKey.get(key);
      if (widths) {
        if (!widths.includes(reading.width)) widths.push(reading.width);
        continue;
      }
      widthsByKey.set(key, [reading.width]);
      merged.push(finding);
    }
  }

  // Ordering, capping and deduplication all stay in one place.
  const described = describeLayoutFaults(merged);
  const everyWidth = readings.length;

  return described.map((fault) => {
    const source = merged.find((finding) => sentence(finding) === fault.what);
    const widths = source ? (widthsByKey.get(faultKey(source)) ?? []) : [];
    if (fault.kind === "stylesheet_failed") return fault;
    if (widths.length === 0 || widths.length === everyWidth) return fault;
    const at = [...widths].sort((left, right) => left - right).map((width) => `${width}px`);
    const where = at.length === 1 ? at[0] : `${at.slice(0, -1).join(", ")} and ${at[at.length - 1]}`;
    // Lower-cased, because the sentence now continues a clause.
    const rest = fault.what.charAt(0).toLowerCase() + fault.what.slice(1);
    return { ...fault, what: `At ${where} wide, ${rest}` };
  });
}

/**
 * The layout faults as plain text, for somewhere there is no screen.
 *
 * The editor connection and the workspace both read the same page as the free
 * generator and both threw this away, so an assistant in somebody's editor
 * could report a passing test on a page whose stylesheet had not loaded, and
 * the workspace's own page coverage could call a page covered without ever
 * looking at it.
 *
 * `null` for a check that could not run, because saying nothing is the only
 * honest thing available then -- and distinct from `[]`, which is a page that
 * was checked and is clean, and which says so out loud.
 */
export function layoutFaultReport(faults: readonly LayoutFault[] | null): string | null {
  if (!faults) return null;
  if (faults.length === 0) {
    return "Layout: nothing clipped, overlapping, or scrolling sideways on the page read.";
  }
  return [
    `Layout: ${faults.length === 1 ? "1 fault" : `${faults.length} faults`} on the page read.`,
    ...faults.map((fault) => `- ${fault.what}`),
    // Said every time. A reader who takes these as failures will distrust a
    // passing run; one who takes a passing run as a verdict on the page will
    // ship a broken one.
    "These are not test failures and do not change the run's verdict.",
  ].join("\n");
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
/**
 * How long to wait before asking the page the same question again.
 *
 * Long enough for a reveal or entrance animation to finish -- the common ones
 * run 150 to 300ms -- and short enough that it is not felt beside a page load
 * and a model call.
 */
const SETTLE_MS = 400;

/**
 * What identifies a finding across two readings of the same page.
 *
 * Geometry, not identity: the same pair of controls overlapping, the same
 * label clipped. The measured amount is deliberately left out, because a
 * fault that persists while shifting by a pixel is still the same fault.
 */
function faultKey(finding: RawLayoutFinding): string {
  switch (finding.kind) {
    case "stylesheet_failed":
      return `stylesheet:${finding.href}`;
    case "horizontal_overflow":
      return "overflow";
    case "clipped_text":
      return `clipped:${finding.label}`;
    case "overlap":
      // Sorted, so the same pair found in either order is one fault.
      return `overlap:${[finding.a, finding.b].sort().join("|")}`;
    case "small_target":
      return `small:${finding.label}`;
  }
}

/**
 * The findings still true after the page settled.
 *
 * Every geometric fault here is measured from one instant, and a page in the
 * middle of an entrance animation is briefly a page where everything overlaps
 * everything. Measured on PlaywrightGen's own home page on 2026-11-26: two
 * stacked buttons reported as sharing 1993px, which they never do once the
 * reveal finishes.
 *
 * So a fault counts only if it is there twice, 400ms apart. A transient
 * state cannot survive that, and a real fault is unaffected by it. The later
 * measurement is the one reported, because it describes the page as it comes
 * to rest.
 */
export function faultsPresentInBoth(
  first: readonly RawLayoutFinding[],
  second: readonly RawLayoutFinding[],
): RawLayoutFinding[] {
  const before = new Set(first.map(faultKey));
  return second.filter((finding) => before.has(faultKey(finding)));
}

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

/** The thresholds the page script needs, passed in because it has no imports. */
export type LayoutReadArguments = { minimumTarget: number; minDisplayedBox: number };

export type LayoutReadablePage = {
  evaluate(
    fn: (argument: LayoutReadArguments) => RawLayoutFinding[],
    argument: LayoutReadArguments,
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

export async function readLayoutFaults(
  page: LayoutReadablePage,
  options: { settle?: (ms: number) => Promise<void> } = {},
): Promise<LayoutRead> {
  try {
    const readOnce = () =>
      page.evaluate(
      ({ minimumTarget, minDisplayedBox }: { minimumTarget: number; minDisplayedBox: number }) => {
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
          /** A text field, select or textarea: a box other controls sit inside on purpose. */
          isField: boolean;
          visible: boolean;
          inlineInText: boolean;
          /**
           * Whether this element's own children are text and nothing else.
           *
           * `scrollWidth - clientWidth` on a wrapper measures whatever
           * overflows it, which is usually not its text: a section with
           * `overflow-hidden` and one wide decorative child reports exactly
           * the same numbers as a button whose label is cut in half. And
           * `innerText` on a wrapper returns every descendant's text, so the
           * wrapper looks like it has text of its own.
           *
           * Measured on PlaywrightGen's own pages on 2026-11-26: four pages
           * each reported "128px of it cannot be read" about section
           * wrappers whose text was entirely readable. Only a leaf can say
           * that its own text does not fit.
           */
          leafWithText: boolean;
          /**
           * Whether an ancestor's clipping leaves nothing of this on screen.
           *
           * A collapsed section held shut with `max-height: 0; overflow:
           * hidden` keeps real rectangles for everything inside it, in the
           * place they would occupy if it were open. Those rectangles sit
           * underneath whatever is painted there, so every control in a
           * closed panel overlapped the controls of the panel below it.
           *
           * Measured on /generator on 2026-11-26: the test-account fields,
           * which are collapsed until asked for, were reported as
           * overlapping "Add evidence files" and "Generate Playwright draft"
           * by up to 6768px. Nothing was overlapping; none of it was on
           * screen.
           */
          clippedAway: boolean;
          /** The box actually showing content, used to spot hidden-for-screen-readers text. */
          displayedBox: boolean;
          clipsContent: boolean;
          hasText: boolean;
          hiddenPx: number;
        };
        const records: Record[] = [];

        for (const element of Array.from(document.body.querySelectorAll("*")).slice(0, 2000)) {
          const style = getComputedStyle(element);
          /*
           * Ask the browser whether this is on screen, rather than working it
           * out from computed style.
           *
           * `checkVisibility` accounts for the cases hand-written checks miss,
           * and the one that mattered was a closed `<details>`: its children
           * keep the rectangles they would have if it were open, laid out
           * past the end of the element's own box, and every ancestor reports
           * `overflow: visible`, so neither an inherited-style walk nor a
           * clipping test can see that they are hidden.
           *
           * Measured on /generator at 390px on 2026-11-26: the collapsed
           * test-account fields sat at y=2171 while their `<details>` ended
           * at y=2084, and were reported as overlapping "Generate Playwright
           * draft" by 6768px. `checkVisibility()` returned false for every
           * one of them. The platform already knew.
           */
          let visible =
            style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) !== 0;
          const ask = (element as unknown as {
            checkVisibility?: (options: {
              checkOpacity: boolean;
              checkVisibilityCSS: boolean;
              contentVisibilityAuto: boolean;
            }) => boolean;
          }).checkVisibility;
          if (typeof ask === "function") {
            visible = ask.call(element, {
              checkOpacity: true,
              checkVisibilityCSS: true,
              contentVisibilityAuto: true,
            });
          }
          /*
           * Transparency and hiding are inherited in effect but not in
           * computed style: an element inside an `opacity: 0` reveal wrapper
           * reports `opacity: 1` for itself and still has a real rectangle.
           * Without walking up, a not-yet-revealed section's controls were
           * compared against the visible ones and reported as overlapping.
           */
          if (visible && typeof ask !== "function") {
            let ancestor = element.parentElement;
            while (ancestor && ancestor !== document.body) {
              const ancestorStyle = getComputedStyle(ancestor);
              if (
                ancestorStyle.visibility === "hidden" ||
                ancestorStyle.display === "none" ||
                Number(ancestorStyle.opacity) === 0
              ) {
                visible = false;
                break;
              }
              ancestor = ancestor.parentElement;
            }
          }

          const role = element.getAttribute("role") || element.tagName.toLowerCase();
          const text = element instanceof HTMLElement ? element.innerText : "";
          const labelText =
            element.getAttribute("aria-label") ||
            (text ? text.trim().slice(0, 40) : "") ||
            element.getAttribute("name") ||
            element.getAttribute("placeholder") ||
            "";

          /*
           * Whether anything of this element survives its ancestors'
           * clipping. Walked from the element outward, intersecting its
           * rectangle with each clipping ancestor's: if any intersection is
           * empty, the element is laid out somewhere nothing is painted.
           */
          const rect = element.getBoundingClientRect();
          let clippedAway = false;
          let clipper = element.parentElement;
          while (clipper && clipper !== document.documentElement) {
            const clipperStyle = getComputedStyle(clipper);
            if (clipperStyle.overflowX !== "visible" || clipperStyle.overflowY !== "visible") {
              const bounds = clipper.getBoundingClientRect();
              const sharedWidth = Math.min(rect.right, bounds.right) - Math.max(rect.left, bounds.left);
              const sharedHeight = Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top);
              if (sharedWidth <= 0 || sharedHeight <= 0) {
                clippedAway = true;
                break;
              }
            }
            clipper = clipper.parentElement;
          }

          records.push({
            element,
            label: labelText ? `${role} "${labelText}"` : role,
            rect,
            interactive: element.matches(
              'a[href], button, input, select, textarea, [role="button"], [role="link"]',
            ),
            isField: element.matches("input, select, textarea"),
            visible,
            clippedAway,
            displayedBox:
              element.clientWidth > minDisplayedBox && element.clientHeight > minDisplayedBox,
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
            leafWithText: element.children.length === 0 && Boolean(text && text.trim()),
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
          // Text its own container cuts off, asked only of leaves.
          if (
            record.clipsContent &&
            record.leafWithText &&
            record.displayedBox &&
            !record.clippedAway &&
            record.hiddenPx > 0
          ) {
            found.push({ kind: "clipped_text", label: record.label, hiddenPx: record.hiddenPx });
          }
          // Tap targets below the standard's minimum.
          if (
            record.interactive &&
            record.visible &&
            !record.clippedAway &&
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
        const controls = records
          .filter((record) => record.interactive && record.visible && !record.clippedAway)
          .slice(0, 300);
        for (let i = 0; i < controls.length; i += 1) {
          for (let j = i + 1; j < controls.length; j += 1) {
            const first = controls[i];
            const second = controls[j];
            if (first.element.contains(second.element) || second.element.contains(first.element)) continue;
            /*
             * An inline element's bounding box is not a shape it occupies.
             * A link in a sentence that wraps across two lines has one box
             * spanning the full width of both, so any two links in the same
             * wrapped paragraph appear to overlap while never visually
             * touching.
             *
             * Measured on the home page at 390px on 2026-11-26: "try a
             * ready-made demo" and "open your Workspace", two inline links in
             * one 48px-tall paragraph of prose, reported as sharing 1993px.
             * They sit on separate lines. Per-line fragments are available
             * through getClientRects(), but two links in a text flow cannot
             * meaningfully cover one another at all, so the pair is skipped.
             */
            if (first.inlineInText || second.inlineInText) continue;
            /*
             * A control sitting wholly inside a form field is deliberate.
             *
             * Show-password, clear-this-input and inline search buttons are
             * all positioned inside the field they belong to, so their boxes
             * are contained by it by design. Measured on /sign-up on
             * 2026-11-26: Clerk's "Show password" button was reported as
             * covering the password input by 832px, which is the button's own
             * area -- it is entirely within the field, exactly where it is
             * meant to be.
             *
             * Containment is required, not mere overlap, and one of the pair
             * has to be a field. A genuine collision between two controls
             * shows up as a partial overlap, and that is still reported.
             */
            if (first.isField || second.isField) {
              const outer = first.isField ? first.rect : second.rect;
              const inner = first.isField ? second.rect : first.rect;
              const inside =
                inner.left >= outer.left - 1 &&
                inner.right <= outer.right + 1 &&
                inner.top >= outer.top - 1 &&
                inner.bottom <= outer.bottom + 1;
              if (inside) continue;
            }
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
        { minimumTarget: MINIMUM_TARGET_PX, minDisplayedBox: MIN_DISPLAYED_BOX_PX },
      );

    /*
     * Twice, because one instant is not evidence about a page that is still
     * animating. Only what is true in both readings is reported; the second
     * supplies the numbers, since it describes the page at rest.
     */
    const before = await readOnce();
    const settle = options.settle ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    await settle(SETTLE_MS);
    const after = await readOnce();
    return { read: true, findings: faultsPresentInBoth(before, after) };
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
