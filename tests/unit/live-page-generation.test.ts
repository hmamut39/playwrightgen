import { describe, expect, it } from "vitest";

import { checkLocatorsAgainstPage, validateQuickGeneration } from "@/lib/ai/quick-generation";
import { isPublicWebAddress } from "@/lib/free-tools/page-snapshot";
import { measureSurfaceCoverage, readControls, readLinkTargets, readSurface } from "@/lib/free-tools/surface-coverage";

const todoPage = `- heading "todos" [level=1]
- textbox "What needs to be done?"
- contentinfo:
  - paragraph: Double-click to edit a todo`;

describe("reading a live page safely", () => {
  it("opens public web pages", () => {
    expect(isPublicWebAddress("https://demo.playwright.dev/todomvc/")).toBe(true);
    expect(isPublicWebAddress("http://example.com/login?next=/")).toBe(true);
  });

  it("refuses anything that is not a public web address", () => {
    for (const address of [
      "http://localhost:3000",
      "http://127.0.0.1/admin",
      "http://10.0.0.5",
      "http://192.168.1.1",
      "http://172.20.0.1",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/",
      "http://intranet",
      "http://printer.local",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "https://user:pass@example.com",
      "not a url",
    ]) {
      expect(isPublicWebAddress(address), address).toBe(false);
    }
  });
});

describe("checking locators against the page", () => {
  it("counts names that exist on the page and lists the ones that do not", () => {
    const code = `
      await expect(page.getByRole('heading', { name: 'todos' })).toBeVisible();
      await page.getByRole("textbox", { name: "What needs to be done?" }).fill('Buy milk');
      await page.getByRole('link', { name: 'Active' }).click();
      await page.getByLabel('Email').fill('a@b.c');
      await page.getByRole('listitem', { name: firstText });
      await page.getByRole('button', { name: /save/i });
    `;
    expect(checkLocatorsAgainstPage(code, todoPage)).toEqual({
      checked: 4,
      found: 2,
      notFound: ["Active", "Email"],
    });
  });

  it("ignores case and spacing differences in the page text", () => {
    const code = `page.getByRole('textbox', { name: 'what  needs to be done?' })`;
    expect(checkLocatorsAgainstPage(code, todoPage).found).toBe(1);
  });
});

describe("code quality checks", () => {
  const wrap = (body: string) => `import { test, expect } from '@playwright/test';
test('x', async ({ page }) => {
${body}
  await expect(page).toHaveURL(/x/);
});`;
  const codes = (body: string) => validateQuickGeneration(wrap(body)).findings.map((finding) => finding.code);

  it("flags errors swallowed by an empty catch", () => {
    expect(codes(`try { await page.click('x'); } catch (e) { return false; }`)).toContain("swallowed_error");
  });

  it("flags choosing a locator by counting matches", () => {
    expect(codes(`if (await page.getByTestId('a').count() > 0) { await page.getByTestId('a').click(); }`)).toContain("guessing_locator");
  });

  it("flags scanning every frame and forced clicks", () => {
    const found = codes(`for (const frame of page.frames()) {} await page.getByRole('button', { name: 'Go' }).click({ force: true });`);
    expect(found).toContain("frame_scan");
    expect(found).toContain("forced_action");
  });

  it("leaves clean code alone", () => {
    expect(codes(`await page.getByRole('button', { name: 'Save' }).click();`)).toEqual([]);
  });
});

