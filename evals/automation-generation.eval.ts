import { afterAll, describe, expect, it } from "vitest";

import {
  generateAutomation,
  validateAutomationGeneration,
  type AutomationGenerationInput,
} from "@/lib/ai/automation-generation";

/**
 * Measures the automation generator on the properties its local validator
 * cannot check.
 *
 * `validateAutomationGeneration` already rejects unsafe primitives, missing
 * assertions, wrong fixtures, and brittle locators, and it runs in production,
 * so an eval that only re-ran it would measure nothing new. These cases target
 * the judgement calls instead: does the model invent detail it was never given,
 * and does it stay within the engine it was asked for.
 *
 * Generated code is executed by customers, so a bad generation costs a CI run
 * and a confusing failure rather than merely a bad read. That is why this suite
 * matters more than the analysis one.
 */

const baseInput: Omit<AutomationGenerationInput, "engine"> = {
  title: "Customer completes checkout",
  objective: "A signed-in customer can place an order with a valid card.",
  preconditions: "A product is in stock and the customer is signed in.",
  steps: [
    "Open the cart at /cart",
    "Click the button labelled Place order",
    "Wait for the confirmation to appear",
  ],
  expectedResults: ["A confirmation containing the order number is displayed"],
  testType: "END_TO_END",
  priority: "HIGH",
  tags: ["checkout"],
  guidance: "",
};

const results: Array<{ id: string; passed: boolean; detail: string }> = [];

function record(id: string, passed: boolean, detail: string) {
  results.push({ id, passed, detail });
}

describe.skipIf(!process.env.OPENAI_API_KEY?.trim())(
  "eval: automation generation",
  () => {
    afterAll(() => {
      const passed = results.filter((entry) => entry.passed).length;
      console.log(`\n  automation-generation eval: ${passed}/${results.length} passed`);
      for (const entry of results) {
        console.log(`   ${entry.passed ? "PASS" : "FAIL"}  ${entry.id}  ${entry.detail}`);
      }
    });

    it("browser artifacts pass local validation without blocking findings", async () => {
      const output = await generateAutomation({ ...baseInput, engine: "PLAYWRIGHT_BROWSER" });
      const validation = validateAutomationGeneration("PLAYWRIGHT_BROWSER", output);
      const blocking = validation.findings.filter((f) => f.severity === "BLOCKING");

      record(
        "browser-passes-validation",
        blocking.length === 0,
        `status=${validation.status} findings=${validation.findings.map((f) => f.code).join(",") || "none"}`,
      );

      expect(blocking, "blocking validation findings").toEqual([]);
      expect(output.code).toMatch(/\bpage\b/);
    });

    it("API artifacts use the request fixture rather than a browser page", async () => {
      const output = await generateAutomation({
        ...baseInput,
        engine: "PLAYWRIGHT_API",
        title: "Order API rejects an invalid card",
        objective: "The orders endpoint rejects a payment with an invalid card.",
        steps: ["POST to /orders with an invalid card token"],
        expectedResults: ["The response status is 402 and the body describes the rejection"],
        testType: "API",
      });
      const validation = validateAutomationGeneration("PLAYWRIGHT_API", output);
      const blocking = validation.findings.filter((f) => f.severity === "BLOCKING");

      record(
        "api-uses-request-fixture",
        blocking.length === 0,
        `status=${validation.status} findings=${validation.findings.map((f) => f.code).join(",") || "none"}`,
      );

      expect(blocking, "blocking validation findings").toEqual([]);
      expect(output.code).toMatch(/\b(?:request|APIRequestContext)\b/);
    });

    it("declares assumptions instead of inventing missing detail", async () => {
      // Deliberately underspecified: no URL, no selectors, no credentials. The
      // honest response is to state what was assumed, not to quietly invent a
      // login form and a base URL and present them as fact.
      const output = await generateAutomation({
        engine: "PLAYWRIGHT_BROWSER",
        title: "Admin can suspend a user",
        objective: "An administrator can suspend an account.",
        preconditions: "",
        steps: ["Suspend the account"],
        expectedResults: ["The account is suspended"],
        testType: "FUNCTIONAL",
        priority: "MEDIUM",
        tags: [],
        guidance: "",
      });

      const passed = output.assumptions.length > 0;
      record(
        "underspecified-declares-assumptions",
        passed,
        `assumptions=${output.assumptions.length}`,
      );

      expect(
        output.assumptions,
        "an underspecified request must surface assumptions rather than invent detail",
      ).not.toHaveLength(0);
    });

    it("avoids fixed waits and DOM-coupled locators", async () => {
      const output = await generateAutomation({ ...baseInput, engine: "PLAYWRIGHT_BROWSER" });

      const hardWait = /\.waitForTimeout\s*\(/.test(output.code);
      const brittle = /\.locator\s*\(\s*["'](?:css=|xpath=|\/\/|#[\w-]+\s*>)/.test(output.code);

      record(
        "no-hard-waits-or-brittle-locators",
        !hardWait && !brittle,
        `hardWait=${hardWait} brittleLocator=${brittle}`,
      );

      // These are warnings rather than blocks in production, so a drift toward
      // them would ship silently without a measurement like this.
      expect(hardWait, "generated code used a fixed wait").toBe(false);
      expect(brittle, "generated code used a DOM-coupled locator").toBe(false);
    });
  },
);
