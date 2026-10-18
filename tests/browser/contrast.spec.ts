import { expect, test } from "@playwright/test";

// Plain JavaScript, shared with the signed-in audit script so one rule
// cannot drift into two.
import { ACCESSIBILITY, interactionContrast, LOW_CONTRAST } from "../../scripts/browser-audit.mjs";

/**
 * What the public pages owe a reader who is not using a mouse and good eyes.
 *
 * Contrast is the part of design that is not a matter of taste: text below
 * the WCAG AA ratio is hard to read on an ordinary laptop and unreadable for
 * a good many people. It is also the part that rots quietly -- a label gets a
 * lighter grey because it looked busy, and nobody measures it again.
 *
 * Measured on 2026-10-18: nine failing styles on six pages, led by
 * `text-slate-400` on white at 2.63 where 4.5 is required -- the product's own
 * subtitle in the header, the eyebrow labels on every card, the "(optional)"
 * hints beside form labels, the tools table's column headings. White on
 * `bg-cyan-600` was 3.62, a near miss that reads fine to whoever chose it.
 *
 * The rules themselves live in `scripts/browser-audit.mjs`, because the
 * signed-in walk (`npm run audit:phone`) measures the workspace with the same
 * ones and two copies of a rule become two rules.
 */
const PUBLIC_PAGES = ["/", "/generator", "/coverage-review", "/mcp", "/pricing", "/about"];

type Issue = { rule: string; detail: string; cls?: string };

async function sweep(page: import("@playwright/test").Page, measure: unknown) {
  const found: Array<Issue & { path: string }> = [];
  for (const path of PUBLIC_PAGES) {
    await page.goto(path, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1_200);
    for (const issue of (await page.evaluate(measure as never)) as Issue[]) {
      found.push({ ...issue, path });
    }
  }
  // Named one per line, because "three failures" sends somebody hunting and
  // the detail says which rule to change.
  return found.map((issue) => `${issue.path}  ${issue.rule}: ${issue.detail} ${issue.cls ?? ""}`.trimEnd()).join("\n");
}

test("public pages keep every piece of text above the contrast floor", async ({ page }) => {
  test.setTimeout(180_000);
  const report = await sweep(page, LOW_CONTRAST);
  expect(report, `text below the WCAG AA contrast floor:\n${report}`).toBe("");
});

/**
 * The barriers a sighted mouse user never notices: a control with no name, a
 * field whose only label is a placeholder that leaves when you type, an image
 * with no alt, headings that skip a level, a focus the keyboard cannot see.
 *
 * The same walk over the workspace found a real one on 2026-10-18 -- the
 * "where this project runs" field had a placeholder and no label at all.
 */
/**
 * The states a person reads a control in just before pressing it.
 *
 * Left out of the first contrast pass on purpose -- nothing had measured a
 * hover and changing how an interaction feels on a guess is not the same as
 * fixing a defect. Measured on 2026-10-18: "Open Workspace", the primary
 * call to action on every page, went to white on cyan-600 under the pointer,
 * which is 3.62:1 where 4.5 is the floor.
 */
test("controls stay readable under the pointer and the keyboard", async ({ page }) => {
  test.setTimeout(180_000);
  const found = [];
  for (const path of PUBLIC_PAGES) {
    await page.goto(path, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1_000);
    for (const issue of await interactionContrast(page)) {
      found.push(`${path}  ${issue.rule}: ${issue.detail} ${issue.cls}`);
    }
  }
  const report = found.join("\n");
  expect(report, `controls below the contrast floor in an interaction state:\n${report}`).toBe("");
});

test("public pages name their controls and show where the keyboard is", async ({ page }) => {
  test.setTimeout(180_000);
  const report = await sweep(page, ACCESSIBILITY);
  expect(report, `accessibility barriers:\n${report}`).toBe("");
});
