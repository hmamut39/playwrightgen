import { describe, expect, it } from "vitest";

import { describeAttempts } from "@/lib/format/attempt-story";

const at = (minutesAgo: number, result: string) => ({
  result,
  executedAt: new Date(Date.UTC(2026, 8, 23, 12, 0) - minutesAgo * 60_000),
});

describe("a run's recent attempts, in one sentence", () => {
  it("tells a flake from a break", () => {
    // Failed and passed minutes apart: the same round, so it is flaky.
    expect(describeAttempts([at(2, "PASSED"), at(4, "FAILED"), at(1_500, "PASSED")])).toBe(
      "Failed, then passed when run again.",
    );
    // Failed yesterday, passing today: it recovered rather than flaked.
    expect(describeAttempts([at(5, "PASSED"), at(1_500, "FAILED")])).toBe("Failing before, passing now.");
  });

  it("says how long something has held, either way", () => {
    expect(describeAttempts([at(5, "PASSED"), at(1_500, "PASSED"), at(3_000, "PASSED")])).toBe("Passed the last 3 times.");
    expect(describeAttempts([at(5, "FAILED"), at(1_500, "FAILED")])).toBe("Failed the last 2 times.");
    expect(describeAttempts([at(5, "FAILED"), at(1_500, "PASSED")])).toBe("Passed before, failing now.");
  });

  it("handles a first attempt, an unusable one, and nothing at all", () => {
    expect(describeAttempts([at(5, "PASSED")])).toBe("The last attempt passed.");
    expect(describeAttempts([at(5, "FAILED")])).toBe("The last attempt failed.");
    expect(describeAttempts([at(5, "BLOCKED"), at(1_500, "PASSED")])).toBe("The last attempt could not run.");
    expect(describeAttempts([])).toBeNull();
  });

  it("reads the attempts in the order they happened, not the order given", () => {
    const shuffled = [at(1_500, "FAILED"), at(5, "PASSED"), at(3_000, "PASSED")];
    expect(describeAttempts(shuffled)).toBe("Failing before, passing now.");
  });
});
