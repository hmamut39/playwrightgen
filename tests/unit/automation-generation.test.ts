import { describe, expect, it } from "vitest";

import {
  validateAutomationGeneration,
  type AutomationGenerationResult,
} from "@/lib/ai/automation-generation";

const browserResult = (): AutomationGenerationResult => ({
  model: "test-model",
  inputTokens: 10,
  outputTokens: 20,
  totalTokens: 30,
  name: "Checkout browser automation",
  summary: "Verifies successful checkout in the browser.",
  plan: [{
    title: "Complete checkout",
    intent: "Submit valid order details.",
    expectedAssertion: "Order confirmation is visible.",
  }],
  code: `import { test, expect } from "@playwright/test";
test("checkout", async ({ page }) => {
  await page.goto("/checkout");
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByText("Order confirmed")).toBeVisible();
});`,
  configuration: `import { defineConfig } from "@playwright/test";
export default defineConfig({ use: { baseURL: "http://localhost:3000" } });`,
  dependencies: ["@playwright/test"],
  assumptions: ["The checkout route is /checkout."],
});

describe("automation artifact validation", () => {
  it("accepts a focused Browser artifact using resilient locators", () => {
    expect(validateAutomationGeneration("PLAYWRIGHT_BROWSER", browserResult()))
      .toEqual({ status: "PASSED", findings: [] });
  });

  it("blocks unsafe capabilities, focused tests, and unsupported dependencies", () => {
    const result = browserResult();
    // shelljs is imported by the code, not merely listed. The rule used to
    // read the model's own dependencies field, so it blocked a declaration
    // and passed an artifact that imported a package while declaring none.
    result.code += `\nimport { exec } from "node:child_process";\nimport shell from "shelljs";\ntest.only("unsafe", async () => { eval("x") });`;
    result.dependencies.push("shelljs");
    const validation = validateAutomationGeneration("PLAYWRIGHT_BROWSER", result);
    expect(validation.status).toBe("BLOCKED");
    expect(validation.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(["focused_test", "unsafe_execution", "unsafe_node_module", "unsupported_dependency"]),
    );
  });

  it("blocks a package the code imports even when the artifact declares none", () => {
    // The hole the old rule left open: the declaration said the right thing
    // and the code did not, and only the declaration was read.
    const result = browserResult();
    result.code += `\nimport axios from "axios";`;
    const validation = validateAutomationGeneration("PLAYWRIGHT_BROWSER", result);

    expect(validation.status).toBe("BLOCKED");
    expect(validation.findings.map((finding) => finding.code)).toContain("unsupported_dependency");
  });

  it("warns, rather than blocks, when only the list is wrong", () => {
    // A runnable artifact whose dependencies field over-lists. It used to
    // fail review over a field nobody runs, and that is how this eval case
    // came to report nothing, nothing, warnings and BLOCKED on four runs of
    // the same input.
    const result = browserResult();
    result.dependencies.push("dotenv");
    const validation = validateAutomationGeneration("PLAYWRIGHT_BROWSER", result);

    expect(validation.status).not.toBe("BLOCKED");
    expect(validation.findings.map((finding) => finding.code)).toContain("declared_dependency_unused");
  });

  it("warns about hard waits and brittle locators", () => {
    const result = browserResult();
    result.code = result.code.replace(
      "await page.getByRole(\"button\", { name: \"Place order\" }).click();",
      "await page.locator(\"css=#checkout > button\").click();\n  await page.waitForTimeout(1000);",
    );
    const validation = validateAutomationGeneration("PLAYWRIGHT_BROWSER", result);
    expect(validation.status).toBe("WARNINGS");
    expect(validation.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(["hard_wait", "brittle_locator"]),
    );
  });

  it("requires the request fixture for an API artifact", () => {
    const validation = validateAutomationGeneration("PLAYWRIGHT_API", browserResult());
    expect(validation.status).toBe("BLOCKED");
    expect(validation.findings).toContainEqual(expect.objectContaining({
      code: "missing_request_fixture",
    }));
  });
});
