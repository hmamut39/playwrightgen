import { describe, expect, it } from "vitest";

import { isPublicWebAddress } from "@/lib/free-tools/public-address";

/**
 * An address that can never be opened is refused before anything is spent.
 *
 * Found by using the free tool as a visitor on 2026-10-18: pasting
 * `http://localhost:3000/` started a prove run. The product read "Reading the
 * page and writing the test…" for a minute and then refused -- and the
 * attempt had taken one of the five drafts a visitor gets in a day. Two of
 * them went that way before the tool said "0 of 5 drafts left".
 *
 * The order was deliberate and half right: the quota is reserved before the
 * page is read, so the page reader cannot be used as a free service. But a
 * private address is not abuse to be rate-limited, it is a mistake to be
 * answered, and answering it costs nothing -- no network, no page, no model.
 *
 * The check now runs in three places and they must agree about what a public
 * address is: in the browser as the field is typed, in the route before the
 * quota, and in the page reader itself. This is the predicate all three use.
 */
describe("the addresses a visitor may ask the product to open", () => {
  it("refuses what a remote browser could never reach", () => {
    for (const address of [
      "http://localhost:3000/",
      "https://localhost/",
      "http://127.0.0.1:8080/app",
      "http://192.168.1.14/admin",
      "http://10.0.0.5/",
      "http://172.16.4.2/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]:3000/",
      "https://staging.internal/",
      "https://build.local/",
      "http://metadata/",
    ]) {
      expect(isPublicWebAddress(address), address).toBe(false);
    }
  });

  it("refuses what is not a web address at all", () => {
    for (const address of [
      "my staging site",
      "file:///etc/passwd",
      "ftp://files.example.com/",
      "javascript:alert(1)",
      // Credentials in the address are a way to make one host look like
      // another in a hurry.
      "https://user:password@shop.example.com/",
      "",
    ]) {
      expect(isPublicWebAddress(address), address).toBe(false);
    }
  });

  it("accepts an ordinary public page", () => {
    for (const address of [
      "https://shop.example.com/",
      "http://demo.playwright.dev/todomvc/",
      "https://app.example.co.uk/sign-in?next=/dashboard",
      "https://example.com:8443/app",
    ]) {
      expect(isPublicWebAddress(address), address).toBe(true);
    }
  });

  it("is applied before the quota, not after it", async () => {
    // The route refuses without reaching the limiter, the page reader or the
    // model. If the guard were moved back below the reservation this would
    // come back as a quota answer or a server error instead of this refusal.
    const { POST } = await import("@/app/api/quick-generate/route");
    const form = new FormData();
    form.set("mode", "FLOW");
    form.set("depth", "FOCUSED");
    form.set("request", "A visitor signs in and reaches the dashboard.");
    form.set("pageUrl", "http://192.168.1.14/admin");

    const response = await POST(new Request("https://playwrightgen.test/api/quick-generate", { method: "POST", body: form }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Only public web addresses");
  });
});