describe("comparing a page's controls with existing tests", () => {
  const loginPage = `- textbox "Username"
- textbox "Password"
- button "Login"
- link "Forgot password?"
- heading "Swag Labs" [level=1]`;

  it("reads only interactive controls with names", () => {
    expect(readControls(loginPage)).toEqual([
      { role: "textbox", name: "Username" },
      { role: "textbox", name: "Password" },
      { role: "button", name: "Login" },
      { role: "link", name: "Forgot password?" },
    ]);
  });

  it("counts a control only when a locator targets it by name", () => {
    // "password" and "login" appear in this file, but only as an env var, a
    // CSS id and a test title -- none of them reaches the control by name.
    const tests = `
      test("user can log in", async ({ page }) => {
        await page.getByPlaceholder("Username").fill("standard_user");
        await page.locator("#password").fill(process.env.SAUCE_PASSWORD!);
        await page.locator("#login-button").click();
      });`;
    const surface = measureSurfaceCoverage(loginPage, tests);
    expect(surface.total).toBe(4);
    expect(surface.mentioned.map((control) => control.name)).toEqual(["Username"]);
    expect(surface.unmentioned.map((control) => control.name)).toEqual(["Password", "Login", "Forgot password?"]);
  });
});

describe("links that lead off the page's own site", () => {
  // The real aria snapshot of https://demo.playwright.dev/todomvc/, where the
  // only control the app owns is the box you type a todo into: the other three
  // links are a demo notice and two credit lines in the footer.
  const todoPage = `- text: This is just a demo of TodoMVC for testing, not the
- link "real TodoMVC app.":
  - /url: https://todomvc.com/
- heading "todos" [level=1]
- textbox "What needs to be done?"
- contentinfo:
  - paragraph:
    - text: Created by
    - link "Remo H. Jansen":
      - /url: http://github.com/remojansen/
  - paragraph:
    - link "TodoMVC":
      - /url: http://todomvc.com`;

  it("counts only the app's own controls, and says what it left out", () => {
    const { controls, offSite } = readSurface(todoPage, { pageUrl: "https://demo.playwright.dev/todomvc/" });
    expect(controls).toEqual([{ role: "textbox", name: "What needs to be done?" }]);
    expect(offSite.map((link) => link.name)).toEqual(["real TodoMVC app.", "Remo H. Jansen", "TodoMVC"]);
  });

  it("a test that covers the app reads as complete, not as one control in four", () => {
    const tests = `await page.getByPlaceholder("What needs to be done?").fill("buy milk");`;
    const surface = measureSurfaceCoverage(todoPage, tests, { pageUrl: "https://demo.playwright.dev/todomvc/" });
    expect(surface.total).toBe(1);
    expect(surface.unmentioned).toEqual([]);
    expect(surface.offSite).toHaveLength(3);
  });

  it("keeps the site's own pages, however they are written", () => {
    const page = `- link "Basket":
  - /url: /cart
- link "Help":
  - /url: https://www.shop.test/help
- link "Email us":
  - /url: mailto:hello@shop.test
- link "Open menu":
  - /url: javascript:void(0)
- link "Nothing"`;
    const { controls, offSite } = readSurface(page, { pageUrl: "https://shop.test/products" });
    expect(controls.map((control) => control.name)).toEqual(["Basket", "Help", "Open menu", "Nothing"]);
    expect(offSite.map((link) => link.name)).toEqual(["Email us"]);
  });

  it("still knows a link's address after the tree has been stripped of them", () => {
    // What the page snapshot actually hands on: the tree without /url lines,
    // and the addresses beside it. Reading the tree alone found no link to
    // exclude, and the page kept asking for tests on somebody's credit line.
    const stripped = todoPage.replace(/^\s*- \/url: .*$/gm, "").replace(/\n{2,}/g, "\n");
    expect(stripped).not.toContain("/url");
    const { controls, offSite } = readSurface(stripped, {
      pageUrl: "https://demo.playwright.dev/todomvc/",
      linkTargets: readLinkTargets(todoPage),
    });
    expect(controls).toEqual([{ role: "textbox", name: "What needs to be done?" }]);
    expect(offSite).toHaveLength(3);
  });

  it("without the page's address, nothing can be called off-site", () => {
    const { controls, offSite } = readSurface(todoPage);
    expect(controls).toHaveLength(4);
    expect(offSite).toEqual([]);
  });
});

