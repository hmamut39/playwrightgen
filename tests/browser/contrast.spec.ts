import { expect, test } from "@playwright/test";

/**
 * Every piece of text on the public pages, measured against what is behind it.
 *
 * Contrast is the one part of design that is not a matter of taste: text below
 * the WCAG AA ratio is hard to read for someone with ordinary eyesight on an
 * ordinary laptop, and unreadable for a good many people. It is also the part
 * that rots quietly -- a label gets a lighter grey because it looked busy, and
 * nobody measures it again.
 *
 * Found by measuring on 2026-10-18: nine failing styles on six pages, led by
 * `text-slate-400` on white at 2.63 where 4.5 is required -- the product's own
 * subtitle in the header, the eyebrow labels on every card, the "(optional)"
 * hints beside form labels, and the tools table's column headings. White on
 * `bg-cyan-600` was 3.62, a near miss that reads fine to whoever chose it.
 *
 * What this cannot see: text over a gradient or an image, where there is no
 * background colour to read. Those are skipped rather than guessed at, which
 * is why the first version of this measurement reported every dark panel on
 * the site as failing.
 */
const PUBLIC_PAGES = ["/", "/generator", "/coverage-review", "/mcp", "/pricing", "/about"];

type Failure = {
  ratio: number;
  required: number;
  size: number;
  text: string;
  cls: string;
};

test("public pages keep every piece of text above the contrast floor", async ({ page }) => {
  test.setTimeout(180_000);
  const failures: Array<Failure & { path: string }> = [];

  for (const path of PUBLIC_PAGES) {
    await page.goto(path, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1_200);

    const found = await page.evaluate(() => {
      // Tailwind v4 writes colours as lab(), so the browser converts them
      // rather than a regular expression: a 1x1 canvas fill, read as sRGB.
      const surface = document.createElement("canvas");
      surface.width = 1;
      surface.height = 1;
      const context = surface.getContext("2d", { willReadFrequently: true });
      const toRgb = (value: string) => {
        if (!context || !value || value === "transparent") return null;
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = "#000";
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data;
        return { r, g, b, a: alpha / 255 };
      };
      const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
        const channel = (value: number) => {
          const scaled = value / 255;
          return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      };
      /** The colour behind this text, or null when it cannot be known. */
      const backgroundOf = (node: Element) => {
        let element: Element | null = node;
        while (element) {
          const style = getComputedStyle(element);
          if (style.backgroundImage && style.backgroundImage !== "none") return null;
          const colour = toRgb(style.backgroundColor);
          if (colour && colour.a > 0.5) return colour;
          element = element.parentElement;
        }
        return { r: 255, g: 255, b: 255, a: 1 };
      };

      const out: Failure[] = [];
      for (const node of document.querySelectorAll("p, span, li, a, h1, h2, h3, h4, td, th, label, div, button")) {
        if (node.children.length > 0) continue;
        const text = (node.textContent ?? "").trim();
        if (text.length < 4) continue;
        const style = getComputedStyle(node);
        if (style.visibility === "hidden" || style.display === "none") continue;
        const box = node.getBoundingClientRect();
        if (box.width < 2 || box.height < 2) continue;
        const foreground = toRgb(style.color);
        if (!foreground || foreground.a < 0.5) continue;
        const background = backgroundOf(node);
        if (!background) continue;

        const first = luminance(foreground);
        const second = luminance(background);
        const ratio = (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
        const size = parseFloat(style.fontSize);
        const bold = Number.parseInt(style.fontWeight, 10) >= 700;
        // WCAG AA: 3:1 for large text, 4.5:1 for everything else.
        const required = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
        if (ratio < required) {
          out.push({
            ratio: Math.round(ratio * 100) / 100,
            required,
            size: Math.round(size),
            text: text.slice(0, 50),
            cls: (typeof node.className === "string" ? node.className : "").slice(0, 80),
          });
        }
      }
      return out;
    });

    for (const failure of found) failures.push({ ...failure, path });
  }

  // Named one per line, because "three failures" sends somebody hunting and
  // the ratio, the size and the class say which rule to change.
  const report = failures
    .map((f) => `${f.path}  ${f.ratio}:1 (needs ${f.required}:1)  ${f.size}px  "${f.text}"  ${f.cls}`)
    .join("\n");
  expect(report, `text below the WCAG AA contrast floor:\n${report}`).toBe("");
});
