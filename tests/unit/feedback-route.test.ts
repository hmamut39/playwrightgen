import { afterEach, describe, expect, it, vi } from "vitest";

import { handleFeedbackRequest } from "@/app/api/feedback/route";

/**
 * The way somebody tells the owner that something is wrong.
 *
 * It is the one surface where a quiet failure costs the most: a person who
 * reports a fault and is thanked for it has done their part, and if the notice
 * never arrives, nobody learns anything and the reporter thinks they were
 * heard. The report is kept in the store either way, so the thank you is
 * honest -- but a refused notice has to leave a record, or the owner's inbox
 * being empty means either "nothing is wrong" or "everything is broken" and
 * there is no way to tell which.
 */
function request(body: unknown, ip = "203.0.113.10") {
  return new Request("https://playwrightgen.example/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

const environment = {
  RATE_LIMIT_HASH_SECRET: "feedback-rate-limit-secret-for-tests",
  RESEND_API_KEY: "re_test_key_that_is_long_enough_000000",
  UPSTASH_REDIS_REST_TOKEN: "redis-token-for-tests-that-is-long-enough",
  UPSTASH_REDIS_REST_URL: "https://redis.example",
  FEEDBACK_NOTIFY_EMAIL: "owner@example.com",
  WAITLIST_NOTIFY_EMAIL: "",
};

const store = () => ({
  set: vi.fn().mockResolvedValue("OK"),
  zadd: vi.fn().mockResolvedValue(1),
  zremrangebyscore: vi.fn().mockResolvedValue(0),
  zremrangebyrank: vi.fn().mockResolvedValue(0),
});

describe("reporting what went wrong", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("keeps the report and sends the notice", async () => {
    Object.entries(environment).forEach(([name, value]) => vi.stubEnv(name, value));
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const kept = store();
    const notify = vi.fn().mockResolvedValue(undefined);

    const response = await handleFeedbackRequest(
      request({ message: "The run button did nothing", path: "/generator?token=secret#x" }),
      { createStore: () => kept, notify, now: () => Date.parse("2026-11-08T12:00:00.000Z") },
    );

    expect(response.status).toBe(200);
    expect(notify).toHaveBeenCalledOnce();
    const sent = notify.mock.calls[0][0];
    expect(sent.recipient).toBe("owner@example.com");
    expect(sent.text).toContain("The run button did nothing");
    // The path, never the query string: it can carry a token, and this is
    // written to a log and an inbox.
    expect(sent.subject).toContain("/generator");
    expect(sent.subject).not.toContain("secret");
    expect(kept.zadd).toHaveBeenCalledOnce();
  });

  it("still thanks the person when the notice is refused, and records why", async () => {
    // Resend answers a refused send in its result rather than by throwing, and
    // the shared sandbox sender may only reach the account owner's own
    // address -- so this is the likeliest failure in production, and it used
    // to end in silence while the request logged "succeeded".
    Object.entries(environment).forEach(([name, value]) => vi.stubEnv(name, value));
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const kept = store();

    const response = await handleFeedbackRequest(
      request({ message: "Approve did not save", path: "/workspace" }, "203.0.113.55"),
      {
        createStore: () => kept,
        notify: vi.fn().mockRejectedValue(new Error("You can only send testing emails to your own address")),
        now: () => Date.parse("2026-11-08T12:00:00.000Z"),
      },
    );

    expect(response.status).toBe(200);
    // The report is in the store, so thanking them is true.
    expect(kept.zadd).toHaveBeenCalledOnce();

    const recorded = warn.mock.calls.map(([line]) => String(line)).find((line) => line.includes("notice_not_sent"));
    expect(recorded, "a refused notice has to leave a record").toBeDefined();
    const event = JSON.parse(recorded!);
    expect(event).toMatchObject({ event: "feedback.request", status: "failed", code: "notice_not_sent" });
    expect(event.reason).toContain("your own address");
    // What they wrote belongs in the inbox and the store, not in a log.
    expect(recorded).not.toContain("Approve did not save");
  });

  it("asks for words rather than storing an empty report", async () => {
    Object.entries(environment).forEach(([name, value]) => vi.stubEnv(name, value));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const kept = store();

    const response = await handleFeedbackRequest(request({ message: "   " }), {
      createStore: () => kept,
      notify: vi.fn(),
      now: () => Date.now(),
    });

    expect(response.status).toBe(400);
    expect(kept.zadd).not.toHaveBeenCalled();
  });
});
