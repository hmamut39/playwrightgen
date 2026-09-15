import { describe, expect, it } from "vitest";

import { runVerdict, signRunReceipt, verifyRunReceipt } from "@/lib/free-tools/preview-run/receipt";

const SECRET = "unit-receipt-secret-that-is-long-enough-0000";
const code = "test('x', async ({ page }) => { await expect(page).toHaveTitle(/Todo/); });";
const result = {
  tests: [{ name: "x", status: "passed" as const, steps: [] }],
  counts: { passed: 1, failed: 0, skipped: 0, notReached: 0 },
  durationMs: 1_234.5,
  timedOut: false,
};

describe("signed live-run receipts", () => {
  it("round-trips for the exact code that ran", () => {
    const receipt = signRunReceipt({ code, pageUrl: "https://example.com/", result }, SECRET);
    expect(verifyRunReceipt(receipt, code, SECRET)).toMatchObject({ verdict: "passed", passed: 1, durationMs: 1_235 });
  });

  it("rejects other code, another key, edited claims, and old receipts", () => {
    const ranAt = new Date("2026-09-01T00:00:00Z");
    const receipt = signRunReceipt({ code, pageUrl: "https://example.com/", result, ranAt }, SECRET);
    const fresh = new Date("2026-09-02T00:00:00Z");
    expect(verifyRunReceipt(receipt, code, SECRET, fresh)).not.toBeNull();
    expect(verifyRunReceipt(receipt, `${code} `, SECRET, fresh)).toBeNull();
    expect(verifyRunReceipt(receipt, code, `${SECRET}x`, fresh)).toBeNull();
    expect(verifyRunReceipt(receipt, code, SECRET, new Date("2026-09-09T00:00:01Z"))).toBeNull();

    const [prefix, body, mac] = receipt.split(".");
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const forged = Buffer.from(JSON.stringify({ ...claims, passed: 99 })).toString("base64url");
    expect(verifyRunReceipt(`${prefix}.${forged}.${mac}`, code, SECRET, fresh)).toBeNull();
    expect(verifyRunReceipt("not-a-receipt", code, SECRET, fresh)).toBeNull();
  });

  it("calls a run passed only when every step ran and passed", () => {
    expect(runVerdict(result)).toBe("passed");
    expect(runVerdict({ ...result, counts: { ...result.counts, skipped: 1 } })).toBe("partial");
    expect(runVerdict({ ...result, timedOut: true })).toBe("partial");
    expect(runVerdict({ ...result, counts: { passed: 0, failed: 0, skipped: 0, notReached: 0 } })).toBe("partial");
    expect(runVerdict({ ...result, counts: { ...result.counts, failed: 1 } })).toBe("failed");
  });
});
