import { afterEach, describe, expect, it, vi } from "vitest";

import {
  legacyAiRouteFailure,
  legacyAiRouteQuarantine,
} from "@/lib/operations/legacy-ai-route";

describe("legacy AI route quarantine", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a safe retirement response by default", async () => {
    const response = legacyAiRouteQuarantine({
      replacement: "/api/quick-generate",
      source: {},
    });

    expect(response?.status).toBe(410);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(response?.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    await expect(response?.json()).resolves.toMatchObject({
      code: "legacy_endpoint_quarantined",
      replacement: "/api/quick-generate",
    });
  });

  it("allows an explicit temporary migration override", () => {
    expect(
      legacyAiRouteQuarantine({
        replacement: "/api/quick-generate",
        source: { ENABLE_LEGACY_AI_ROUTES: "true" },
      }),
    ).toBeNull();
  });

  it("returns a correlatable generic failure without logging response content", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const response = legacyAiRouteFailure("legacy-generate");

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    await expect(response.json()).resolves.toEqual({
      error: "This legacy AI request failed.",
      code: "legacy_endpoint_failed",
    });

    const logLine = String(error.mock.calls[0]?.[0]);
    expect(logLine).toContain('"event":"legacy_ai.request"');
    expect(logLine).toContain('"surface":"legacy-generate"');
    expect(logLine).not.toContain("This legacy AI request failed.");
  });
});
