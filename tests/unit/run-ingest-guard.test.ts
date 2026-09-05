import { describe, expect, it, vi } from "vitest";

import {
  reserveRunIngest,
  RunIngestRateLimitError,
} from "@/lib/operations/run-ingest-guard";

const ORG = "11111111-1111-4111-8111-111111111111";
const environment = {
  UPSTASH_REDIS_REST_URL: "https://redis.example",
  UPSTASH_REDIS_REST_TOKEN: "redis-token-for-tests-that-is-long-enough",
};

/** Mirrors the Lua reservation so the limit semantics can be asserted. */
function fakeRedis(state = { minute: 0, dailyResults: 0 }) {
  return vi.fn(async (_keys: string[], args: string[]) => {
    const [minuteLimit, dailyResultLimit, , , results] = args.map(Number);
    if (state.minute >= minuteLimit) return [0, state.minute, state.dailyResults, 1];
    if (state.dailyResults + results > dailyResultLimit) {
      return [0, state.minute, state.dailyResults, 2];
    }
    state.minute += 1;
    state.dailyResults += results;
    return [1, state.minute, state.dailyResults, 0];
  });
}

describe("reserveRunIngest", () => {
  it("reserves capacity and reports what remains", async () => {
    const execute = fakeRedis();

    const reservation = await reserveRunIngest({
      organizationId: ORG,
      resultCount: 5,
      source: environment,
      execute,
    });

    expect(reservation.minuteRemaining).toBe(59);
    expect(reservation.dailyResultsRemaining).toBe(19_995);
  });

  it("counts results rather than requests against the daily allowance", async () => {
    const state = { minute: 0, dailyResults: 0 };
    const execute = fakeRedis(state);

    await reserveRunIngest({ organizationId: ORG, resultCount: 200, source: environment, execute });
    await reserveRunIngest({ organizationId: ORG, resultCount: 300, source: environment, execute });

    // Two requests, five hundred rows. Counting requests alone would report
    // almost no usage while the database absorbed all of it.
    expect(state.dailyResults).toBe(500);
    expect(state.minute).toBe(2);
  });

  it("refuses a burst beyond the per-minute request limit", async () => {
    const execute = fakeRedis({ minute: 60, dailyResults: 0 });

    await expect(
      reserveRunIngest({ organizationId: ORG, resultCount: 1, source: environment, execute }),
    ).rejects.toMatchObject({ code: "ingest_burst_limit", retryAfterSeconds: 60 });
  });

  it("refuses a batch that would cross the daily result limit", async () => {
    const execute = fakeRedis({ minute: 0, dailyResults: 19_900 });

    // Rejected whole rather than partially recorded: half a run's evidence is
    // worse than none, because it looks complete.
    await expect(
      reserveRunIngest({ organizationId: ORG, resultCount: 200, source: environment, execute }),
    ).rejects.toBeInstanceOf(RunIngestRateLimitError);
  });

  it("admits a batch that exactly reaches the daily limit", async () => {
    const execute = fakeRedis({ minute: 0, dailyResults: 19_900 });

    await expect(
      reserveRunIngest({ organizationId: ORG, resultCount: 100, source: environment, execute }),
    ).resolves.toMatchObject({ dailyResultsRemaining: 0 });
  });

  it("honours configured limits over the defaults", async () => {
    const execute = fakeRedis({ minute: 2, dailyResults: 0 });

    await expect(
      reserveRunIngest({
        organizationId: ORG,
        resultCount: 1,
        source: { ...environment, RUN_INGEST_MINUTE_LIMIT: "2" },
        execute,
      }),
    ).rejects.toMatchObject({ code: "ingest_burst_limit" });
  });

  it("scopes counters to one organization", async () => {
    const execute = fakeRedis();

    await reserveRunIngest({ organizationId: ORG, resultCount: 1, source: environment, execute });

    const [keys] = execute.mock.calls[0];
    expect(keys[0]).toContain(ORG);
    expect(keys[1]).toContain(ORG);
    expect(keys[1]).toMatch(/:day:\d{4}-\d{2}-\d{2}$/);
  });

  it("rejects an invalid organization or result count before touching Redis", async () => {
    const execute = fakeRedis();

    await expect(
      reserveRunIngest({ organizationId: "nope", resultCount: 1, source: environment, execute }),
    ).rejects.toBeTruthy();
    await expect(
      reserveRunIngest({ organizationId: ORG, resultCount: 0, source: environment, execute }),
    ).rejects.toBeTruthy();

    expect(execute).not.toHaveBeenCalled();
  });
});
