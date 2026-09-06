import { describe, expect, it } from "vitest";

import { ingestPayloadSchema } from "@/lib/services/test-run-ingest";
import { webUrlSchema } from "@/lib/validation/url";

/**
 * Evidence links are stored immutably and clicked by reviewers who are trusting
 * the record, so the schemes they may use are stated rather than inherited from
 * whatever the URL constructor happens to parse.
 */
describe("web URL validation", () => {
  const schema = webUrlSchema();

  it("accepts the schemes an artifact can actually use", () => {
    expect(schema.safeParse("https://example.com/trace.zip").success).toBe(true);
    // http as well as https, because a local or staging base URL is legitimate.
    expect(schema.safeParse("http://localhost:3000/report").success).toBe(true);
  });

  it("rejects schemes that can never be a legitimate artifact", () => {
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
    ]) {
      expect(schema.safeParse(value).success).toBe(false);
    }
  });

  it("still rejects values that are not URLs at all", () => {
    expect(schema.safeParse("not a url").success).toBe(false);
    expect(schema.safeParse("").success).toBe(false);
  });
});

describe("ingest payload artifacts", () => {
  const base = {
    organizationId: "11111111-1111-4111-8111-111111111111",
    projectId: "22222222-2222-4222-8222-222222222222",
    run: {
      provider: "github_actions" as const,
      externalId: "1234-1",
      url: "https://github.com/acme/app/actions/runs/1234",
      commitSha: "a".repeat(40),
      ref: "main",
    },
    environment: "STAGING" as const,
    browser: "CHROMIUM" as const,
  };

  const withArtifacts = (artifacts: unknown) => ({
    ...base,
    results: [{ title: "checkout", status: "failed", artifacts }],
  });

  it("accepts artifacts reported for a test", () => {
    const parsed = ingestPayloadSchema.safeParse(
      withArtifacts([
        { kind: "TRACE", label: "Trace (in CI artifacts)", url: "https://example.com/a.zip" },
        { kind: "SCREENSHOT", url: "https://example.com/s.png" },
      ]),
    );

    expect(parsed.success).toBe(true);
  });

  it("treats artifacts as optional, so an older runner keeps working", () => {
    const parsed = ingestPayloadSchema.safeParse({
      ...base,
      results: [{ title: "checkout", status: "passed" }],
    });

    expect(parsed.success).toBe(true);
  });

  it("refuses an artifact link that is not http or https", () => {
    const parsed = ingestPayloadSchema.safeParse(
      withArtifacts([{ kind: "TRACE", url: "javascript:alert(1)" }]),
    );

    expect(parsed.success).toBe(false);
  });

  it("refuses an unknown artifact kind rather than storing it unrendered", () => {
    const parsed = ingestPayloadSchema.safeParse(
      withArtifacts([{ kind: "HEAPDUMP", url: "https://example.com/x" }]),
    );

    expect(parsed.success).toBe(false);
  });

  it("bounds how many artifacts one test may report", () => {
    const many = Array.from({ length: 21 }, (_, index) => ({
      kind: "SCREENSHOT" as const,
      url: `https://example.com/${index}.png`,
    }));

    expect(ingestPayloadSchema.safeParse(withArtifacts(many)).success).toBe(false);
  });
});
