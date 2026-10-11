import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { notePullRequest } from "@/lib/services/ci-pull-request-note";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;
const numericId = () => String(Math.floor(Math.random() * 1_000_000_000) + 1);

/**
 * Which requirements a push touched, read from the real records.
 *
 * The wording is tested elsewhere. What matters here is that the note names
 * only requirements linked to Test Cases this delivery actually recorded, and
 * that it never reaches a repository the project has not connected -- the same
 * line every other GitHub path in this product holds.
 */
describe("noting a delivery on its pull request", () => {
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

  async function workspace(options: { connect?: boolean } = { connect: true }) {
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
    if (options.connect) {
      const installation = await prisma.gitHubInstallation.create({
        data: {
          organizationId: organization.id,
          externalInstallationId: numericId(),
          accountId: "1",
          accountLogin: "acme",
          accountType: "User",
          repositorySelection: "selected",
          connectedByUserId: owner.id,
        },
      });
      await prisma.repositoryConnection.create({
        data: {
          organizationId: organization.id,
          projectId: project.id,
          githubInstallationId: installation.id,
          externalRepositoryId: numericId(),
          ownerLogin: "acme",
          name: "web",
          fullName: "acme/web",
          defaultBranch: "main",
          visibility: "PRIVATE",
          status: "ACTIVE",
          createdByUserId: owner.id,
        },
      });
    }
    return { owner, organization, project };
  }

  /** A requirement, an approved Test Case verifying it, and their link. */
  async function requirementWithTest(
    space: Awaited<ReturnType<typeof workspace>>,
    requirementTitle: string,
    testTitle: string,
  ) {
    const requirement = await prisma.requirement.create({
      data: {
        organizationId: space.organization.id,
        projectId: space.project.id,
        title: requirementTitle,
        description: "Something the product must do.",
        acceptanceCriteria: "It does it.",
        status: "APPROVED",
        ownerUserId: space.owner.id,
        createdByUserId: space.owner.id,
        currentVersionNumber: 1,
      },
    });
    const testCase = await prisma.testCase.create({
      data: {
        organizationId: space.organization.id,
        projectId: space.project.id,
        title: testTitle,
        objective: "Checks it.",
        preconditions: "",
        steps: ["Do it"],
        expectedResults: ["It worked"],
        status: "APPROVED",
        ownerUserId: space.owner.id,
        createdByUserId: space.owner.id,
        currentVersionNumber: 1,
      },
    });
    await prisma.requirementTestCase.create({
      data: {
        organizationId: space.organization.id,
        projectId: space.project.id,
        requirementId: requirement.id,
        testCaseId: testCase.id,
        createdByUserId: space.owner.id,
      },
    });
    return { requirement, testCase };
  }

  const delivery = (
    space: Awaited<ReturnType<typeof workspace>>,
    recordedTestCaseIds: string[],
  ) => ({
    organizationId: space.organization.id,
    projectId: space.project.id,
    ref: "feature/saved-card",
    commitSha: "a".repeat(40),
    provider: "github_actions",
    counts: { recorded: 1, duplicates: 0, unmatched: 0, unknownVersion: 0, total: 1 },
    recordedTestCaseIds,
  });

  it("names only the requirements this delivery's tests verify", async () => {
    const space = await workspace();
    const touched = await requirementWithTest(space, "A customer can pay", "Pay with a card");
    await requirementWithTest(space, "A customer can search", "Search the catalogue");

    const leaveNote = vi.fn().mockResolvedValue({ pullNumbers: [7], updated: false });
    const result = await notePullRequest(delivery(space, [touched.testCase.id]), {
      prisma,
      leaveNote,
    });

    expect(result.posted).toEqual([7]);
    const body = leaveNote.mock.calls[0][0].body as string;
    expect(body).toContain("A customer can pay");
    // The other requirement exists and was not touched by this push, so naming
    // it would make the note longer and less true.
    expect(body).not.toContain("A customer can search");
    expect(leaveNote.mock.calls[0][0]).toMatchObject({
      ownerLogin: "acme",
      repositoryName: "web",
      branch: "feature/saved-card",
    });
  }, 60_000);

  it("says nothing when the project has no connected repository", async () => {
    const space = await workspace({ connect: false });
    const touched = await requirementWithTest(space, "A customer can pay", "Pay with a card");

    const leaveNote = vi.fn();
    const result = await notePullRequest(delivery(space, [touched.testCase.id]), {
      prisma,
      leaveNote,
    });

    expect(result.posted).toEqual([]);
    expect(result.skipped).toBe("no active connection");
    expect(leaveNote).not.toHaveBeenCalled();
  }, 60_000);

  it("does nothing when the delivery recorded nothing", async () => {
    const space = await workspace();
    const leaveNote = vi.fn();

    const result = await notePullRequest(delivery(space, []), { prisma, leaveNote });

    expect(result.skipped).toBe("nothing recorded");
    expect(leaveNote).not.toHaveBeenCalled();
  }, 60_000);

  it("reports a refused comment without pretending the ingest failed", async () => {
    const space = await workspace();
    const touched = await requirementWithTest(space, "A customer can pay", "Pay with a card");
    const leaveNote = vi.fn().mockRejectedValue(new Error("github_pull_request_permission_missing"));

    // The evidence is already recorded by the time this runs. A repository
    // that has not granted comment access is an ordinary outcome, not a
    // failure of the delivery that triggered it.
    const result = await notePullRequest(delivery(space, [touched.testCase.id]), {
      prisma,
      leaveNote,
    });

    expect(result.posted).toEqual([]);
    expect(result.skipped).toContain("permission_missing");
  }, 60_000);
});
