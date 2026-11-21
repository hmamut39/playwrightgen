import { describe, expect, it, vi } from "vitest";

import {
  publicAiClientFingerprint,
  reservePublicAiRequest,
} from "@/lib/operations/public-ai-guard";

const source = {
  OPENAI_API_KEY: "openai-test-key",
  UPSTASH_REDIS_REST_URL: "https://redis.example",
  UPSTASH_REDIS_REST_TOKEN: "redis-test-token-that-is-long-enough",
  RATE_LIMIT_HASH_SECRET: "dedicated-rate-limit-secret-for-tests",
};

function request(ip = "203.0.113.10") {
  return new Request("https://playwrightgen.example/api/quick-generate", {
    headers: { "x-forwarded-for": `${ip}, 10.0.0.1` },
  });
}

describe("public AI usage guard", () => {
  it("atomically reserves both burst and daily capacity", async () => {
    const execute = vi.fn().mockResolvedValue([1, 1, 3, 0]);
    await expect(
      reservePublicAiRequest({
        request: request(),
        surface: "quick-generate",
        requestId: "123e4567-e89b-42d3-a456-426614174000",
        now: new Date("2026-08-31T12:34:00.000Z"),
        source,
        execute,
      }),
    ).resolves.toMatchObject({ remaining: 2, minuteRemaining: 1 });

    const [keys, args] = execute.mock.calls[0];
    expect(keys).toHaveLength(2);
    expect(keys.join(" ")).not.toContain("203.0.113.10");
    expect(args).toEqual(["2", "5", "60", "41160"]);
  });

  it("returns a bounded retry window for burst rejection", async () => {
    await expect(
      reservePublicAiRequest({
        request: request(),
        surface: "coverage-review",
        requestId: "123e4567-e89b-42d3-a456-426614174000",
        source,
        execute: vi.fn().mockResolvedValue([0, 2, 2, 1]),
      }),
    ).rejects.toMatchObject({
      code: "burst_limit",
      retryAfterSeconds: 60,
      /*
       * Two of five spent, so three are left -- and the refusal has to say
       * so. The script has always returned this count and the error dropped
       * it, which is how a visitor refused for the minute came to be told on
       * the front page that their day was gone.
       */
      remaining: 3,
    });
  });

  it("reports no runs left when it is the day that is over", async () => {
    await expect(
      reservePublicAiRequest({
        request: request(),
        surface: "coverage-review",
        requestId: "123e4567-e89b-42d3-a456-426614174000",
        source,
        execute: vi.fn().mockResolvedValue([0, 1, 5, 2]),
      }),
    ).rejects.toMatchObject({ code: "daily_limit", remaining: 0 });
  });

  it("uses a secret HMAC so stored keys do not contain a reversible raw IP", () => {
    const first = publicAiClientFingerprint({
      request: request(),
      secret: "first-secret",
    });
    const second = publicAiClientFingerprint({
      request: request(),
      secret: "second-secret",
    });
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain("203.0.113.10");
  });
});
