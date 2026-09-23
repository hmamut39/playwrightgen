import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { readProofToken } from "@/lib/services/release-proof";

/**
 * The token is the whole authorization for a shared proof link, so what it
 * refuses matters more than what it accepts.
 */
const SECRET = "proof-link-test-secret-with-enough-length";

beforeAll(() => {
  process.env.RUNNER_INGEST_SECRET = SECRET;
});

// Built the way the service builds one, so the test does not depend on a
// private helper.
function mint(claim: Record<string, unknown>, secret = SECRET) {
  const body = Buffer.from(JSON.stringify(claim)).toString("base64url");
  const { createHmac } = require("node:crypto") as typeof import("node:crypto");
  return `pwgp1.${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

const claim = () => ({
  projectId: randomUUID(),
  organizationId: randomUUID(),
  issuedAt: Date.now() - 1_000,
  expiresAt: Date.now() + 60_000,
});

describe("a shared proof link's token", () => {
  it("names exactly one project, and nothing else", () => {
    const wanted = claim();
    const read = readProofToken(mint(wanted));
    expect(read).toEqual(wanted);
    expect(Object.keys(read ?? {}).sort()).toEqual(["expiresAt", "issuedAt", "organizationId", "projectId"]);
  });

  it("refuses a token that was edited, signed with another secret, or is not ours", () => {
    const token = mint(claim());
    const [prefix, body, signature] = token.split(".");
    // A different project, same signature.
    const swapped = Buffer.from(JSON.stringify(claim())).toString("base64url");
    expect(readProofToken(`${prefix}.${swapped}.${signature}`)).toBeNull();
    // A signature from someone else's secret.
    expect(readProofToken(mint(claim(), "another-secret-entirely-long-enough"))).toBeNull();
    // Shapes that are not tokens at all.
    expect(readProofToken("")).toBeNull();
    expect(readProofToken(`pwgp1.${body}`)).toBeNull();
    expect(readProofToken(`other.${body}.${signature}`)).toBeNull();
    expect(readProofToken(`pwgp1.not-base64url!!.${signature}`)).toBeNull();
  });

  it("stops working when it expires", () => {
    const expiring = { ...claim(), expiresAt: Date.now() + 5_000 };
    const token = mint(expiring);
    expect(readProofToken(token)).not.toBeNull();
    expect(readProofToken(token, new Date(Date.now() + 10_000))).toBeNull();
  });

  it("refuses a claim missing what it must name", () => {
    expect(readProofToken(mint({ projectId: randomUUID(), expiresAt: Date.now() + 60_000 }))).toBeNull();
    expect(readProofToken(mint({ ...claim(), projectId: "not-a-uuid" }))).toBeNull();
  });
});
