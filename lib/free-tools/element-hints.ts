import "server-only";

import type { Page } from "playwright-core";

/**
 * The test attributes that tell same-named elements apart.
 *
 * An accessibility tree names what a person sees, so a product list shows six
 * buttons all called "Add to cart" and nothing to pick the backpack's. Sites
 * that care about testing put a stable attribute on each one
 * (data-test="add-to-cart-sauce-labs-backpack"). Without those, the model
 * guesses at container structure it cannot see, and every fix misses. This
 * lists visible controls that carry such an attribute, one per line, in the
 * form a locator can be written from.
 */

export const TEST_ATTRIBUTES = ["data-testid", "data-test", "data-test-id", "data-qa", "data-cy"] as const;

const MAX_HINTS = 80;

export async function readElementHints(page: Page): Promise<string[]> {
  return page
    .evaluate(
      ({ attributes, max }) => {
        const selector = "button, a[href], input, select, textarea, [role=button], [role=link], [role=checkbox], [role=tab], [role=menuitem]";
        const lines: string[] = [];
        for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
          if (lines.length >= max) break;
          const attribute = attributes.find((name) => element.hasAttribute(name));
          if (!attribute) continue;
          const box = element.getBoundingClientRect();
          if (box.width === 0 && box.height === 0) continue;
          const kind = element.getAttribute("role") ?? (element.tagName === "A" ? "link" : element.tagName.toLowerCase());
          const text = (
            element.getAttribute("aria-label") ??
            (element as HTMLInputElement).placeholder ??
            element.innerText ??
            (element as HTMLInputElement).value ??
            ""
          )
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 60);
          if (kind === "input" && (element as HTMLInputElement).type === "password") {
            lines.push(`input[type=password] [${attribute}="${element.getAttribute(attribute)}"]`);
            continue;
          }
          lines.push(`${kind} "${text}" [${attribute}="${(element.getAttribute(attribute) ?? "").slice(0, 80)}"]`);
        }
        return lines;
      },
      { attributes: [...TEST_ATTRIBUTES], max: MAX_HINTS },
    )
    .catch(() => []);
}
