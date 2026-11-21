/**
 * What the free tools have cost, and the most one visitor could.
 *
 * A script rather than a page, deliberately: this is the owner's number, not
 * a visitor's, and it answers the question the January trial turns on --
 * whether a week of somebody trying this unaided is affordable to give away.
 *
 *     npm run cost:free-tools            the last 7 days
 *     npm run cost:free-tools -- 30      the last 30
 */
import { config } from "dotenv";

import { freeToolCostReport, summariseFreeToolCost } from "@/lib/ai/free-tool-cost";
import { PRICES_COPIED_ON } from "@/lib/ai/model-cost";
import { getPrismaClient } from "@/lib/db/prisma";

/**
 * The published daily allowances, and which surfaces draw on each.
 *
 * Repairing a draft spends from the quick-generate allowance -- five calls a
 * day across both together -- so they share a pool. Bounding them separately
 * would double that half of the ceiling.
 */
const POOLS = {
  "quick-generate": { limit: 5, surfaces: ["quick-generate", "draft-repair"] },
  "coverage-review": { limit: 5, surfaces: ["coverage-review"] },
  "release-review": { limit: 5, surfaces: ["release-review"] },
};

async function main() {
  // The connection string lives in .env.local, like every other local secret.
  config({ path: ".env.local", quiet: true });

  const days = Number(process.argv[2] ?? 7);
  if (!Number.isFinite(days) || days <= 0) {
    console.error("Usage: npm run cost:free-tools -- <days>");
    process.exit(1);
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await getPrismaClient().publicAiUsage.findMany({
    where: { createdAt: { gte: since } },
    select: { surface: true, model: true, inputTokens: true, outputTokens: true },
  });

  console.log("");
  for (const line of freeToolCostReport(summariseFreeToolCost(rows, POOLS), days)) console.log(line);
  console.log("");
  console.log(`Priced at the rates copied on ${PRICES_COPIED_ON}; cached prompts would be cheaper.`);
}

void main();
