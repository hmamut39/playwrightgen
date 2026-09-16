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
});
