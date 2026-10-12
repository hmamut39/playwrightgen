import { describe, expect, it } from "vitest";

import { navigationRequirement, pullRequestBody } from "@/lib/services/automation-pull-requests";

/**
 * Found by trying to make the dogfood repository prove something. The pull
 * request carries the test file and nothing else -- the repository's own
 * Playwright configuration belongs to the team -- so a test that opens `./`
 * arrives somewhere with no address, and the only copy of the address it was
 * proven against stays behind in PlaywrightGen. That repository ran such a
 * test for weeks and reported a skip, and nothing anywhere said why.
 */
const base = {
  testCaseTitle: "A visitor adds a todo and sees it in the list",
  versionNumber: 3,
  testCaseVersionNumber: 1,
  summary: "Adds a todo and checks the list.",
  approvedBy: "Dilnur Lead",
  link: "https://playwrightgen.com/workspace/acme/projects/p/automation/a",
};

describe("what a relative navigation needs, read from the code and its configuration", () => {
  it("finds the address the test was proven against", () => {
    expect(
      navigationRequirement({
        code: "await page.goto('./');",
        configuration: "use: { baseURL: 'https://demo.playwright.dev/todomvc/' },",
      }),
    ).toBe("https://demo.playwright.dev/todomvc/");
  });

  it("reports a relative navigation with no address at all", () => {
    expect(navigationRequirement({ code: "await page.goto('./cart');", configuration: "use: {}" })).toBe("");
  });

  it("asks for nothing when the test navigates to a full address", () => {
    expect(
      navigationRequirement({
        code: "await page.goto('https://shop.test/cart');",
        configuration: "use: { baseURL: 'https://shop.test' },",
      }),
    ).toBeNull();
  });

  it("asks for nothing when the test never navigates", () => {
    expect(navigationRequirement({ code: "await expect(page.getByRole('alert')).toBeVisible();", configuration: "" })).toBeNull();
  });
});

describe("what the reviewer in the repository reads", () => {
  it("says what the test needs before it can run, and where it was proven", () => {
    const body = pullRequestBody({ ...base, navigationBaseUrl: "https://demo.playwright.dev/todomvc/" });

    expect(body).toContain("Before this can run here");
    expect(body).toContain("https://demo.playwright.dev/todomvc/");
    expect(body).toContain("playwright.config.ts");
    // The reason this matters: the failure it prevents does not look like this.
    expect(body).toContain("about the missing address");
    expect(body).toContain("only the test file is in this pull request");
  });

  it("says so plainly when it holds no address either", () => {
    const body = pullRequestBody({ ...base, navigationBaseUrl: "" });
    expect(body).toContain("PlaywrightGen holds no address for it");
  });

  it("stays quiet when the test needs nothing", () => {
    const body = pullRequestBody({ ...base, navigationBaseUrl: null });
    expect(body).not.toContain("Before this can run here");
    expect(body).toContain("Approved Playwright automation from PlaywrightGen");
    expect(body).toContain("PlaywrightGen opened this pull request and cannot merge it.");
  });

  it("reads the same as before for callers that say nothing about navigation", () => {
    expect(pullRequestBody(base)).not.toContain("Before this can run here");
  });
});
