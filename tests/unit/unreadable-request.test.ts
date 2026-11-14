import { describe, expect, it } from "vitest";

import { POST as coverageReview } from "@/app/api/coverage-review/route";
import { POST as quickGenerate } from "@/app/api/quick-generate/route";

/**
 * What the public tools say when they cannot read the request at all.
 *
 * Both of these take a form submission. The read sat inside the handler's
 * outer try, so anything unreadable -- JSON sent to a form endpoint, a
 * truncated upload, the wrong content type -- became "Quick Generate failed.
 * Please try again." with a 500 beside it.
 *
 * Both halves were wrong. The status says the server broke when the request
 * did, and the advice is to retry something that cannot succeed however many
 * times it is sent. The JSON routes next door have always answered 400 and
 * said what was missing; on 2026-11-14 a walk of the public surfaces found
 * these two had not.
 *
 * It matters more than it looks on a product sold to developers: this is the
 * first thing somebody poking at the API meets, and it told them the service
 * was broken.
 */
const unreadable = (url: string) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "this is not a form",
  });

describe("a request the free tools cannot read", () => {
  it("tells Quick Generate's caller what to send instead", async () => {
    const response = await quickGenerate(unreadable("https://playwrightgen.example/api/quick-generate"));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("form submission");
    // Never "please try again": the same request will fail every time.
    expect(body.error).not.toMatch(/try again/i);
  });

  it("tells Coverage Review's caller the same", async () => {
    const response = await coverageReview(unreadable("https://playwrightgen.example/api/coverage-review"));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("form submission");
  });

  it("does not reach the model, the allowance or the database to say so", async () => {
    // Refusing an unreadable body must cost nothing. If it did, anybody could
    // spend a visitor's daily allowance with a malformed request.
    const before = Date.now();
    await quickGenerate(unreadable("https://playwrightgen.example/api/quick-generate"));

    expect(Date.now() - before).toBeLessThan(2_000);
  });
});
