import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { listTestCases } from "@/lib/services/test-cases";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;

/**
 * Telling the three proven tests from the rest of the list.
 *
 * The Overview says "3 tests are already proven on your page, waiting for a
 * person" and offers "Open the proven tests". That lands on the Test Cases
 * list, where every row read DRAFT / Version 1 / 0 linked requirements /
 * Automation: CANDIDATE. The product computes that exact set to write the
 * banner, and then sent the person to find three tests among seven with
 * nothing to tell them apart.
 */
describe("which test cases already passed on the live page", () => {
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

  async function workspace() {
    const owner = await prisma.user.create({
      data: { clerkUserId: unique("owner"), displayName: "Owner" },
    });
    const organization = await prisma.organization.create({
      data: { clerkOrganizationId: unique("org"), name: "Shop", slug: unique("shop") },
    });
    await prisma.membership.create({
      data: { organizationId: organization.id, userId: owner.id, role: "OWNER" },
    });
    const project = await prisma.project.create({
      data: {
        organizationId: organization.id,
        name: "Checkout",
        slug: unique("checkout"),
        createdByUserId: owner.id,
      },
    });
    return { owner, organization, project };
  }

  const deps = (space: Awaited<ReturnType<typeof workspace>>) => ({
    authenticate: async () => ({
      userId: space.owner.clerkUserId,
      orgId: space.organization.clerkOrganizationId,
    }),
    prisma,
  });

  const testCase = (space: Awaited<ReturnType<typeof workspace>>, title: string) =>
    prisma.testCase.create({
      data: {
        organizationId: space.organization.id,
        projectId: space.project.id,
        title,
        objective: "Checks something.",
        preconditions: "",
        steps: ["Do it"],
        expectedResults: ["It worked"],
        status: "DRAFT",
        ownerUserId: space.owner.id,
        createdByUserId: space.owner.id,
      },
    });

  const draft = async (
    space: Awaited<ReturnType<typeof workspace>>,
    testCaseId: string,
    verdict: string,
    usedAt: Date | null = null,
  ) =>
    prisma.testCaseImportedDraft.create({
      data: {
        organizationId: space.organization.id,
        projectId: space.project.id,
        testCaseId,
        code: "test('x', async () => {});",
        source: "page-coverage",
        runEvidence: { verdict },
        usedAt,
        importedByUserId: space.owner.id,
      },
    });

  it("marks the ones whose code passed, and only those", async () => {
    const space = await workspace();
    const passed = await testCase(space, "Add a single todo");
    const partial = await testCase(space, "Add multiple todos");
    const bare = await testCase(space, "Prevent an empty todo");
    await draft(space, passed.id, "passed");
    // A partial run carries a receipt too. Calling it proven is the
    // overstatement the rest of this product exists to avoid.
    await draft(space, partial.id, "partial");

    const list = await listTestCases({ projectId: space.project.id }, deps(space));
    const marked = Object.fromEntries(
      list.items.map((item) => [item.title, item.provenOnLivePage]),
    );

    expect(marked[passed.title]).toBe(true);
    expect(marked[partial.title]).toBe(false);
    expect(marked[bare.title]).toBe(false);
  });

  it("stops saying it once the code has become an automation version", async () => {
    const space = await workspace();
    const used = await testCase(space, "Add a single todo");
    await draft(space, used.id, "passed", new Date());

    const list = await listTestCases({ projectId: space.project.id }, deps(space));

    // The Automation column says so from then on, and two labels for one
    // fact is how a list starts disagreeing with itself.
    expect(list.items[0].provenOnLivePage).toBe(false);
  });

  it("does not read another project's proof", async () => {
    const space = await workspace();
    const other = await workspace();
    const mine = await testCase(space, "Add a single todo");
    const theirs = await testCase(other, "Add a single todo");
    await draft(other, theirs.id, "passed");

    const list = await listTestCases({ projectId: space.project.id }, deps(space));

    expect(list.items).toHaveLength(1);
    expect(list.items[0].id).toBe(mine.id);
    expect(list.items[0].provenOnLivePage).toBe(false);
  });
});
