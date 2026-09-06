import { afterEach, describe, expect, it } from "vitest";

import {
  getHealthReport,
  HEALTH_CACHE_MS,
  resetHealthCache,
  type ComponentHealth,
} from "@/lib/operations/health";

/**
 * The endpoint exists because a dependency died silently for months. These
 * cases pin the two properties that would have caught it: a dependency that
 * fails a real round trip has to change the reported status, and the report has
 * to stay safe to expose without a credential.
 */

const up = (name: string): ComponentHealth => ({
  name,
  state: "up",
  latencyMs: 3,
  critical: true,
});

const down = (name: string): ComponentHealth => ({
  name,
  state: "down",
  latencyMs: 5000,
  critical: true,
});

const configured = {
  OPENAI_API_KEY: "sk-test",
  CLERK_SECRET_KEY: "sk_test",
  RUNNER_INGEST_SECRET: "runner-secret",
} as const;

const healthy = {
  probeDatabase: async () => up("database"),
  probeRedis: async () => up("redis"),
  source: configured,
};

describe("health report", () => {
  afterEach(() => resetHealthCache());

  it("reports healthy when every dependency answers", async () => {
    const report = await getHealthReport(1_000, healthy);

    expect(report.status).toBe("healthy");
    expect(report.components.map((c) => c.name)).toEqual([
      "database",
      "redis",
      "openai",
      "clerk",
      "runner-ingest",
    ]);
  });

  it("degrades when a critical dependency fails its round trip", async () => {
    // The Upstash outage in the flesh: the database was fine, the site returned
    // 200 on every page, and Redis had stopped resolving.
    const report = await getHealthReport(1_000, {
      ...healthy,
      probeRedis: async () => down("redis"),
    });

    expect(report.status).toBe("degraded");
    expect(report.components.find((c) => c.name === "redis")?.state).toBe("down");
  });

  it("degrades when a critical key is missing entirely", async () => {
    const report = await getHealthReport(1_000, {
      ...healthy,
      source: { ...configured, OPENAI_API_KEY: "   " },
    });

    expect(report.status).toBe("degraded");
    expect(report.components.find((c) => c.name === "openai")?.state).toBe("missing");
  });

  it("stays healthy when only a non-critical dependency is missing", async () => {
    const report = await getHealthReport(1_000, {
      ...healthy,
      source: { ...configured, RUNNER_INGEST_SECRET: undefined },
    });

    expect(report.status).toBe("healthy");
    expect(report.components.find((c) => c.name === "runner-ingest")?.state).toBe("missing");
  });

  it("never reports a configured key as up", async () => {
    // "Configured" and "working" are different claims. Conflating them is how
    // the last outage stayed hidden behind a valid-looking environment.
    const report = await getHealthReport(1_000, healthy);
    const providers = report.components.filter((c) =>
      ["openai", "clerk", "runner-ingest"].includes(c.name),
    );

    expect(providers.every((c) => c.state === "configured")).toBe(true);
    expect(providers.every((c) => c.latencyMs === undefined)).toBe(true);
  });

  it("serves the cached report until it expires, then probes again", async () => {
    let probes = 0;
    const counting = {
      ...healthy,
      probeDatabase: async () => {
        probes += 1;
        return up("database");
      },
    };

    await getHealthReport(1_000, counting);
    await getHealthReport(1_000 + HEALTH_CACHE_MS - 1, counting);
    expect(probes).toBe(1);

    await getHealthReport(1_000 + HEALTH_CACHE_MS + 1, counting);
    expect(probes).toBe(2);
  });

  it("recovers from degraded once the cache expires", async () => {
    // A stuck-degraded report would be as misleading as the stuck-healthy one.
    const first = await getHealthReport(1_000, {
      ...healthy,
      probeRedis: async () => down("redis"),
    });
    expect(first.status).toBe("degraded");

    const second = await getHealthReport(1_000 + HEALTH_CACHE_MS + 1, healthy);
    expect(second.status).toBe("healthy");
  });

  it("exposes no hostname, credential, or error text", async () => {
    const report = await getHealthReport(1_000, {
      probeDatabase: async () => down("database"),
      probeRedis: async () => down("redis"),
      source: {
        OPENAI_API_KEY: "sk-live-should-never-appear",
        CLERK_SECRET_KEY: "sk_live_should_never_appear",
        RUNNER_INGEST_SECRET: "runner-should-never-appear",
      },
    });

    const serialized = JSON.stringify(report);
    for (const secret of [
      "sk-live-should-never-appear",
      "sk_live_should_never_appear",
      "runner-should-never-appear",
      "upstash",
      "neon",
      "postgres",
      "http",
    ]) {
      expect(serialized.toLowerCase()).not.toContain(secret);
    }

    // The shape itself is the guarantee: nothing beyond these four keys can
    // reach an unauthenticated caller, whatever a future probe returns.
    for (const component of report.components) {
      expect(Object.keys(component).sort()).toEqual(
        expect.arrayContaining(["critical", "name", "state"]),
      );
      expect(Object.keys(component).every((key) =>
        ["name", "state", "latencyMs", "critical"].includes(key),
      )).toBe(true);
    }
    expect(Object.keys(report).sort()).toEqual(["checkedAt", "components", "status"]);
  });
});
