import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import type { TestCaseProposalResult } from "@/lib/ai/test-case-proposals";
import {
  approveRequirement,
  createRequirement,
  submitRequirementForReview,
} from "@/lib/services/requirements";
import { proposeTestCasesForRequirement } from "@/lib/services/test-case-proposals";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;

const proposal = (title: string) => ({
  title,
  objective: `Verify ${title}.`,
  preconditions: "A signed-in customer with a card on file.",
  steps: ["Open the cart", "Submit a valid card"],
  expectedResults: ["An order confirmation is displayed"],
  priority: "HIGH" as const,
  type: "END_TO_END" as const,
  rationale: "The acceptance criteria require an order confirmation.",
  coverage: "HAPPY_PATH" as const,
});

const proposalResult = (titles: string[]): TestCaseProposalResult => ({
  proposals: titles.map(proposal),
  openQuestions: ["Which card brands must be accepted?"],
  model: "test-model",
  inputTokens: 10,
  outputTokens: 20,
  totalTokens: 30,
});

describe("proposing Test Cases from an approved Requirement", () => {
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
      data: {
        clerkOrganizationId: unique("org"),
        name: "Proposal workspace",
        slug: unique("proposals"),
      },
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

  const deps = (
    space: Awaited<ReturnType<typeof workspace>>,
    propose?: () => Promise<TestCaseProposalResult>,
  ) => ({
    authenticate: async () => ({
      userId: space.owner.clerkUserId,
      orgId: space.organization.clerkOrganizationId,
    }),
    prisma,
    propose: propose ?? (async () => proposalResult(["Card payment succeeds"])),
  });

  async function approvedRequirement(space: Awaited<ReturnType<typeof workspace>>) {
    const requirement = await createRequirement({
      projectId: space.project.id,
      title: "Customers can pay by card",
      description: "A signed-in customer can pay with a valid card.",
      acceptanceCriteria: "A valid card produces an order confirmation.",
    }, deps(space));
    await submitRequirementForReview({
      projectId: space.project.id, requirementId: requirement.id,
    }, deps(space));
    await approveRequirement({
      projectId: space.project.id, requirementId: requirement.id,
    }, deps(space));
    return requirement;
  }

  it("creates drafts that are linked to the requirement and not approved", async () => {
    // The guarantee that matters: generated coverage cannot approve itself, and
    // the link exists from the moment the draft does, because coverage that is
    // not linked reads as a requirement nothing verifies.
    const space = await workspace();
    const requirement = await approvedRequirement(space);

    const outcome = await proposeTestCasesForRequirement({
      projectId: space.project.id,
      requirementId: requirement.id,
    }, deps(space, async () => proposalResult(["Card payment succeeds", "Declined card is reported"])));

    expect(outcome.created).toHaveLength(2);
    expect(outcome.openQuestions).toContain("Which card brands must be accepted?");

    const testCases = await prisma.testCase.findMany({
      where: { organizationId: space.organization.id, projectId: space.project.id },
      include: { requirementLinks: true },
    });
    expect(testCases).toHaveLength(2);
    expect(testCases.every((testCase) => testCase.status === "DRAFT")).toBe(true);
    expect(testCases.every((testCase) => testCase.source === "AI_SUGGESTED")).toBe(true);
    expect(
      testCases.every((testCase) =>
        testCase.requirementLinks.some((link) => link.requirementId === requirement.id),
      ),
    ).toBe(true);
  });

  it("records an immutable first version for each proposal", async () => {
    // Proposals go through the ordinary creation path, so they are versioned
    // and auditable exactly like a Test Case somebody typed out.
    const space = await workspace();
    const requirement = await approvedRequirement(space);

    await proposeTestCasesForRequirement({
      projectId: space.project.id,
      requirementId: requirement.id,
    }, deps(space));

    const versions = await prisma.testCaseVersion.findMany({
      where: { organizationId: space.organization.id, projectId: space.project.id },
    });
    expect(versions).toHaveLength(1);
    expect(versions[0].versionNumber).toBe(1);
  });

  it("refuses a requirement that has not been approved", async () => {
    // Approval is what stops intent moving. Proposing coverage for a draft
    // would generate tests for a target that is still changing.
    const space = await workspace();
    const requirement = await createRequirement({
      projectId: space.project.id,
      title: "Still being written",
      description: "d",
      acceptanceCriteria: "a",
    }, deps(space));

    await expect(proposeTestCasesForRequirement({
      projectId: space.project.id,
      requirementId: requirement.id,
    }, deps(space))).rejects.toMatchObject({
      code: "requirement_not_approved",
      status: 409,
    });

    expect(await prisma.testCase.count({
      where: { organizationId: space.organization.id },
    })).toBe(0);
  });

  it("tells the model which coverage already exists", async () => {
    // Without this it re-proposes what is already linked, and a reviewer has to
    // notice the duplicate rather than being handed only what is new.
    const space = await workspace();
    const requirement = await approvedRequirement(space);
    await proposeTestCasesForRequirement({
      projectId: space.project.id,
      requirementId: requirement.id,
    }, deps(space, async () => proposalResult(["Card payment succeeds"])));

    let seen: string[] = [];
    await proposeTestCasesForRequirement({
      projectId: space.project.id,
      requirementId: requirement.id,
    }, {
      ...deps(space),
      propose: async (input) => {
        seen = [...input.existingTestCaseTitles];
        return proposalResult(["Declined card is reported"]);
      },
    });

    expect(seen).toContain("Card payment succeeds");
  });

  it("surfaces a provider failure without creating anything", async () => {
    const space = await workspace();
    const requirement = await approvedRequirement(space);

    await expect(proposeTestCasesForRequirement({
      projectId: space.project.id,
      requirementId: requirement.id,
    }, deps(space, async () => {
      throw new Error("model_refusal");
    }))).rejects.toMatchObject({ code: "model_refusal", status: 502 });

    expect(await prisma.testCase.count({
      where: { organizationId: space.organization.id },
    })).toBe(0);
  });

  it("does not reach another organization's requirement", async () => {
    const space = await workspace();
    const other = await workspace();
    const requirement = await approvedRequirement(other);

    await expect(proposeTestCasesForRequirement({
      projectId: space.project.id,
      requirementId: requirement.id,
    }, deps(space))).rejects.toMatchObject({ code: "requirement_not_found" });
  });
});
