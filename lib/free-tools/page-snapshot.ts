import "server-only";

import { chromium } from "playwright-core";

/**
 * What a real page looks like to a test: its accessibility tree.
 *
 * Quick Generate used to take a page URL as "context only" -- a string the
 * model never looked behind -- so every locator it wrote was a guess, and the
 * code filled up with defensive helpers that tried three selectors and swallowed
 * the errors. Opening the page and reading its accessibility tree gives the
 * model the exact roles and accessible names Playwright's getByRole and
 * getByLabel will match, which is the difference between a draft that runs and
 * one that has to be rewritten.
 *
 * The page is opened in a remote browser (Browserless), never on our servers,
 * so a URL cannot reach anything on our network. It is still restricted to
 * public http(s) addresses, bounded in time and size, and its content is
 * handed to the model as untrusted data, not instructions. The page is seen
 * signed out: behind a login, only the login page is visible.
 */

export type PageSnapshot =
  | {
      ok: true;
      finalUrl: string;
      title: string;
      aria: string;
      testIds: string[];
      truncated: boolean;
      /** Roles counted from the tree, for a one-line summary to the reader. */
      counts: { buttons: number; links: number; fields: number; headings: number };
    }
  | { ok: false; reason: "not_configured" | "blocked_address" | "unreachable" | "timeout" };

const MAX_ARIA_CHARS = 14_000;
const NAVIGATION_TIMEOUT_MS = 20_000;
const TOTAL_TIMEOUT_MS = 30_000;

/**
 * Only public web addresses. The browser that opens them is remote, so this
 * is not the only line of defence, but there is no reason to spend a render on
 * an address that cannot be a public page.
 */
export function isPublicWebAddress(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host.includes(".") && !host.includes(":")) return false;
  if (host === "localhost" || /\.(localhost|local|internal|lan|home|corp)$/.test(host)) return false;
  // Literal private, loopback, link-local and reserved IPv4 ranges.
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  // Any literal IPv6 address: loopback, link-local and unique-local included.
  if (host.includes(":")) return false;
  return true;
}

function countRoles(aria: string) {
  const count = (pattern: RegExp) => (aria.match(pattern) ?? []).length;
  return {
    buttons: count(/^\s*- button\b/gm),
    links: count(/^\s*- link\b/gm),
    fields: count(/^\s*- (?:textbox|searchbox|combobox|checkbox|radio|spinbutton|slider|switch)\b/gm),
    headings: count(/^\s*- heading\b/gm),
  };
}

export async function capturePageSnapshot(
  url: string,
  options: { endpoint?: string } = {},
): Promise<PageSnapshot> {
  const token = process.env.BROWSERLESS_API_KEY?.trim();
  if (!token && !options.endpoint) return { ok: false, reason: "not_configured" };
  if (!isPublicWebAddress(url)) return { ok: false, reason: "blocked_address" };

  const endpoint =
    options.endpoint ?? `wss://production-sfo.browserless.io?token=${encodeURIComponent(token!)}`;

  const work = async (): Promise<PageSnapshot> => {
    const browser = await chromium.connectOverCDP(endpoint, { timeout: 12_000 });
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
      // Client-rendered apps paint after DOMContentLoaded; give them a moment,
      // but never wait on a page that keeps the network busy forever.
      await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => {});
      const finalUrl = page.url();
      if (!isPublicWebAddress(finalUrl)) return { ok: false, reason: "blocked_address" };
      const [title, fullAria, testIds] = await Promise.all([
        page.title(),
        page.locator("body").ariaSnapshot({ timeout: 8_000 }),
        page.evaluate(() =>
          Array.from(document.querySelectorAll("[data-testid]"))
            .map((element) => element.getAttribute("data-testid") ?? "")
            .filter(Boolean)
            .slice(0, 60),
        ),
      ]);
      // Link targets are noise for writing locators and cost the most space.
      const aria = fullAria.replace(/^\s*- \/url: .*$/gm, "").replace(/\n{2,}/g, "\n");
      return {
        ok: true,
        finalUrl,
        title: title.slice(0, 300),
        aria: aria.slice(0, MAX_ARIA_CHARS),
        testIds: [...new Set(testIds)].map((id) => id.slice(0, 100)),
        truncated: aria.length > MAX_ARIA_CHARS,
        counts: countRoles(aria),
      };
    } finally {
      await browser.close().catch(() => {});
    }
  };

  try {
    return await Promise.race([
      work(),
      new Promise<PageSnapshot>((resolve) =>
        setTimeout(() => resolve({ ok: false, reason: "timeout" }), TOTAL_TIMEOUT_MS),
      ),
    ]);
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}
