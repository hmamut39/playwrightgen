import "server-only";

import { chromium, type Browser } from "playwright-core";

import { readElementHints } from "@/lib/free-tools/element-hints";
import {
  describeLayoutFaults,
  readLayoutFaults,
  stylesheetFailures,
  type LayoutFault,
} from "@/lib/free-tools/layout-faults";
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

import { redactPersonalData, type PersonalDataFound } from "@/lib/ai/personal-data";

export { isPublicWebAddress } from "@/lib/free-tools/public-address";
import { readLinkTargets, type LinkTarget } from "@/lib/free-tools/surface-coverage";

export type PageSnapshot =
  | {
      ok: true;
      finalUrl: string;
      title: string;
      aria: string;
      testIds: string[];
      /** Controls with a test attribute, e.g. button "Add to cart" [data-test="add-to-cart-backpack"]. */
      elementHints: string[];
      /** Each link's address, kept out of the tree but not thrown away. */
      linkTargets: LinkTarget[];
      truncated: boolean;
      /** Roles counted from the tree, for a one-line summary to the reader. */
      counts: { buttons: number; links: number; fields: number; headings: number };
      /**
       * Personal data masked out of the tree before anything read it.
       *
       * Carried on the snapshot rather than worked out again by each caller,
       * because the masking happens here and the count is only true of what
       * happened here.
       */
      redacted: PersonalDataFound;
      /**
       * Layout faults this one load established, worst first.
       *
       * The tree above says what the page offers; it cannot say whether the
       * page is readable. A control clipped to "Add to ca" has the same
       * accessible name as one that is not, so a test written from the tree
       * passes over it.
       *
       * An empty array means the check ran and found nothing. `null` means it
       * could not run, and that must never be shown to a reader as a clean
       * result -- the two were the same value once, and the screen called
       * both of them "no layout faults".
       */
      layoutFaults: LayoutFault[] | null;
      /** Present when a test account signed in first: the login form's tree. */
      signedIn?: { loginForm: string };
    }
  | {
      ok: false;
      reason:
        | "not_configured"
        | "blocked_address"
        | "unreachable"
        | "timeout"
        | "no_login_form"
        | "sign_in_rejected"
        | "error_page";
      /** The status an error page answered with, so the reason can say it. */
      status?: number;
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
      /*
       * Stylesheets the browser could not fetch, collected before navigating
       * because the evidence is the request itself and it is gone afterwards.
       *
       * This is the one layout fault the page cannot be asked about: an
       * aborted stylesheet leaves an empty CSSStyleSheet behind, which looks
       * exactly like a working one from inside the document. The network says
       * plainly what the DOM only implies.
       */
      const failedStylesheets: string[] = [];
      page.on("requestfailed", (request) => {
        if (request.resourceType() === "stylesheet") failedStylesheets.push(request.url());
      });
      page.on("response", (served) => {
        if (served.status() >= 400 && served.request().resourceType() === "stylesheet") {
          failedStylesheets.push(served.url());
        }
      });
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
      // An error page is a page: it loads, it has a heading and a title, and
      // the reader used to hand it over as though it were the application.
      // A draft written from a 404 is built entirely from the wrong page and
      // the visitor is told "Live page read", which is true and useless. The
      // status is the one signal that needs no guessing, so it is the one
      // used -- not sniffing the text for "not found".
      const status = response?.status();
      if (typeof status === "number" && status >= 400) {
        return { ok: false, reason: "error_page", status };
      }
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
      const [title, fullAria, testIds, elementHints, rawLayoutFaults] = await Promise.all([
        page.title(),
        page.locator("body").ariaSnapshot({ timeout: 8_000 }),
        page.evaluate(() =>
          Array.from(document.querySelectorAll("[data-testid]"))
            .map((element) => element.getAttribute("data-testid") ?? "")
            .filter(Boolean)
            .slice(0, 60),
        ),
        readElementHints(page),
        /*
         * Read beside the tree, in the same load, because a second visit
         * would be a different render -- and a layout fault reported from a
         * page other than the one the test was written against would be a
         * finding about nothing. It returns [] on any failure of its own and
         * never fails the capture.
         */
        readLayoutFaults(page),
      ]);
      // Link targets are noise for writing locators and cost the most space,
      // so they come out of the tree. A link's address is still the only way
      // to tell a control of this page from a way off it, so it is kept here.
      const linkTargets = readLinkTargets(fullAria);
      const withLinks = fullAria.replace(/^\s*- \/url: .*$/gm, "").replace(/\n{2,}/g, "\n");
      /*
       * Masked here, once, because this is the only place the page's own text
       * enters the product. Every caller -- the free generator, page
       * coverage, the workspace -- reads this tree and sends it to a model,
       * and a rule applied at each of them is a rule that will be missed at
       * one of them. That is how the sending address came to be written out
       * in three files and changed in one.
       *
       * The signed-in login form is masked too: it is a page like any other
       * and a test account's own details are no less personal.
       */
      const masked = redactPersonalData(withLinks);
      const aria = masked.text;
      return {
        ok: true,
        finalUrl,
        title: title.slice(0, 300),
        aria: aria.slice(0, MAX_ARIA_CHARS),
        redacted: masked.found,
        testIds: [...new Set(testIds)].map((id) => id.slice(0, 100)),
        elementHints,
        linkTargets,
        truncated: aria.length > MAX_ARIA_CHARS,
        counts: countRoles(aria),
        /*
         * Null when the read itself failed, which is not the same as finding
         * nothing. A page that forbids evaluation and a page with nothing
         * wrong used to produce the same empty list, so the screen said "No
         * layout faults on this page" for both -- the product asserting
         * something it had not established.
         *
         * A failed stylesheet is still reported in that case: it comes from
         * the network, so it is known whether or not the page could be read.
         */
        layoutFaults: rawLayoutFaults.read
          ? describeLayoutFaults([
              ...stylesheetFailures(failedStylesheets),
              ...rawLayoutFaults.findings,
            ])
          : failedStylesheets.length > 0
            ? describeLayoutFaults(stylesheetFailures(failedStylesheets))
            : null,
        ...(signedIn
          ? { signedIn: { loginForm: redactPersonalData(signedIn.loginForm).text } }
          : {}),
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
    // A server error fails the navigation before there is a response to take
    // a status from, so the check above never sees it. Chromium says which it
    // was, and "that address answered an error" is a different thing for a
    // person to act on than "we could not reach it".
    if (message.includes("ERR_HTTP_RESPONSE_CODE_FAILURE")) {
      return { ok: false, reason: "error_page" };
    }
    return { ok: false, reason: "unreachable" };
  }
}
