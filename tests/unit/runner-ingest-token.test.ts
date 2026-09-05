import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  applyTestCaseVersionMarker,
  buildTestCaseVersionMarker,
  deriveProjectRunnerToken,
  readTestCaseVersionMarker,
  verifyRunnerSignature,
} from "@/lib/integrations/runner/ingest-token";

const SECRET = "a".repeat(48);
const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";

function sign(token: string, body: string) {
  return `sha256=${createHmac("sha256", token).update(body, "utf8").digest("hex")}`;
}

describe("deriveProjectRunnerToken", () => {
  it("is deterministic for the same tenant", () => {
    const first = deriveProjectRunnerToken({ secret: SECRET, organizationId: ORG, projectId: PROJECT, tokenVersion: 1 });
    const second = deriveProjectRunnerToken({ secret: SECRET, organizationId: ORG, projectId: PROJECT, tokenVersion: 1 });

    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(20);
  });

  it("binds the token to both the organization and the project", () => {
    const base = deriveProjectRunnerToken({ secret: SECRET, organizationId: ORG, projectId: PROJECT, tokenVersion: 1 });
    const otherProject = deriveProjectRunnerToken({
      secret: SECRET,
      organizationId: ORG,
      projectId: "33333333-3333-4333-8333-333333333333",
      tokenVersion: 1,
    });
    const otherOrganization = deriveProjectRunnerToken({
      secret: SECRET,
      organizationId: "44444444-4444-4444-8444-444444444444",
      projectId: PROJECT,
      tokenVersion: 1,
    });

    expect(otherProject).not.toBe(base);
    expect(otherOrganization).not.toBe(base);
  });

  it("changes when the server secret rotates", () => {
    const base = deriveProjectRunnerToken({ secret: SECRET, organizationId: ORG, projectId: PROJECT, tokenVersion: 1 });
    const rotated = deriveProjectRunnerToken({ secret: "b".repeat(48), organizationId: ORG, projectId: PROJECT, tokenVersion: 1 });

    expect(rotated).not.toBe(base);
  });
});

describe("verifyRunnerSignature", () => {
  const token = deriveProjectRunnerToken({ secret: SECRET, organizationId: ORG, projectId: PROJECT, tokenVersion: 1 });
  const body = JSON.stringify({ organizationId: ORG, projectId: PROJECT, results: [] });

  it("accepts a signature produced with the matching token", () => {
    expect(verifyRunnerSignature({ token, rawBody: body, signature: sign(token, body) })).toBe(true);
  });

  it("rejects a body modified after signing", () => {
    const signature = sign(token, body);
    const tampered = body.replace("results", "resultz");

    expect(verifyRunnerSignature({ token, rawBody: tampered, signature })).toBe(false);
  });

  it("rejects a signature from another tenant's token", () => {
    const foreign = deriveProjectRunnerToken({
      secret: SECRET,
      organizationId: ORG,
      projectId: "33333333-3333-4333-8333-333333333333",
      tokenVersion: 1,
    });

    expect(verifyRunnerSignature({ token, rawBody: body, signature: sign(foreign, body) })).toBe(false);
  });

  it("rejects missing, malformed, and unsigned headers", () => {
    expect(verifyRunnerSignature({ token, rawBody: body, signature: null })).toBe(false);
    expect(verifyRunnerSignature({ token, rawBody: body, signature: "" })).toBe(false);
    expect(verifyRunnerSignature({ token, rawBody: body, signature: "sha256=nothex" })).toBe(false);
    expect(verifyRunnerSignature({ token, rawBody: body, signature: "md5=" + "0".repeat(64) })).toBe(false);
  });

  it("rejects everything when the token is empty", () => {
    expect(verifyRunnerSignature({ token: "", rawBody: body, signature: sign("", body) })).toBe(false);
  });
});

describe("test case version markers", () => {
  const versionId = "55555555-5555-4555-8555-555555555555";

  it("round-trips a marker embedded in a test title", () => {
    const title = `${buildTestCaseVersionMarker(versionId)} checkout succeeds`;

    expect(readTestCaseVersionMarker(title)).toBe(versionId);
  });

  it("returns null for titles without a marker", () => {
    expect(readTestCaseVersionMarker("checkout succeeds")).toBeNull();
    expect(readTestCaseVersionMarker("[pwg:not-a-uuid] checkout")).toBeNull();
  });
});

describe("applyTestCaseVersionMarker", () => {
  const versionId = "55555555-5555-4555-8555-555555555555";

  it("stamps the first test title so results map back to the pinned version", () => {
    const code = [
      "import { test, expect } from '@playwright/test';",
      "",
      "test('checkout succeeds', async ({ page }) => {",
      "  await expect(page).toHaveTitle('Cart');",
      "});",
    ].join("\n");

    const stamped = applyTestCaseVersionMarker(code, versionId);
    const title = stamped.match(/test\('([^']+)'/)?.[1] ?? "";

    expect(readTestCaseVersionMarker(title)).toBe(versionId);
    expect(stamped).toContain("checkout succeeds");
  });

  it("handles double and template quoted titles", () => {
    for (const quote of ['"', "`"]) {
      const code = `test(${quote}flow${quote}, async () => {});`;
      expect(readTestCaseVersionMarker(applyTestCaseVersionMarker(code, versionId))).toBe(versionId);
    }
  });

  it("is idempotent so regenerating never double-stamps", () => {
    const code = "test('flow', async () => {});";
    const once = applyTestCaseVersionMarker(code, versionId);

    expect(applyTestCaseVersionMarker(once, versionId)).toBe(once);
  });

  it("stamps only the first test in a multi-test file", () => {
    const code = ["test('first', async () => {});", "test('second', async () => {});"].join("\n");
    const stamped = applyTestCaseVersionMarker(code, versionId);

    expect(stamped.match(/\[pwg:/g)).toHaveLength(1);
    expect(stamped).toContain("test('second'");
  });

  it("leaves code without a test declaration unchanged", () => {
    const code = "export const helper = 1;";

    expect(applyTestCaseVersionMarker(code, versionId)).toBe(code);
  });
});
