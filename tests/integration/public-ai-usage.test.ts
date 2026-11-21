import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { summariseFreeToolCost } from "@/lib/ai/free-tool-cost";
import { recordPublicAiUsage } from "@/lib/services/public-ai-usage";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

/**
 * The ledger that says what the free tools cost.
 *
 * Two things are worth a database for. That a row survives the round trip
 * with its counts intact, because the whole point is that a log does not.
 * And that the row carries nothing about the person who caused it: this
 * table exists to answer a question about money, and an identifier in it
 * would be personal data collected for a question that does not need it.
 */
describe("recording what a free-tool run cost", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    await connectTestDatabase(prisma);
  });
  beforeEach(async () => cleanPhase1ATables(prisma));
  afterAll(async () => {
    if (prisma) {
      await cleanPhase1ATables(prisma);
      await disconnectTestDatabase(prisma);
    }
  });

  it("keeps the counts a log would have thrown away", async () => {
    await recordPublicAiUsage(
      {
        surface: "quick-generate",
        model: "gpt-5-mini",
        inputTokens: 10_000,
        outputTokens: 2_000,
        totalTokens: 12_000,
      },
      { client: prisma },
    );

    const rows = await prisma.publicAiUsage.findMany();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      surface: "quick-generate",
      model: "gpt-5-mini",
      inputTokens: 10_000,
      outputTokens: 2_000,
      totalTokens: 12_000,
    });
  });

  it("stores nothing that identifies anybody", async () => {
    /*
     * The guard for the decision, not the code. A visitor id, an address or
     * the page URL would each make this table answer "what did one person
     * cost" -- and make it a record of who looked at what, which is a
     * different thing to be holding. The report works out the per-visitor
     * ceiling from the published daily limits instead.
     */
    await recordPublicAiUsage(
      { surface: "quick-generate", model: "gpt-5-mini", inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      { client: prisma },
    );

    const [row] = await prisma.publicAiUsage.findMany();
    const fields = Object.keys(row).sort();

    expect(fields).toEqual([
      "createdAt",
      "id",
      "inputTokens",
      "model",
      "outputTokens",
      "surface",
      "totalTokens",
    ]);
  });

  it("keeps a run whose provider reported no usage, rather than losing it", async () => {
    // A run that happened and cost something unknown is still a run. Dropping
    // it would make the surface look cheaper the more often that happened.
    await recordPublicAiUsage(
      { surface: "release-review", model: "gpt-5-mini", inputTokens: null, outputTokens: null, totalTokens: null },
      { client: prisma },
    );

    const rows = await prisma.publicAiUsage.findMany();

    expect(rows).toHaveLength(1);
    expect(rows[0].inputTokens).toBeNull();
  });

  it("never throws, whatever the database does", async () => {
    /*
     * A cost ledger that could take the generator down with it would be a
     * straight downgrade for the visitor, who gets nothing from it.
     */
    const broken = {
      publicAiUsage: {
        create: async () => {
          throw new Error("database is gone");
        },
      },
    } as unknown as PrismaClient;

    await expect(
      recordPublicAiUsage(
        { surface: "quick-generate", model: "gpt-5-mini", inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        { client: broken },
      ),
    ).resolves.toBeUndefined();
  });

  it("adds up into the figure the report quotes", async () => {
    // End to end: rows go in through the recorder, and the arithmetic the
    // owner reads comes back out of the same rows.
    for (const surface of ["quick-generate", "quick-generate", "draft-repair"]) {
      await recordPublicAiUsage(
        { surface, model: "gpt-5-mini", inputTokens: 10_000, outputTokens: 2_000, totalTokens: 12_000 },
        { client: prisma },
      );
    }

    const rows = await prisma.publicAiUsage.findMany({
      select: { surface: true, model: true, inputTokens: true, outputTokens: true },
    });
    const cost = summariseFreeToolCost(rows, {
      "quick-generate": { limit: 5, surfaces: ["quick-generate", "draft-repair"] },
    });

    expect(cost.runs).toBe(3);
    expect(cost.usd).toBeCloseTo(0.0195, 10);
    // One allowance, five a day, seven days, at the dearer of the two
    // surfaces -- which here are the same price.
    expect(cost.worstWeekUsd).toBeCloseTo(0.0065 * 5 * 7, 10);
  });
});
