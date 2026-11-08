import { afterEach, describe, expect, it, vi } from "vitest";

import { handleWaitlistRequest } from "@/app/api/waitlist/route";

function request(body: unknown, ip = "203.0.113.10") {
  return new Request("https://playwrightgen.example/api/waitlist", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

const environment = {
  RATE_LIMIT_HASH_SECRET: "waitlist-rate-limit-secret-for-tests",
  RESEND_API_KEY: "",
  UPSTASH_REDIS_REST_TOKEN: "redis-token-for-tests-that-is-long-enough",
  UPSTASH_REDIS_REST_URL: "https://redis.example",
  WAITLIST_NOTIFY_EMAIL: "",
};

describe("public team waitlist", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("stores a normalized address with retention cleanup", async () => {
    Object.entries(environment).forEach(([name, value]) => vi.stubEnv(name, value));
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const store = {
      set: vi.fn().mockResolvedValue("OK"),
      zremrangebyscore: vi.fn().mockResolvedValue(0),
      zadd: vi.fn().mockResolvedValue(1),
    };
    const notify = vi.fn().mockResolvedValue(undefined);

    const response = await handleWaitlistRequest(
      request({ email: "  PERSON@Example.com " }),
      {
        createStore: () => store,
        notify,
        now: () => Date.parse("2026-09-01T12:00:00.000Z"),
      },
    );

    expect(response.status).toBe(200);
    expect(store.zadd).toHaveBeenCalledWith(
      "playwrightgen:waitlist:v2",
      expect.objectContaining({ member: "person@example.com" }),
    );
    expect(store.zremrangebyscore).toHaveBeenCalledOnce();
    expect(notify).not.toHaveBeenCalled();
  });

  it("rejects a repeated client before storing another address", async () => {
    Object.entries(environment).forEach(([name, value]) => vi.stubEnv(name, value));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const store = {
      set: vi.fn().mockResolvedValue(null),
      zremrangebyscore: vi.fn(),
      zadd: vi.fn(),
    };

    const response = await handleWaitlistRequest(
      request({ email: "person@example.com" }),
      {
        createStore: () => store,
        notify: vi.fn(),
        now: () => 0,
      },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(store.zadd).not.toHaveBeenCalled();
  });

  it("does not expose provider failures or submitted email in logs", async () => {
    Object.entries(environment).forEach(([name, value]) => vi.stubEnv(name, value));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await handleWaitlistRequest(
      request({ email: "private@example.com" }),
      {
        createStore: () => {
          throw new Error("provider credential detail");
        },
        notify: vi.fn(),
        now: () => 0,
      },
    );

    expect(response.status).toBe(503);
    const logLine = String(error.mock.calls[0]?.[0]);
    expect(logLine).not.toContain("private@example.com");
    expect(logLine).not.toContain("provider credential detail");
  });
});

/**
 * What happens when the notice cannot be sent.
 *
 * Resend reports a refused send in its result rather than by throwing, and the
 * sender here is its shared sandbox address, which may only reach the account
 * owner's own email. So the likeliest failure in production is also the
 * quietest: the signup is stored, the request logs "succeeded", and the inbox
 * stays empty. Worse, the failed notice used to fall to the outer catch and
 * answer "The waitlist is temporarily unavailable" to somebody who had just
 * been added -- who would then sign up again.
 */
describe("when the waitlist notice cannot be sent", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const configured = {
    ...environment,
    RESEND_API_KEY: "re_test_key_that_is_long_enough_000000",
    WAITLIST_NOTIFY_EMAIL: "owner@example.com",
  };

  it("still tells the person they are on the list, and records why nobody was told", async () => {
    Object.entries(configured).forEach(([name, value]) => vi.stubEnv(name, value));
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await handleWaitlistRequest(
      request({ email: "person@example.com" }, "203.0.113.77"),
      {
        createStore: () => ({
          set: vi.fn().mockResolvedValue("OK"),
          zremrangebyscore: vi.fn().mockResolvedValue(0),
          zadd: vi.fn().mockResolvedValue(1),
        }),
        notify: vi.fn().mockRejectedValue(new Error("You can only send testing emails to your own address")),
        now: () => Date.parse("2026-11-08T12:00:00.000Z"),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ code: "waitlist_joined" });

    const recorded = warn.mock.calls.map(([line]) => String(line)).find((line) => line.includes("notice_not_sent"));
    expect(recorded, "a refused notice has to leave a record").toBeDefined();
    const event = JSON.parse(recorded!);
    expect(event).toMatchObject({ event: "waitlist.request", status: "failed", code: "notice_not_sent" });
    // The provider's own words, so the owner can act on it rather than guess.
    expect(event.reason).toContain("your own address");
    // Never the address that signed up: this goes to a log, not an inbox.
    expect(recorded).not.toContain("person@example.com");
  });
});
