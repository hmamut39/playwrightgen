import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * When both limits are over, the one reported must be the one that binds.
 *
 * Found by using the free tool until it refused, on 2026-10-18. The page said
 * "That was quick -- wait a minute before the next run" beside a counter
 * reading "0 of 5 drafts left today". Both sentences were true of their own
 * limit and the advice was useless: a minute does not return a daily
 * allowance, which comes back at midnight.
 *
 * It mattered more than a confusing sentence. The workspace flows act on that
 * answer: `reserveWaitingOutBurst` sleeps the minute out and tries again,
 * precisely because a minute limit is a wait rather than a refusal. Told
 * "burst" when the truth was "daily", a prove run sat there for a minute and
 * then failed for the real reason.
 *
 * Both limiters decide this inside one Lua script, atomically, in Redis.
 * Nothing in this suite executes Lua, so the order is asserted by reading the
 * script that ships -- which is the thing that decides it.
 */
const root = resolve(__dirname, "..", "..");
const GUARDS = [
  "lib/operations/public-ai-guard.ts",
  "lib/operations/organization-ai-guard.ts",
  // The CI limiter counts results rather than requests, so its daily test
  // reads differently; the rule it has to follow is the same, and the reader
  // is a build engineer looking at a log instead of a visitor at a form.
  "lib/operations/run-ingest-guard.ts",
];

describe("the limit a caller is told about", () => {
  it("checks the day before the minute, in every limiter", () => {
    for (const guard of GUARDS) {
      const source = readFileSync(join(root, guard), "utf8");
      const daily = source.search(/if daily_\w+ [+>]/);
      const minute = source.indexOf("if minute_count >= minute_limit then");
      expect(daily, `${guard}: no daily check`).toBeGreaterThan(-1);
      expect(minute, `${guard}: no minute check`).toBeGreaterThan(-1);
      expect(
        daily,
        `${guard}: the minute is checked first, so a caller whose day is spent is told to wait a minute`,
      ).toBeLessThan(minute);
    }
  });

  it("keeps the codes the callers read", () => {
    // 2 is the daily refusal and 1 the minute one; the wrapper turns those
    // into the error codes, and the waiting helper only waits for a minute.
    for (const guard of GUARDS) {
      const source = readFileSync(join(root, guard), "utf8");
      expect(source).toMatch(/return \{0, minute_count, daily_\w+, 2\}/);
      expect(source).toMatch(/return \{0, minute_count, daily_\w+, 1\}/);
    }
  });
});
