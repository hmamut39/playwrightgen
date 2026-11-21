import "server-only";

import { getPrismaClient } from "@/lib/db/prisma";

/**
 * Records what one free-tool model call cost, and never gets in the way.
 *
 * The workspace has kept token counts since its first version. The free tools
 * -- the ones a stranger meets, the ones that decide whether this is
 * affordable to give away -- kept none. The counts were written to the
 * application log and nowhere else, and a log is gone in a day, so the
 * question the January trial turns on ("what does a week of somebody trying
 * this cost") had no answer anywhere.
 *
 * Three rules, all of them about not making a visitor pay for this:
 *
 * - It cannot fail a request. A cost ledger that takes the generator down
 *   with it would be a straight downgrade, so every error is swallowed after
 *   being logged once.
 * - It cannot slow a request. Callers schedule it with `after()`, so the row
 *   is written once the answer has already gone back.
 * - It records nothing about the person. No visitor, no address, no page URL.
 *   The surface, the model and the counts are the whole row.
 */
export type PublicAiUsageInput = {
  /** quick-generate, coverage-review, release-review, draft-repair. */
  surface: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export async function recordPublicAiUsage(
  input: PublicAiUsageInput,
  dependencies?: { client?: ReturnType<typeof getPrismaClient> },
): Promise<void> {
  try {
    const client = dependencies?.client ?? getPrismaClient();
    await client.publicAiUsage.create({
      data: {
        surface: input.surface.slice(0, 100),
        model: input.model.slice(0, 100),
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        totalTokens: input.totalTokens,
      },
    });
  } catch (error) {
    // Once, and without the input: this is bookkeeping, and the visitor has
    // already been served.
    console.error("[public-ai-usage] a run went unrecorded", error);
  }
}
