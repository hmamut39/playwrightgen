import "server-only";

import type { Locator, Page } from "playwright-core";
import { z } from "zod";

import { isPublicWebAddress } from "@/lib/free-tools/page-snapshot";

/**
 * Signing in with a test account before reading or running a page.
 *
 * Most pages worth testing sit behind a login, and until now the free tools
 * saw only the login form. A person can now hand over a test account for one
 * request. It is typed into the login form in the remote browser and nowhere
 * else: it is not stored, not logged, not sent to the model, and not returned.
 *
 * Login forms differ, so this reads them the way a person would -- a visible
 * password field, the text or email field before it, and the button that
 * submits -- and handles the two-screen kind that asks for the email first.
 * Success means the password field is gone afterwards; a form that is still
 * there means the site refused the account.
 */

export const testAccountSchema = z.object({
  username: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(200),
  loginUrl: z.string().trim().max(2_000).optional(),
});

export type TestAccount = z.infer<typeof testAccountSchema>;

export type SignInOutcome =
  | { ok: true; loginForm: string }
  | { ok: false; reason: "no_login_form" | "rejected" | "blocked_address" };

const USERNAME_FIELDS = [
  'input[autocomplete="username"]',
  'input[type="email"]',
  'input[name*="user" i]',
  'input[id*="user" i]',
  'input[name*="email" i]',
  'input[id*="email" i]',
  'input[name*="login" i]',
  'input[type="text"]',
].join(", ");
const SUBMIT_NAMES = /^(sign ?in|log ?in|login|continue|next|submit|enter)\b/i;

async function firstVisible(locator: Locator): Promise<Locator | null> {
  const count = Math.min(await locator.count(), 8);
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

async function submit(page: Page, field: Locator) {
  const button = await firstVisible(page.getByRole("button", { name: SUBMIT_NAMES }));
  const submitInput = button ?? (await firstVisible(page.locator('input[type="submit"], button[type="submit"]')));
  await Promise.all([
    page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {}),
    submitInput ? submitInput.click({ timeout: 5_000 }) : field.press("Enter"),
  ]);
  await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => {});
}

/** The login form's own accessibility tree, so a test can be written for it. */
async function describeForm(page: Page, password: Locator) {
  const form = password.locator("xpath=ancestor::form[1]");
  const target = (await form.count()) ? form : page.locator("body");
  const tree = await target.ariaSnapshot({ timeout: 5_000 }).catch(() => "");
  return tree.replace(/^\s*- \/url: .*$/gm, "").slice(0, 3_000);
}

/**
 * Signs in on the page that is open (or on account.loginUrl), then returns to
 * targetUrl when the login was a detour from it.
 */
export async function signInWithTestAccount(page: Page, account: TestAccount, targetUrl: string): Promise<SignInOutcome> {
  if (account.loginUrl) {
    if (!isPublicWebAddress(account.loginUrl)) return { ok: false, reason: "blocked_address" };
    await page.goto(account.loginUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => {});
  }
  const formUrl = page.url();

  let password = await firstVisible(page.locator('input[type="password"]'));
  let loginForm = "";
  if (!password) {
    // Two-screen logins ask for the email first.
    const username = await firstVisible(page.locator(USERNAME_FIELDS));
    if (!username) return { ok: false, reason: "no_login_form" };
    loginForm = await describeForm(page, username);
    await username.fill(account.username, { timeout: 5_000 });
    await submit(page, username);
    await page.locator('input[type="password"]').first().waitFor({ state: "visible", timeout: 8_000 }).catch(() => {});
    password = await firstVisible(page.locator('input[type="password"]'));
    if (!password) return { ok: false, reason: "no_login_form" };
  } else {
    loginForm = await describeForm(page, password);
    // The field in the password's own form, so a search box in the header is
    // never mistaken for the username.
    const form = password.locator("xpath=ancestor::form[1]");
    const username =
      ((await form.count()) ? await firstVisible(form.locator(USERNAME_FIELDS)) : null) ??
      (await firstVisible(page.locator(USERNAME_FIELDS)));
    if (username) await username.fill(account.username, { timeout: 5_000 });
  }

  await password.fill(account.password, { timeout: 5_000 });
  await submit(page, password);
  await page.locator('input[type="password"]').first().waitFor({ state: "hidden", timeout: 8_000 }).catch(() => {});
  if (await firstVisible(page.locator('input[type="password"]'))) return { ok: false, reason: "rejected" };

  const landed = page.url();
  if (!isPublicWebAddress(landed)) return { ok: false, reason: "blocked_address" };
  const sameAddress = (a: string, b: string) => {
    const left = new URL(a);
    const right = new URL(b);
    return left.origin === right.origin && left.pathname.replace(/\/$/, "") === right.pathname.replace(/\/$/, "");
  };
  // A deep link that sent us to the login page: go back to it. Signing in on
  // the page that was asked for: stay where the site takes a signed-in person.
  if (!sameAddress(formUrl, targetUrl) && !sameAddress(landed, targetUrl)) {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => {});
  }
  return { ok: true, loginForm };
}

/**
 * The optional test account from a free-tool form: fields accountUsername,
 * accountPassword and accountLoginUrl. Both empty means none.
 */
export function readTestAccount(formData: FormData): { ok: true; account: TestAccount | null } | { ok: false; error: string } {
  const fields = {
    username: String(formData.get("accountUsername") || ""),
    password: String(formData.get("accountPassword") || ""),
    loginUrl: String(formData.get("accountLoginUrl") || "").trim() || undefined,
  };
  if (!fields.username && !fields.password) return { ok: true, account: null };
  const parsed = testAccountSchema.safeParse(fields);
  return parsed.success
    ? { ok: true, account: parsed.data }
    : { ok: false, error: "Enter both the test account's username and password, or leave both empty." };
}
