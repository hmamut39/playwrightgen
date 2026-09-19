import { describe, expect, it } from "vitest";

import { alignRootNavigation } from "@/lib/free-tools/navigation";

describe("opening the page, not the site root", () => {
  it("rewrites '/' to the page when the page lives in a folder", () => {
    const code = `await page.goto('/');\nawait page.goto("/#/active");\nawait page.goto(\`/?q=1\`);`;
    const aligned = alignRootNavigation(code, "https://demo.playwright.dev/todomvc/");
    expect(aligned.rewritten).toBe(3);
    expect(aligned.code).toBe(`await page.goto('./');\nawait page.goto("./#/active");\nawait page.goto(\`./?q=1\`);`);
    // The rewrite lands where a person meant: the page itself.
    expect(new URL("./#/active", "https://demo.playwright.dev/todomvc/").toString()).toBe("https://demo.playwright.dev/todomvc/#/active");
  });

  it("keeps the file name for a page that is a file", () => {
    expect(alignRootNavigation("await page.goto('/')", "https://example.com/app/start.html").code).toBe("await page.goto('./start.html')");
  });

  it("leaves named paths, root pages and bad URLs alone", () => {
    const named = "await page.goto('/todomvc/'); await page.goto('/login');";
    expect(alignRootNavigation(named, "https://demo.playwright.dev/todomvc/")).toEqual({ code: named, rewritten: 0 });
    expect(alignRootNavigation("await page.goto('/')", "https://www.saucedemo.com/").rewritten).toBe(0);
    expect(alignRootNavigation("await page.goto('/')", "https://www.saucedemo.com/inventory.html").rewritten).toBe(0);
    expect(alignRootNavigation("await page.goto('/')", "not a url").rewritten).toBe(0);
  });
});
