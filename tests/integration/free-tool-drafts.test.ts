import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  FREE_TOOL_DRAFT_LIMIT,
  deleteFreeToolDraft,
  getFreeToolDraft,
  listFreeToolDrafts,
  recordFreeToolDraftCode,
  recordFreeToolDraftRun,
  saveFreeToolDraft,
} from "@/lib/services/free-tool-drafts";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const run = {
  verdict: "passed" as const,
  passed: 5,
  failed: 0,
  skipped: 0,
  notReached: 0,
  ranAt: "2026-09-14T10:00:00.000Z",
  pageUrl: "https://demo.playwright.dev/todomvc/",
  receipt: "pwgr1.body.mac",
};

describe("a signed-in person's saved free-tool drafts", () => {
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

  const save = (clerkUserId: string, title = "Adds a todo") =>
    saveFreeToolDraft({
      clerkUserId,
      source: "quick-generate",
      title,
      pageUrl: "https://demo.playwright.dev/todomvc/",
      code: "test('x', async ({ page }) => {});",
      payload: { request: "Add a todo" },
    }, prisma);

  it("keeps each person's drafts, runs and fixes to themselves", async () => {
    const alice = `user_${randomUUID()}`;
    const bob = `user_${randomUUID()}`;
    const id = await save(alice);

    expect(await getFreeToolDraft(bob, id, prisma)).toBeNull();
    expect(await recordFreeToolDraftRun({ clerkUserId: bob, draftId: id, code: "stolen", run }, prisma)).toBe(false);
    expect(await deleteFreeToolDraft(bob, id, prisma)).toBe(false);
    expect(await listFreeToolDrafts(bob, prisma)).toEqual([]);

    expect(await recordFreeToolDraftRun({ clerkUserId: alice, draftId: id, code: "ran code", run }, prisma)).toBe(true);
    const ran = await getFreeToolDraft(alice, id, prisma);
    expect(ran).toMatchObject({ code: "ran code", lastRun: { verdict: "passed", passed: 5, receipt: "pwgr1.body.mac" } });
    expect((await listFreeToolDrafts(alice, prisma))[0]).toMatchObject({ id, lastRun: { verdict: "passed", passed: 5 } });

    // A fix changes the code, so the old run no longer describes it.
    await recordFreeToolDraftCode({ clerkUserId: alice, draftId: id, code: "fixed code" }, prisma);
    expect(await getFreeToolDraft(alice, id, prisma)).toMatchObject({ code: "fixed code", lastRun: null });

    expect(await getFreeToolDraft(alice, "not-a-uuid", prisma)).toBeNull();
    expect(await deleteFreeToolDraft(alice, id, prisma)).toBe(true);
    expect(await listFreeToolDrafts(alice, prisma)).toEqual([]);
  });

  it("keeps only the most recent drafts", async () => {
    const person = `user_${randomUUID()}`;
    const first = await save(person, "Oldest");
    for (let index = 0; index < FREE_TOOL_DRAFT_LIMIT; index += 1) await save(person, `Draft ${index}`);
    const drafts = await listFreeToolDrafts(person, prisma);
    expect(drafts).toHaveLength(FREE_TOOL_DRAFT_LIMIT);
    expect(drafts.some((draft) => draft.id === first)).toBe(false);
    expect(await prisma.freeToolDraft.count({ where: { clerkUserId: person } })).toBe(FREE_TOOL_DRAFT_LIMIT);
  });
});
