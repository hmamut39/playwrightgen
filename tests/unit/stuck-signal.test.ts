import { describe, expect, it, vi } from "vitest";

import { somebodyGotStuck } from "@/lib/operations/stuck-signal";

/**
 * Telling the owner, the same day, that somebody wanted this to work.
 *
 * Feedback reaches him when a person writes it, and most people do not write
 * it -- they close the tab. In a one-week trial that silence is the whole
 * result: a stranger meets the daily allowance on their third generation and
 * the owner learns about it after the week is over, from nothing.
 *
 * The risks are the ordinary ones for anything that sends mail from inside a
 * request: that it becomes noise, that it carries something private, or that
 * it fails the request it was only supposed to report on.
 */
const source = {
  WAITLIST_NOTIFY_EMAIL: "owner@example.com",
  UPSTASH_REDIS_REST_URL: "https://redis.example",
  UPSTASH_REDIS_REST_TOKEN: "redis-token-for-tests-that-is-long-enough",
};

describe("telling the owner somebody got stuck", () => {
  it("sends the first one, with what to do about it", async () => {
    const send = vi.fn().mockResolvedValue(true);
    const result = await somebodyGotStuck(
      { what: "daily_allowance_exhausted", where: "page-coverage", organizationId: "org-123" },
      { source, send, claim: async () => true },
    );

    expect(result).toBe("sent");
    const message = send.mock.calls[0][0];
    expect(message.to).toBe("owner@example.com");
    expect(message.subject).toContain("used up its day");
    // The workspace id is the thing he needs to grant an allowance.
    expect(message.text).toContain("org-123");
    // And the command that does it, because a notice without a next step is
    // just a worry.
    expect(message.text).toContain("grant-trial-allowance");
  });

  it("holds the second within the hour", async () => {
    // The fourth person to hit the same wall tells him nothing the first did
    // not, and an inbox that fills up is an inbox that gets filtered.
    const send = vi.fn().mockResolvedValue(true);
    const result = await somebodyGotStuck(
      { what: "daily_allowance_exhausted", where: "page-coverage" },
      { source, send, claim: async () => false },
    );

    expect(result).toBe("held");
    expect(send).not.toHaveBeenCalled();
  });

  it("holds each kind separately", async () => {
    // Being out of credit and a workspace spending its day are different
    // problems with different answers; one must not silence the other.
    const claimed = new Set<string>();
    const send = vi.fn().mockResolvedValue(true);
    const claim = async (key: string) => (claimed.has(key) ? false : (claimed.add(key), true));

    await somebodyGotStuck({ what: "daily_allowance_exhausted", where: "a" }, { source, send, claim });
    await somebodyGotStuck({ what: "provider_out_of_credit", where: "b" }, { source, send, claim });
    await somebodyGotStuck({ what: "daily_allowance_exhausted", where: "c" }, { source, send, claim });

    expect(send).toHaveBeenCalledTimes(2);
  });

  it("carries nothing a person wrote", async () => {
    const send = vi.fn().mockResolvedValue(true);
    await somebodyGotStuck(
      { what: "browser_unavailable", where: "preview-run", organizationId: "org-9" },
      { source, send, claim: async () => true },
    );

    const message = send.mock.calls[0][0];
    // The message is built from a fixed table plus a surface name and an
    // internal id. There is no field through which a draft, a page or an
    // address could reach it, and this test is here so that stays true.
    expect(message.text).not.toMatch(/@(?!example\.com)/);
    expect(message.text).not.toContain("import { test");
  });

  it("says so rather than mailing when no address is configured", async () => {
    const send = vi.fn();
    const result = await somebodyGotStuck(
      { what: "provider_out_of_credit", where: "quick-generate" },
      { source: { UPSTASH_REDIS_REST_URL: "https://redis.example" }, send, claim: async () => true },
    );

    expect(result).toBe("not_configured");
    expect(send).not.toHaveBeenCalled();
  });

  it("never throws, whatever the mail or the store does", async () => {
    // It runs inside a request that is already refusing somebody. If this can
    // fail that request, it is worse than not having it.
    await expect(
      somebodyGotStuck(
        { what: "provider_out_of_credit", where: "quick-generate" },
        { source, claim: async () => { throw new Error("redis is down"); } },
      ),
    ).resolves.toBe("failed");

    await expect(
      somebodyGotStuck(
        { what: "provider_out_of_credit", where: "quick-generate" },
        { source, claim: async () => true, send: async () => { throw new Error("mail is down"); } },
      ),
    ).resolves.toBe("failed");
  });

  it("reports a refused send as failed rather than sent", async () => {
    // Resend answers a refusal in its result. The alert sender returns false
    // for that, and calling it "sent" would be the same quiet lie the
    // feedback route had on 2026-11-08.
    const result = await somebodyGotStuck(
      { what: "browser_unavailable", where: "preview-run" },
      { source, claim: async () => true, send: async () => false },
    );

    expect(result).toBe("failed");
  });
});
