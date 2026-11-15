import { describe, expect, it } from "vitest";

import { readFreeToolLimit } from "@/components/free-tools/limit-reached";

/**
 * What a visitor is shown when a free tool will not run again today.
 *
 * The decision was made once and applied everywhere but one place. A spent
 * allowance is not a failure, so the free tools answer 429 in a shape the
 * page turns into an offer: what it was, when it resets, and the plan that
 * lifts it.
 *
 * /api/preview-run did not. Its body carried a message and nothing else, so
 * readFreeToolLimit could not recognise it and the panel fell back to "The
 * live run could not be completed." -- an error, shown to somebody who had
 * just run ten tests on a live page and plainly wanted an eleventh. The most
 * engaged visitor this product has was the only one not shown the offer.
 *
 * The sentence was never wrong, which is why it survived: it says ten, and
 * ten is the limit. The frame around it was.
 */
const previewRunBody = {
  error: "You've used today's 10 live runs. They reset at midnight UTC.",
  code: "daily_limit",
  plan: "PUBLIC",
  retryAfterSeconds: 24_000,
  upgrade: true,
  remaining: 0,
};

describe("a free tool that will not run again today", () => {
  it("recognises the live runner's refusal as a limit, not a failure", () => {
    const limit = readFreeToolLimit(429, previewRunBody);

    expect(limit).not.toBeNull();
    expect(limit?.code).toBe("daily_limit");
    expect(limit?.upgrade).toBe(true);
    expect(limit?.retryAfterSeconds).toBe(24_000);
  });

  it("carries the route's own sentence, which is the one that knows the number", () => {
    // The panel used to print "today's 5 free runs" in fixed text beside a
    // message from whichever route refused. They agreed only while every tool
    // allowed five. Live runs allow ten.
    const limit = readFreeToolLimit(429, previewRunBody);

    expect(limit?.error).toContain("10 live runs");
    expect(limit?.error).not.toContain("5 free runs");
  });

  it("still refuses to read anything that is not a limit", () => {
    // A 500 from the runner is a failure and must stay one: offering somebody
    // a plan when the product just broke is worse than saying nothing.
    expect(readFreeToolLimit(500, { error: "The live run could not be completed." })).toBeNull();
    expect(readFreeToolLimit(429, { error: "something" })).toBeNull();
    expect(readFreeToolLimit(429, null)).toBeNull();
    expect(readFreeToolLimit(200, previewRunBody)).toBeNull();
  });

  it("reads a burst limit as the short wait it is, with no upgrade attached", () => {
    const limit = readFreeToolLimit(429, {
      error: "Wait a minute before the next run.",
      code: "burst_limit",
      plan: "PUBLIC",
      retryAfterSeconds: 60,
      upgrade: false,
      remaining: 0,
    });

    expect(limit?.code).toBe("burst_limit");
    expect(limit?.upgrade).toBe(false);
  });
});
