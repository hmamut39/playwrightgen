/**
 * getByTestId matches data-testid, and nothing else unless the Playwright
 * config says so. Plenty of sites use data-test, data-qa or data-cy instead,
 * and models reach for getByTestId anyway, so a draft that names the right
 * element still finds nothing. When a page's controls show which attribute the
 * site uses, getByTestId calls are rewritten to a CSS attribute locator for it,
 * so the code works in any Playwright project without a config change.
 */

const HINT_ATTRIBUTE = /\[(data-[a-z-]+)="([^"]*)"\]/g;

/** The attribute a page's test hooks use, read from element hints; null when unclear or data-testid. */
export function siteTestIdAttribute(hints: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const line of hints) {
    for (const match of line.matchAll(HINT_ATTRIBUTE)) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  if (counts.has("data-testid") || counts.size === 0) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** Rewrites getByTestId('x') to locator('[attribute="x"]'). Returns the code unchanged when attribute is null. */
export function alignTestIdLocators(code: string, attribute: string | null): { code: string; rewritten: number } {
  if (!attribute) return { code, rewritten: 0 };
  let rewritten = 0;
  const next = code.replace(/\.getByTestId\(\s*(['"`])([^'"`\\$]*)\1\s*\)/g, (_match, _quote, value: string) => {
    rewritten += 1;
    return `.locator('[${attribute}="${value}"]')`;
  });
  return { code: next, rewritten };
}

/** Element hints appended to a failure tree by the runner. */
export function hintsFromFailureTree(tree: string): string[] {
  const marker = tree.indexOf("# Controls with test attributes");
  return marker === -1 ? [] : tree.slice(marker).split("\n").slice(1).filter(Boolean);
}

/**
 * Container roles take no accessible name from their text: a list item that
 * shows "Buy milk" is still an unnamed listitem, so getByRole('listitem',
 * { name: 'Buy milk' }) never matches. Written as a text filter it does. Left
 * alone when the page's tree shows that exact role and name (an aria-label).
 */
const CONTAINER_NAME =
  /\.getByRole\(\s*(['"])(listitem|article|group|list)\1\s*,\s*\{\s*name:\s*(?:(['"])((?:(?!\3)[^\\\n])*)\3|([A-Za-z_$][\w$]*))\s*(?:,\s*exact:\s*(?:true|false)\s*)?\}\s*\)/g;

export function alignContainerNames(code: string, aria = ""): { code: string; rewritten: number } {
  let rewritten = 0;
  const next = code.replace(
    CONTAINER_NAME,
    (match, _q, role: string, quote: string | undefined, name: string | undefined, variable: string | undefined) => {
      if (name !== undefined && aria.includes(`${role} "${name}"`)) return match;
      rewritten += 1;
      // name: 'literal' keeps its quotes; name: variable stays a variable.
      return `.getByRole('${role}').filter({ hasText: ${variable ?? `${quote}${name}${quote}`} })`;
    },
  );
  return { code: next, rewritten };
}
