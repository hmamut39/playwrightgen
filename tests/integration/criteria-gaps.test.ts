import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import type { CriteriaCoverage } from "@/lib/ai/criteria-coverage";
import { CriteriaGapsError, readRequirementGaps } from "@/lib/services/criteria-gaps";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;

/**
 * The reading exists to prompt a person. What matters is that it only ever
 * compares things that are really there, and that it never becomes a record.
 */
describe("what a requirement still needs", () => {
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

  async function space() {
    const owner = await prisma.user.create({ data: { clerkUserId: unique("owner"), displayName: "Lead" } });
    const organization = await prisma.organization.create({
      data: { clerkOrganizationId: unique("org"), name: "Shop", slug: unique("shop") },
    });
    await prisma.membership.create({ data: { organizationId: organization.id, userId: owner.id, role: "OWNER" } });
    const project = await prisma.project.create({
      data: { organizationId: organization.id, name: "Checkout", slug: unique("p"), createdByUserId: owner.id },
    });
    const requirement = await prisma.requirement.create({
      data: {
        organizationId: organization.id,
        projectId: project.id,
        title: "A customer can pay with a saved card",
        description: "A returning customer pays with a card they saved.",
        acceptanceCriteria: ["An order confirmation appears", "The security code is required"].join("\n"),
        status: "APPROVED",
        ownerUserId: owner.id,
        createdByUserId: owner.id,
        currentVersionNumber: 1,
      },
    });
    const owned = {
      authenticate: async () => ({ userId: owner.clerkUserId, orgId: organization.clerkOrganizationId }),
      prisma,
    };
    return { owner, organization, project, requirement, owned };
  }

  async function linkTestCase(
    area: Awaited<ReturnType<typeof space>>,
    title: string,
    status: "APPROVED" | "DRAFT",
  ) {
    const testCase = await prisma.testCase.create({
      data: {
        organizationId: area.organization.id,
        projectId: area.project.id,
        title,
        objective: "Checks the behaviour.",
        preconditions: "",
        steps: ["Open the payment step"],
        expectedResults: ["It works"],
        status,
        ownerUserId: area.owner.id,
        createdByUserId: area.owner.id,
        currentVersionNumber: 1,
      },
    });
    await prisma.requirementTestCase.create({
      data: {
        organizationId: area.organization.id,
        projectId: area.project.id,
        requirementId: area.requirement.id,
        testCaseId: testCase.id,
        createdByUserId: area.owner.id,
      },
    });
    return testCase;
  }

  const reading = (): CriteriaCoverage => ({
    criteria: [
      {
        criterion: "An order confirmation appears",
        covered: true,
        coveredBy: ["Confirmation shows after paying"],
        reason: "That test asserts the confirmation.",
      },
      {
        criterion: "The security code is required",
        covered: false,
        coveredBy: [],
        reason: "No test enters or omits a security code.",
      },
    ],
    notInTheRequirement: ["The tests check that the cart is emptied, which this requirement never mentions."],
    model: "test-model",
  });

  it("names the criteria nothing checks, and what the tests check beyond them", async () => {
    const area = await space();
    await linkTestCase(area, "Confirmation shows after paying", "APPROVED");

    const gaps = await readRequirementGaps(
      { projectId: area.project.id, requirementId: area.requirement.id },
      { ...area.owned, read: async () => reading() },
    );

    expect(gaps.uncovered).toEqual(["The security code is required"]);
    expect(gaps.notInTheRequirement).toHaveLength(1);
  });

  it("compares only approved tests, because a draft proves nothing", async () => {
    const area = await space();
    await linkTestCase(area, "A draft nobody approved", "DRAFT");

    // A draft linked to the requirement must not make it look comparable.
    await expect(
      readRequirementGaps(
        { projectId: area.project.id, requirementId: area.requirement.id },
        { ...area.owned, read: async () => reading() },
      ),
    ).rejects.toMatchObject({ code: "no_tests" });

    await linkTestCase(area, "Confirmation shows after paying", "APPROVED");
    let sawTests: string[] = [];
    await readRequirementGaps(
      { projectId: area.project.id, requirementId: area.requirement.id },
      {
        ...area.owned,
        read: async (value) => {
          sawTests = value.tests.map((test) => test.title);
          return reading();
        },
      },
    );
    expect(sawTests).toEqual(["Confirmation shows after paying"]);
  });

  it("refuses a requirement with no acceptance criteria", async () => {
    const area = await space();
    await linkTestCase(area, "Confirmation shows after paying", "APPROVED");
    await prisma.requirement.update({
      where: { id: area.requirement.id },
      data: { acceptanceCriteria: "   " },
    });

    await expect(
      readRequirementGaps(
        { projectId: area.project.id, requirementId: area.requirement.id },
        { ...area.owned, read: async () => reading() },
      ),
    ).rejects.toBeInstanceOf(CriteriaGapsError);
  });

  it("stores nothing: the reading is for a person, not for the record", async () => {
    const area = await space();
    await linkTestCase(area, "Confirmation shows after paying", "APPROVED");
    const before = await prisma.requirement.findUniqueOrThrow({ where: { id: area.requirement.id } });

    await readRequirementGaps(
      { projectId: area.project.id, requirementId: area.requirement.id },
      { ...area.owned, read: async () => reading() },
    );

    // Nothing about the requirement changed, and no new version was written:
    // a mapping nobody verified must never reach the evidence.
    const after = await prisma.requirement.findUniqueOrThrow({ where: { id: area.requirement.id } });
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(after.currentVersionNumber).toBe(before.currentVersionNumber);
    expect(await prisma.aiSuggestion.count({ where: { projectId: area.project.id } })).toBe(0);
  });
});
