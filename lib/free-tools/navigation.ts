/**
 * `page.goto('/')` means the site root, not the page the test was written for.
 * With a baseURL of https://demo.playwright.dev/todomvc/ it opens
 * https://demo.playwright.dev/ -- a 404 -- in PlaywrightGen's runner and in
 * Playwright alike. Models write '/' for "open the page" anyway, so when the
 * page lives below the root, '/' (with an optional query or hash) is rewritten
 * to the page relative to its folder: './' for a folder, './page.html' for a
 * file. Paths that name something ('/todomvc/', '/login') are left alone.
 */
export function alignRootNavigation(code: string, pageUrl: string): { code: string; rewritten: number } {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return { code, rewritten: 0 };
  }
  const lastSlash = url.pathname.lastIndexOf("/");
  if (lastSlash <= 0) return { code, rewritten: 0 };
  const page = `./${url.pathname.slice(lastSlash + 1)}`;
  let rewritten = 0;
  const next = code.replace(/\.goto\(\s*(['"`])\/((?:[?#][^'"`$]*)?)\1/g, (_match, quote: string, suffix: string) => {
    rewritten += 1;
    return `.goto(${quote}${page}${suffix}${quote}`;
  });
  return { code: next, rewritten };
}
