import { afterAll, describe, expect, it } from "vitest";

import {
  generateQuickDraft,
  validateQuickGeneration,
  type QuickGenerationInput,
} from "@/lib/ai/quick-generation";

/**
 * Measures whether Quick Generate keeps the promises its page makes.
 *
 * It is the first thing anyone tries and the only one they try without signing
 * in, so a quiet regression here is a regression in the first impression the
 * product ever makes -- and nothing else would catch it, because a prompt that
 * has become worse still returns valid, well-formed, confident output.
 *
 * Graded deterministically against the structured result rather than by another
 * model. A judge model is a second thing that can be wrong, and a sympathetic
 * one lets a regression pass while looking rigorous.
 *
 * The properties asserted are the ones the interface states out loud: nothing is
 * invented, weak patterns are avoided, and anything missing is surfaced as an
 * assumption rather than filled in silently.
 */

const baseInput: QuickGenerationInput = {
  mode: "FLOW",
  request:
    "A signed-out user submits valid credentials and reaches their dashboard. Invalid credentials show a visible error and the user stays on the sign-in page.",
  pageUrl: "",
  depth: "FOCUSED",
  fileContext: "",
  imageDataUrls: [],
};

type Attempt = {
  id: string;
  code: string;
  assumptions: string[];
  planLength: number;
};

const attempts: Attempt[] = [];

async function generate(id: string, overrides: Partial<QuickGenerationInput> = {}) {
  const result = await generateQuickDraft({ ...baseInput, ...overrides });
  const attempt: Attempt = {
    id,
    code: result.code,
    assumptions: result.assumptions,
    planLength: result.testPlan.length,
  };
  attempts.push(attempt);
  return { result, attempt };
}

describe("Quick Generate draft quality", () => {
  afterAll(() => {
    // Printed so a failing run can be read without re-running and paying again.
    for (const attempt of attempts) {
      console.log(
        `[${attempt.id}] plan=${attempt.planLength} assumptions=${attempt.assumptions.length} codeChars=${attempt.code.length}`,
      );
    }
  });

  it("returns runnable Playwright rather than prose or fenced markdown", async () => {
    const { result } = await generate("runnable");

    expect(result.code).toMatch(/from\s+["']@playwright\/test["']/);
    expect(result.code).toMatch(/\btest\s*\(/);
    expect(result.code).toMatch(/\bexpect\s*\(/);
    // Fences would break a copy-paste into a spec file, which is the one thing
    // someone does with this output.
    expect(result.code).not.toMatch(/```/);
    expect(result.testPlan.length).toBeGreaterThan(0);
  }, 120_000);

  it("passes its own deterministic checks", async () => {
    // The page shows a green badge from exactly this function. If the model
    // drifts into patterns the badge flags, users see a warning on their first
    // ever result.
    const { result } = await generate("self-check");

    const validation = validateQuickGeneration(result.code);
    expect(validation.status).not.toBe("BLOCKED");
  }, 120_000);

  it("does not invent a URL when none was supplied", async () => {
    // The request names no host. A generated goto to some plausible-looking
    // address is the most damaging kind of output here: it looks authoritative
    // and sends someone to a site that is not theirs.
    const { result } = await generate("no-invented-url", { pageUrl: "" });

    const absoluteNavigations = [
      ...result.code.matchAll(/goto\s*\(\s*["'`](https?:\/\/[^"'`]+)/gi),
    ].map((match) => match[1]);

    expect(absoluteNavigations).toEqual([]);
  }, 120_000);

  it("uses the URL it was given rather than a guess", async () => {
    const { result } = await generate("uses-given-url", {
      pageUrl: "https://app.example.com/login",
    });

    const absoluteNavigations = [
      ...result.code.matchAll(/["'`](https?:\/\/[^"'`]+)["'`]/gi),
    ].map((match) => match[1]);

    for (const url of absoluteNavigations) {
      expect(url).toContain("app.example.com");
    }
  }, 120_000);

  it("avoids the weak patterns the product tells people to avoid", async () => {
    const { result } = await generate("no-weak-patterns");

    // Fixed sleeps and focused tests are the two habits every review in this
    // product flags. Shipping them in the reference output would be teaching
    // the opposite of what the tool sells.
    expect(result.code).not.toMatch(/\.waitForTimeout\s*\(/);
    expect(result.code).not.toMatch(/\b(?:test|describe)\.only\s*\(/);
    expect(result.code).not.toMatch(/\b(?:eval\s*\(|new\s+Function\s*\()/);
  }, 120_000);

  it("states what it had to assume instead of filling gaps silently", async () => {
    // Deliberately underspecified: no selectors, no credentials, no URL. The
    // interface promises that anything not supplied is listed rather than
    // invented, so an empty assumptions list here means the promise is broken.
    const { result } = await generate("assumptions-surfaced", {
      request: "The user can change their notification settings and the change persists.",
    });

    expect(result.assumptions.length).toBeGreaterThan(0);
  }, 120_000);

  it("produces an API draft without a browser fixture when asked for one", async () => {
    const { result } = await generate("api-mode", {
      mode: "API",
      request:
        "POST /sessions accepts an email and password and returns 201 with a token. Invalid credentials return 401 and no token.",
    });

    expect(result.code).toMatch(/\b(?:request|APIRequestContext)\b/);
  }, 120_000);
});
