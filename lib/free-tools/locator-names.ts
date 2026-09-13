/**
 * The accessible names a Playwright file targets by name.
 *
 * Only literal names in getByRole(..., { name }), getByLabel, getByText and
 * getByPlaceholder count. A word appearing anywhere else in the file -- a
 * test title, an environment variable, a CSS id such as #login-button -- is
 * not a locator, and counting it would report controls as covered that no
 * test reaches by name. Regular-expression and template names are skipped
 * because they cannot be compared honestly with a page.
 */
export function extractLocatorNames(code: string): string[] {
  const names: string[] = [];
  const patterns = [
    /getByRole\(\s*["'`][a-z]+["'`]\s*,\s*\{[^}]*?\bname:\s*(["'`])((?:(?!\1).){1,200})\1/g,
    /getBy(?:Label|Text|Placeholder)\(\s*(["'`])((?:(?!\1).){1,200})\1/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      const name = match[2].trim();
      if (name && !name.includes("${")) names.push(name);
    }
  }
  return [...new Set(names)];
}

export function normalizeName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
