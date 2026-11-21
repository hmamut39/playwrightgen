import { describe, expect, it } from "vitest";

import {
  costOfProving,
  modelPrice,
  PRICES_COPIED_ON,
  provenCostNote,
  usdForUse,
  usdLabel,
} from "@/lib/ai/model-cost";

/**
 * Turning the token counts this product already stores into money.
 *
 * The number has to be either right or absent. A cost per proven test is the
 * figure somebody decides a purchase on, and a plausible-looking one built on
 * a guessed price, a guessed token split, or a divisor that quietly excluded
 * the failed attempts is worse than printing nothing: nobody checks a number
 * that looks reasonable.
 */
describe("what a model costs", () => {
  it("prices the models the product runs on", () => {
    // Standard tier, from developers.openai.com/api/docs/pricing.
    expect(modelPrice("gpt-5-mini")).toEqual({ input: 0.25, output: 2, cachedInput: 0.025 });
    expect(modelPrice("gpt-4o")).toEqual({ input: 2.5, output: 10, cachedInput: 1.25 });
  });

  it("prices a dated release as the model it is", () => {
    // OPENAI_AUTOMATION_MODEL can name a pinned release, and that string is
    // what gets stored on the version.
    expect(modelPrice("gpt-5-mini-2026-08-07")).toEqual(modelPrice("gpt-5-mini"));
  });

  it("does not bill the cheap model at the expensive model's rate", () => {
    /*
     * "gpt-5" is a prefix of "gpt-5-mini". A shortest-match rule would price
     * every gpt-5-mini run at five times its input rate and twenty times
     * nothing would look wrong on the screen.
     */
    expect(modelPrice("gpt-5-mini")?.input).toBe(0.25);
    expect(modelPrice("gpt-5")?.input).toBe(1.25);
  });

  it("knows nothing about a model it has never been told about", () => {
    expect(modelPrice("imported-draft")).toBeNull();
    expect(modelPrice("some-model-nobody-priced")).toBeNull();
    expect(modelPrice("")).toBeNull();
  });

  it("multiplies out one run", () => {
    // 1M input at $0.25 and 1M output at $2.00.
    expect(usdForUse({ model: "gpt-5-mini", inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(
      2.25,
    );
    expect(
      usdForUse({ model: "gpt-5-mini", inputTokens: 10_000, outputTokens: 2_000 }),
    ).toBeCloseTo(0.0065, 10);
  });

  it("says nothing rather than guessing the half it was not told", () => {
    /*
     * Input and output are written together from one usage report, so a row
     * with one and not the other came from a path that recorded no usage.
     * Splitting a total between the cheap half and the half that costs eight
     * times as much would be inventing the answer.
     */
    expect(usdForUse({ model: "gpt-5-mini", inputTokens: 500, outputTokens: null })).toBeNull();
    expect(usdForUse({ model: "gpt-5-mini", inputTokens: null, outputTokens: 500 })).toBeNull();
    expect(usdForUse({ model: "gpt-5-mini" })).toBeNull();
    expect(usdForUse({ model: "imported-draft", inputTokens: 10, outputTokens: 10 })).toBeNull();
  });
});

describe("the cost of getting one test proven", () => {
  const version = (proven: boolean, inputTokens: number | null = 10_000, outputTokens = 2_000) => ({
    model: "gpt-5-mini",
    inputTokens,
    outputTokens: inputTokens === null ? null : outputTokens,
    proven,
  });

  it("divides everything spent by the tests that came out the other end", () => {
    /*
     * The whole point. Three attempts, one of which passed on the real page.
     * A cost per proven test that counted only the successful attempt would
     * quote a third of the real price -- a number nobody can buy at.
     */
    const cost = costOfProving([version(false), version(false), version(true)]);

    expect(cost.attempts).toBe(3);
    expect(cost.proven).toBe(1);
    expect(cost.usd).toBeCloseTo(0.0195, 10);
    expect(cost.perProvenUsd).toBeCloseTo(0.0195, 10);
  });

  it("averages over several proven tests", () => {
    const cost = costOfProving([version(true), version(true), version(false)]);

    expect(cost.perProvenUsd).toBeCloseTo(0.00975, 10);
  });

  it("refuses to quote a cost per proven test when nothing is proven", () => {
    // Not a division by zero, and not the total wearing a per-test label.
    const cost = costOfProving([version(false), version(false)]);

    expect(cost.proven).toBe(0);
    expect(cost.usd).toBeCloseTo(0.013, 10);
    expect(cost.perProvenUsd).toBeNull();
  });

  it("counts what it could not price instead of dropping it silently", () => {
    const cost = costOfProving([version(true), version(false, null), { model: "imported-draft", proven: true }]);

    expect(cost.attempts).toBe(3);
    expect(cost.priced).toBe(1);
    expect(cost.unpriced).toBe(2);
    // The proven count includes the imported one: it passed on the page. What
    // is unknown is what it cost, not whether it works.
    expect(cost.proven).toBe(2);
  });

  it("has no total when it could price nothing at all", () => {
    const cost = costOfProving([{ model: "imported-draft", proven: true }]);

    expect(cost.usd).toBeNull();
    expect(cost.perProvenUsd).toBeNull();
  });

  it("says nothing about a test nobody has generated", () => {
    expect(costOfProving([])).toEqual({
      attempts: 0,
      proven: 0,
      priced: 0,
      unpriced: 0,
      usd: null,
      perProvenUsd: null,
    });
  });
});

describe("money a person can read", () => {
  it("does not round a fraction of a cent down to free", () => {
    // Two decimal places make every generated test cost "$0.00", which reads
    // as free and makes the entire figure pointless.
    expect(usdLabel(0.0065)).toBe("$0.0065");
    expect(usdLabel(0.0195)).toBe("$0.019");
  });

  it("keeps larger amounts short", () => {
    expect(usdLabel(0.42)).toBe("$0.42");
    expect(usdLabel(12.3456)).toBe("$12.35");
    expect(usdLabel(0)).toBe("$0");
  });
});

describe("what the reader is told", () => {
  const note = (versions: Parameters<typeof costOfProving>[0]) =>
    provenCostNote(costOfProving(versions));

  const priced = (proven: boolean) => ({
    model: "gpt-5-mini",
    inputTokens: 10_000,
    outputTokens: 2_000,
    proven,
  });

  it("says nothing when nothing was generated", () => {
    expect(note([])).toBeNull();
  });

  it("names the attempts, the proven ones, the total and the per-test figure", () => {
    const text = note([priced(false), priced(false), priced(true), priced(true)]);

    expect(text).toContain("4 versions");
    expect(text).toContain("2 proven on your live page");
    expect(text).toContain("$0.026");
    expect(text).toContain("per proven test");
  });

  it("dates the rates it used, because a copied price goes stale", () => {
    const text = note([priced(true)]);

    expect(text).toContain("OpenAI's published rates as of 21 November 2026");
    expect(PRICES_COPIED_ON).toBe("2026-11-21");
  });

  it("admits the figure is an upper bound", () => {
    /*
     * Cached input is a tenth of the price on gpt-5-mini and the counts kept
     * here do not separate it, so every figure is the most this could have
     * cost. A reader who takes it as exact has been misled by omission.
     */
    expect(note([priced(true)])).toContain("none of the prompt was served from the provider's cache");
  });

  it("says there is no cost per proven test when nothing passed", () => {
    const text = note([priced(false), priced(false)]);

    expect(text).toContain("none proven on your live page yet");
    expect(text).toContain("there is no cost per proven test");
    expect(text).not.toContain("per proven test,");
  });

  it("owns up to the attempts it could not price", () => {
    const text = note([priced(true), { model: "imported-draft", proven: false }]);

    expect(text).toContain("1 of them kept no token count");
    expect(text).toContain("not in this figure");
  });

  it("does not pretend to a cost when no version kept a count", () => {
    const text = note([{ model: "imported-draft", proven: true }]);

    // "generated" would be wrong of imported code, which is a version here
    // too and was generated by nothing.
    expect(text).toContain("none of which kept a token count");
    expect(text).not.toContain("generated");
    expect(text).not.toContain("$");
  });
});
