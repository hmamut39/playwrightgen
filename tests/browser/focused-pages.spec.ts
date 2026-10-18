import { expect, test } from "@playwright/test";

/**
 * A page that asks for one thing does not offer six ways to leave.
 *
 * Found by walking a new company through signing up, on 2026-10-18. The
 * onboarding page asks for one thing -- name your organisation -- and carried
 * the marketing menu above it: Product, three free tools, MCP, Pricing, and an
 * "Open Workspace" button. Signed out that button goes to /workspace, which
 * redirects to /sign-in: it returns you to the page you are standing on.
 *
 * Onboarding is where it costs something. A person who wanders off it has an
 * account with no organisation, so there is nothing for them to come back to.
 *
 * The nav already hid itself inside the workspace and on proof links. These
 * three pages were simply never added to that rule.
 */
const FOCUSED = ["/sign-in", "/sign-up", "/onboarding"];

for (const path of FOCUSED) {
  test(`${path} shows no marketing navigation`, async ({ page }) => {
    await page.goto(path, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await expect(page.locator("nav a[href='/workspace']")).toHaveCount(0);
    await expect(page.locator("nav a[href='/pricing']")).toHaveCount(0);
  });
}

test("the marketing navigation still renders where it belongs", async ({ page }) => {
  // Without this the tests above would pass if the nav stopped rendering
  // anywhere at all, which is a different and worse bug.
  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await expect(page.locator("nav a[href='/workspace']").first()).toBeVisible();
  await expect(page.locator("nav a[href='/pricing']").first()).toBeVisible();
});
