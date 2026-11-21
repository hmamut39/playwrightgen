/**
 * What the free tools cost, from the rows the free tools now keep.
 *
 * The one number the January trial turns on is what a stranger costs for a
 * week of unaided use. That cannot be measured here, and the reason is
 * deliberate: nothing records who ran what, so there is no such thing as one
 * person's week in this data.
 *
 * It can be bounded, exactly, and a bound is the honest answer. Every free
 * surface has a published daily limit. The worst a single visitor can cost is
 * that limit, times the measured average cost of a run on that surface, times
 * seven -- a ceiling nobody can exceed, derived from the product's own rules
 * rather than from watching anybody. Where the average rests on very few runs
 * it says so, because an average of two is not an average.
 */

import { usdForUse, usdLabel } from "@/lib/ai/model-cost";

export type UsageRow = {
  surface: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type SurfaceCost = {
  surface: string;
  runs: number;
  /** Runs the price table could put a figure on. */
  priced: number;
  usd: number | null;
  averageUsd: number | null;
};

export type FreeToolCost = {
  surfaces: SurfaceCost[];
  runs: number;
  usd: number | null;
  /** Surfaces seen in the data that have no published limit to bound. */
  unbounded: string[];
  /** The most one visitor could cost in seven days, at these averages. */
  worstWeekUsd: number | null;
};

/**
 * A published daily allowance, and the surfaces that draw on it.
 *
 * Pools rather than one limit per surface, because they are not the same
 * thing. Repairing a draft spends from the quick-generate allowance: a
 * visitor gets five calls a day across generating and repairing together, not
 * five of each. Bounding them separately would have doubled that half of the
 * ceiling, and the number would have looked perfectly reasonable.
 */
export type AllowancePool = { limit: number; surfaces: string[] };
export type AllowancePools = Record<string, AllowancePool>;

export function summariseFreeToolCost(rows: UsageRow[], pools: AllowancePools): FreeToolCost {
  const bySurface = new Map<string, { runs: number; priced: number; usd: number }>();
  for (const row of rows) {
    const current = bySurface.get(row.surface) ?? { runs: 0, priced: 0, usd: 0 };
    current.runs += 1;
    const cost = usdForUse(row);
    if (cost !== null) {
      current.priced += 1;
      current.usd += cost;
    }
    bySurface.set(row.surface, current);
  }

  const surfaces: SurfaceCost[] = [...bySurface.entries()]
    .map(([surface, totals]) => ({
      surface,
      runs: totals.runs,
      priced: totals.priced,
      usd: totals.priced > 0 ? totals.usd : null,
      // Over the runs that could be priced, not over all of them: dividing a
      // partial total by a full count would quietly report a surface as
      // cheaper the more of it went unpriced.
      averageUsd: totals.priced > 0 ? totals.usd / totals.priced : null,
    }))
    .sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0) || a.surface.localeCompare(b.surface));

  const priced = surfaces.filter((entry) => entry.usd !== null);
  const pooled = new Set(Object.values(pools).flatMap((pool) => pool.surfaces));
  // A surface with no published allowance cannot be bounded, so it is named
  // rather than left out silently -- otherwise the ceiling reads as covering
  // everything.
  const unbounded = surfaces
    .filter((entry) => entry.averageUsd !== null && !pooled.has(entry.surface))
    .map((entry) => entry.surface);

  /*
   * The ceiling, one allowance at a time.
   *
   * Within a pool the worst case is every call being the dearest kind it
   * allows, so the pool's limit is multiplied by the highest average among
   * its surfaces rather than by their sum -- the sum would be a visitor
   * somehow spending the same allowance twice.
   */
  let worstWeekUsd: number | null = null;
  for (const pool of Object.values(pools)) {
    const averages = surfaces
      .filter((entry) => pool.surfaces.includes(entry.surface) && entry.averageUsd !== null)
      .map((entry) => entry.averageUsd as number);
    if (averages.length === 0) continue;
    worstWeekUsd = (worstWeekUsd ?? 0) + Math.max(...averages) * pool.limit * 7;
  }

  return {
    surfaces,
    runs: rows.length,
    usd: priced.length > 0 ? priced.reduce((total, entry) => total + (entry.usd ?? 0), 0) : null,
    unbounded,
    worstWeekUsd,
  };
}

/**
 * The report, in sentences, with every limit of it stated beside the number.
 *
 * `days` is how far back the rows were read, because "$1.40" means nothing
 * without it.
 */
export function freeToolCostReport(cost: FreeToolCost, days: number): string[] {
  const lines: string[] = [];
  const window = `the last ${days} day${days === 1 ? "" : "s"}`;

  if (cost.runs === 0) {
    lines.push(`No free-tool model calls recorded in ${window}.`);
    lines.push(
      "Either nobody used them, or they ran before this was being recorded. " +
        "Recording started on 2026-11-21.",
    );
    return lines;
  }

  lines.push(
    `${cost.runs} free-tool model call${cost.runs === 1 ? "" : "s"} in ${window}` +
      (cost.usd === null ? ", none of which could be priced." : `, costing ${usdLabel(cost.usd)}.`),
  );

  for (const surface of cost.surfaces) {
    const average =
      surface.averageUsd === null ? "unpriced" : `${usdLabel(surface.averageUsd)} a run`;
    // Said in words rather than flagged with one, because "thin" is a
    // substring of "Nothing", which is how the test guarding this first
    // passed against the wrong line of the report.
    const thin =
      surface.priced > 0 && surface.priced < 5
        ? `  (${surface.priced} priced runs -- too few to average)`
        : "";
    lines.push(
      `  ${surface.surface.padEnd(18)} ${String(surface.runs).padStart(4)} runs  ` +
        `${surface.usd === null ? "     --" : usdLabel(surface.usd).padStart(9)}  ${average}${thin}`,
    );
  }

  lines.push("");
  if (cost.worstWeekUsd === null) {
    lines.push("Nothing here can be priced, so there is no ceiling to quote.");
    return lines;
  }

  lines.push(
    `A single visitor cannot cost more than ${usdLabel(cost.worstWeekUsd)} in a week: ` +
      "every published daily limit spent in full, every day, at the average costs above.",
  );
  lines.push(
    "That is a ceiling worked out from the limits, not a measurement of anybody. " +
      "Nothing here records who ran what, on purpose, so one person's week does not exist in this data.",
  );
  if (cost.unbounded.length > 0) {
    lines.push(
      `Not in that ceiling: ${cost.unbounded.join(", ")} -- no published daily limit to bound ${
        cost.unbounded.length === 1 ? "it" : "them"
      } with.`,
    );
  }
  return lines;
}
