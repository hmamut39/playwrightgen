import { describe, expect, it } from "vitest";

import { alignContainerNames, alignTestIdLocators, hintsFromFailureTree, siteTestIdAttribute } from "@/lib/free-tools/test-id-attribute";

describe("matching getByTestId to the attribute a site uses", () => {
  const hints = ['button "Add to cart" [data-test="add-to-cart-sauce-labs-backpack"]', 'link "" [data-test="shopping-cart-link"]'];

  it("rewrites getByTestId for a data-test site and leaves data-testid sites alone", () => {
    const code = "await page.getByTestId('add-to-cart-sauce-labs-backpack').click();\nconst cart = page.getByTestId(\"shopping-cart-link\");";
    expect(alignTestIdLocators(code, siteTestIdAttribute(hints))).toEqual({
      code: "await page.locator('[data-test=\"add-to-cart-sauce-labs-backpack\"]').click();\nconst cart = page.locator('[data-test=\"shopping-cart-link\"]');",
      rewritten: 2,
    });
    expect(siteTestIdAttribute(['button "Save" [data-testid="save"]', ...hints])).toBeNull();
    expect(siteTestIdAttribute([])).toBeNull();
    expect(alignTestIdLocators(code, null).rewritten).toBe(0);
  });

  it("reads the hints the runner appends to a failure tree", () => {
    expect(hintsFromFailureTree(`- button "Login"\n\n# Controls with test attributes\n${hints.join("\n")}`)).toEqual(hints);
    expect(hintsFromFailureTree("- button \"Login\"")).toEqual([]);
  });
});

describe("naming list items by their text", () => {
  it("turns a named listitem into a text filter unless the page names it", () => {
    const code = "const item = page.getByRole('listitem', { name: 'Buy milk' });\nconst b = page.getByRole('button', { name: 'Save' });\nconst c = list.getByRole(\"article\", { name: \"News\", exact: true });";
    expect(alignContainerNames(code)).toEqual({
      code: "const item = page.getByRole('listitem').filter({ hasText: 'Buy milk' });\nconst b = page.getByRole('button', { name: 'Save' });\nconst c = list.getByRole('article').filter({ hasText: \"News\" });",
      rewritten: 2,
    });
    expect(alignContainerNames(code, '- listitem "Buy milk"').rewritten).toBe(1);
    expect(alignContainerNames("page.getByRole('listitem', { name: todo1 })").code).toBe("page.getByRole('listitem').filter({ hasText: todo1 })");
  });
  it("does the same for a live region, which is where a real run was lost", () => {
    // Measured, not deduced. The live-page eval generated
    // `getByRole('status', { name: '1 item left' })` for TodoMVC's counter,
    // which the tree shows as `status: 1 item left`. The locator cannot match
    // on any page, and the whole first run was lost to a mistake the rewrite
    // already fixed for list items.
    expect(
      alignContainerNames("await expect(page.getByRole('status', { name: '1 item left' })).toBeVisible();"),
    ).toEqual({
      code: "await expect(page.getByRole('status').filter({ hasText: '1 item left' })).toBeVisible();",
      rewritten: 1,
    });
    // An aria-label the page really has is left alone, live region or not.
    expect(
      alignContainerNames(
        "page.getByRole('status', { name: 'Items left' })",
        '- status "Items left": 1 item left',
      ).rewritten,
    ).toBe(0);
    expect(alignContainerNames("page.getByRole('alert', { name: 'Card declined' })").rewritten).toBe(1);
    expect(alignContainerNames("page.getByRole('row', { name: 'SAVE10' })").rewritten).toBe(1);
  });

  it("leaves a landmark alone, because a text filter there checks almost nothing", () => {
    // These take no name from their content either, and rewriting them would
    // match the whole region that happens to contain the text: a locator that
    // matches everything is a worse test than one that matches nothing.
    for (const role of ["main", "navigation", "region", "table", "listbox", "menu"]) {
      expect(alignContainerNames(`page.getByRole('${role}', { name: 'Buy milk' })`).rewritten, role).toBe(0);
    }
    // And a role that really does take its name from its text is untouched.
    expect(alignContainerNames("page.getByRole('heading', { name: 'todos' })").rewritten).toBe(0);
    expect(alignContainerNames("page.getByRole('link', { name: 'All' })").rewritten).toBe(0);
  });
});
