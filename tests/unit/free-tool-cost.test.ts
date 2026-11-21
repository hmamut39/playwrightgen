import { describe, expect, it } from "vitest";

import { freeToolCostReport, summariseFreeToolCost, type UsageRow } from "@/lib/ai/free-tool-cost";

/**
 * What the free tools cost, and the one thing this data cannot say.
 *
 * The number the January trial turns on is what a stranger costs for a week.
 * Nothing records who ran what -- deliberately -- so one person's week does
 * not exist here and no amount of arithmetic will produce it. What can be
 * produced is a ceiling: the published daily limit, spent in full, every day,
 * at the measured average. The tests below are mostly about not letting that
 * ceiling quietly turn into a claim about a real person, and not letting an
 * average of two runs be presented as an average.
 */
const run = (surface: string, inputTokens: number | null = 10_000, outputTokens = 2_000): UsageRow => ({
  surface,
  model: "gpt-5-mini",
  inputTokens,
  outputTokens: inputTokens === null ? null : outputTokens,
});

const LIMITS = {
  "quick-generate": { limit: 5, surfaces: ["quick-generate", "draft-repair"] },
  "coverage-review": { limit: 5, surfaces: ["coverage-review"] },
};

describe("adding up what was spent", () => {
  it("totals each surface and the lot", () => {
    const cost = summariseFreeToolCost(
      [run("quick-generate"), run("quick-generate"), run("coverage-review")],
      LIMITS,
    );

    expect(cost.runs).toBe(3);
    // 10k in at $0.25/M and 2k out at $2.00/M is $0.0065 a run.
    expect(cost.usd).toBeCloseTo(0.0195, 10);
    expect(cost.surfaces.find((entry) => entry.surface === "quick-generate")?.runs).toBe(2);
  });

  it("averages over the runs it could price, not over all of them", () => {
    /*
     * Dividing a partial total by a full count would report a surface as
     * cheaper the more of it went unpriced -- the error would grow with the
     * thing that caused it, which is the worst shape a reporting bug has.
     */
    const cost = summariseFreeToolCost(
      [run("quick-generate"), run("quick-generate", null), { ...run("quick-generate"), model: "unknown-model" }],
      LIMITS,
    );
    const surface = cost.surfaces[0];

    expect(surface.runs).toBe(3);
    expect(surface.priced).toBe(1);
    expect(surface.averageUsd).toBeCloseTo(0.0065, 10);
  });

  it("says nothing rather than zero when nothing could be priced", () => {
    const cost = summariseFreeToolCost([run("quick-generate", null)], LIMITS);

    expect(cost.usd).toBeNull();
    expect(cost.worstWeekUsd).toBeNull();
    expect(cost.surfaces[0].averageUsd).toBeNull();
  });

  it("handles a window with nothing in it", () => {
    expect(summariseFreeToolCost([], LIMITS)).toMatchObject({ runs: 0, usd: null, worstWeekUsd: null });
  });
});

describe("the ceiling on one visitor", () => {
  it("does not let two surfaces spend the same allowance twice", () => {
    /*
     * Repairing a draft draws on the quick-generate allowance: five calls a
     * day across both, not five of each. Bounding them separately would have
     * doubled this half of the ceiling, and the number would have looked
     * perfectly reasonable.
     */
    const cost = summariseFreeToolCost(
      [run("quick-generate"), run("draft-repair", 20_000, 4_000)],
      LIMITS,
    );

    // The dearer of the two, at five a day for a week -- not the sum.
    expect(cost.worstWeekUsd).toBeCloseTo(0.013 * 5 * 7, 10);
    expect(cost.unbounded).toEqual([]);
  });

  it("is the daily limit, every day, at the measured average", () => {
    const cost = summariseFreeToolCost([run("quick-generate"), run("coverage-review")], LIMITS);

    // 5 a day x 7 days x $0.0065, twice over.
    expect(cost.worstWeekUsd).toBeCloseTo(0.0065 * 5 * 7 * 2, 10);
  });

  it("leaves out a surface it cannot bound, and names it", () => {
    /*
     * A surface with no published limit cannot be capped. Dropping it
     * silently would make the ceiling read as covering everything, which is
     * the one way a ceiling becomes a lie.
     */
    const cost = summariseFreeToolCost([run("quick-generate"), run("page-coverage")], LIMITS);

    expect(cost.unbounded).toEqual(["page-coverage"]);
    expect(cost.worstWeekUsd).toBeCloseTo(0.0065 * 5 * 7, 10);
  });
});

describe("the report a person reads", () => {
  const text = (rows: UsageRow[], days = 7) =>
    freeToolCostReport(summariseFreeToolCost(rows, LIMITS), days).join("\n");

  it("says the window, because a sum without one means nothing", () => {
    expect(text([run("quick-generate")])).toContain("the last 7 days");
  });

  it("explains an empty window rather than reporting zero spend", () => {
    const report = text([]);

    expect(report).toContain("No free-tool model calls recorded");
    expect(report).toContain("Recording started");
  });

  it("refuses to pass the ceiling off as a measurement of a person", () => {
    const report = text([run("quick-generate"), run("quick-generate")]);

    expect(report).toContain("cannot cost more than");
    expect(report).toContain("not a measurement of anybody");
    expect(report).toContain("records who ran what");
  });

  it("marks an average built on too few runs", () => {
    const report = text([run("quick-generate"), run("quick-generate")]);

    expect(report).toContain("too few to average");
  });

  it("stops marking it once there are enough", () => {
    const report = text(Array.from({ length: 6 }, () => run("quick-generate")));

    // "thin" is a substring of "Nothing", which this once matched instead.
    expect(report).not.toContain("too few to average");
  });

  it("names the surfaces the ceiling does not cover", () => {
    const report = text([run("quick-generate"), run("page-coverage")]);

    expect(report).toContain("Not in that ceiling: page-coverage");
  });
});
