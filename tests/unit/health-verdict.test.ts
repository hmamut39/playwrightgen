import { describe, expect, it } from "vitest";

import { healthVerdict } from "@/scripts/health-verdict.mjs";

/**
 * The watcher's own first step, tested against the shape the endpoint really
 * returns.
 *
 * It asked every component for `part.status`. Components carry `state`. So
 * the check matched nothing on every run and printed "5 components healthy",
 * which was a count of components wearing a verdict's clothes. Five green
 * runs went by before anyone printed the JSON.
 *
 * The bodies below are copied from https://playwrightgen.com/api/health on
 * 2026-11-15 rather than invented, because a test written against a guessed
 * shape is how the bug got in.
 */
const live = {
  status: "healthy",
  checkedAt: "2026-11-15T16:15:35.927Z",
  components: [
    { name: "database", state: "up", latencyMs: 597, critical: true },
    { name: "redis", state: "up", latencyMs: 212, critical: true },
    { name: "openai", state: "configured", critical: true },
    { name: "clerk", state: "configured", critical: true },
    { name: "runner-ingest", state: "configured", critical: false },
  ],
};

const ok = (body: unknown) => ({ ok: true, status: 200, body });

describe("reading the production health report", () => {
  it("passes the real body, and counts what is working rather than what exists", () => {
    const verdict = healthVerdict(ok(live));

    expect(verdict.ok).toBe(true);
    expect(verdict.note).toBe("5 components working");
  });

  it("fails when a critical component is down, which the old check could not see", () => {
    const verdict = healthVerdict(
      ok({
        ...live,
        components: live.components.map((part) =>
          part.name === "database" ? { ...part, state: "down" } : part,
        ),
      }),
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.why).toContain("database down");
    expect(verdict.why).toContain("critical");
  });

  it("fails on a 200 whose report does not say healthy", () => {
    const verdict = healthVerdict(ok({ ...live, status: "degraded" }));

    expect(verdict.ok).toBe(false);
    expect(verdict.why).toContain("degraded");
  });

  it("does not call a non-critical component going quiet an outage, but says it", () => {
    // The gap the 503 never covered: a non-critical component down leaves the
    // report "healthy" and the route answering 200, so the watcher said
    // everything was fine while a part of the product had stopped.
    const verdict = healthVerdict(
      ok({
        ...live,
        components: live.components.map((part) =>
          part.name === "runner-ingest" ? { ...part, state: "missing" } : part,
        ),
      }),
    );

    expect(verdict.ok).toBe(true);
    expect(verdict.note).toContain("4 of 5 components working");
    expect(verdict.note).toContain("runner-ingest missing");
    expect(verdict.note).toContain("not critical");
  });

  it("fails a non-200 and carries what the body said with it", () => {
    const verdict = healthVerdict({ ok: false, status: 503, body: { ...live, status: "degraded" } });

    expect(verdict.ok).toBe(false);
    expect(verdict.why).toContain("503");
    expect(verdict.why).toContain("degraded");
  });

  it("refuses a 200 that is not a health report at all", () => {
    // A proxy error page, or a route that stopped existing and now answers
    // with somebody else's HTML, must not read as healthy.
    expect(healthVerdict(ok("<html>not found</html>")).ok).toBe(false);
    expect(healthVerdict(ok(null)).ok).toBe(false);
  });

  it("refuses a report that checked nothing", () => {
    const verdict = healthVerdict(ok({ status: "healthy", components: [] }));

    expect(verdict.ok).toBe(false);
    expect(verdict.why).toContain("checked nothing");
  });
});
