import "server-only";

import { chromium, type Browser } from "playwright-core";

import { readElementHints } from "@/lib/free-tools/element-hints";
import { isPublicWebAddress } from "@/lib/free-tools/public-address";
import { signInWithTestAccount, type TestAccount } from "@/lib/free-tools/sign-in";

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
 * signed out unless the person supplies a test account for this one request
 * (see sign-in.ts); then it is read as that account sees it.
 */

export { isPublicWebAddress } from "@/lib/free-tools/public-address";

export type PageSnapshot =
  | {
      ok: true;
      finalUrl: string;
      title: string;
      aria: string;
      testIds: string[];
      /** Controls with a test attribute, e.g. button "Add to cart" [data-test="add-to-cart-backpack"]. */
      elementHints: string[];
      truncated: boolean;
      /** Roles counted from the tree, for a one-line summary to the reader. */
      counts: { buttons: number; links: number; fields: number; headings: number };
      /** Present when a test account signed in first: the login form's tree. */
      signedIn?: { loginForm: string };
    }
  | {
      ok: false;
      reason: "not_configured" | "blocked_address" | "unreachable" | "timeout" | "no_login_form" | "sign_in_rejected";
    };

const MAX_ARIA_CHARS = 14_000;
const NAVIGATION_TIMEOUT_MS = 20_000;
const TOTAL_TIMEOUT_MS = 30_000;
/** Signing in adds a page load or two. */
const SIGNED_IN_TIMEOUT_MS = 50_000;

function countRoles(aria: string) {
  const count = (pattern: RegExp) => (aria.match(pattern) ?? []).length;
  return {
    buttons: count(/^\s*- button\b/gm),
    links: count(/^\s*- link\b/gm),
    fields: count(/^\s*- (?:textbox|searchbox|combobox|checkbox|radio|spinbutton|slider|switch)\b/gm),
    headings: count(/^\s*- heading\b/gm),
  };
}

/**
 * A browser in the remote service, or null when it is not configured.
 * Everything a free tool opens runs there, never on our servers.
 */
export async function connectRemoteBrowser(options: { endpoint?: string } = {}): Promise<Browser | null> {
  const token = process.env.BROWSERLESS_API_KEY?.trim();
  if (!token && !options.endpoint) return null;
  const endpoint =
    options.endpoint ?? `wss://production-sfo.browserless.io?token=${encodeURIComponent(token!)}`;
  return chromium.connectOverCDP(endpoint, { timeout: 12_000 });
}

export async function capturePageSnapshot(
  url: string,
  options: { endpoint?: string; account?: TestAccount } = {},
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
      let signedIn: { loginForm: string } | undefined;
      if (options.account) {
        const outcome = await signInWithTestAccount(page, options.account, url);
        if (!outcome.ok) {
          return { ok: false, reason: outcome.reason === "rejected" ? "sign_in_rejected" : outcome.reason };
        }
        signedIn = { loginForm: outcome.loginForm };
      }
      const finalUrl = page.url();
      if (!isPublicWebAddress(finalUrl)) return { ok: false, reason: "blocked_address" };
      const [title, fullAria, testIds, elementHints] = await Promise.all([
        page.title(),
        page.locator("body").ariaSnapshot({ timeout: 8_000 }),
        page.evaluate(() =>
          Array.from(document.querySelectorAll("[data-testid]"))
            .map((element) => element.getAttribute("data-testid") ?? "")
            .filter(Boolean)
            .slice(0, 60),
        ),
        readElementHints(page),
      ]);
      // Link targets are noise for writing locators and cost the most space.
      const aria = fullAria.replace(/^\s*- \/url: .*$/gm, "").replace(/\n{2,}/g, "\n");
      return {
        ok: true,
        finalUrl,
        title: title.slice(0, 300),
        aria: aria.slice(0, MAX_ARIA_CHARS),
        testIds: [...new Set(testIds)].map((id) => id.slice(0, 100)),
        elementHints,
        truncated: aria.length > MAX_ARIA_CHARS,
        counts: countRoles(aria),
        ...(signedIn ? { signedIn } : {}),
      };
    } finally {
      await browser.close().catch(() => {});
    }
  };

  // The remote browser now and then refuses a connection or drops one mid-load.
  // One quick retry turns that blip into a read page instead of a draft built
  // on guesses; a slow failure is not retried, to stay inside the time budget.
  const startedAt = Date.now();
  const attempt = async (): Promise<PageSnapshot> => {
    try {
      return await work();
    } catch (error) {
      if (Date.now() - startedAt > 12_000) throw error;
      await new Promise((resolve) => setTimeout(resolve, 800));
      return work();
    }
  };

  try {
    return await Promise.race([
      attempt(),
      new Promise<PageSnapshot>((resolve) =>
        setTimeout(() => resolve({ ok: false, reason: "timeout" }), options.account ? SIGNED_IN_TIMEOUT_MS : TOTAL_TIMEOUT_MS),
      ),
    ]);
  } catch (error) {
    // The reason matters when every page fails; the endpoint carries the API
    // key, so it is blanked out of the message.
    const message = (error instanceof Error ? error.message : String(error)).replace(/token=[^&\s"']+/g, "token=***");
    console.warn("[page-snapshot] could not read the page:", message.split("\n")[0].slice(0, 300));
    return { ok: false, reason: "unreachable" };
  }
}
