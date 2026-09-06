import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient, ProjectMembershipRole } from "@/generated/prisma/client";
import {
  approveTestCase,
  archiveTestCase,
  createTestCase,
  getTestCaseDetail,
  linkRequirementToTestCase,
  requestTestCaseChanges,
  submitTestCaseForReview,
  unlinkRequirementFromTestCase,
  updateTestCaseDraft,
} from "@/lib/services/test-cases";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;

describe("tenant-safe Test Case workflow", () => {
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

  async function createWorkspace() {
    const owner = await prisma.user.create({ data: {
      clerkUserId: unique("owner"), displayName: "Owner",
    } });
    const organization = await prisma.organization.create({ data: {
      clerkOrganizationId: unique("org"), name: "QA workspace", slug: unique("qa"),
    } });
    await prisma.membership.create({ data: {
      organizationId: organization.id, userId: owner.id, role: "OWNER",
    } });
    const project = await prisma.project.create({ data: {
      organizationId: organization.id, name: "Checkout", slug: unique("checkout"),
      createdByUserId: owner.id,
    } });
    return { owner, organization, project };
  }

  const dependencies = (
    workspace: Awaited<ReturnType<typeof createWorkspace>>,
    actor = workspace.owner,
  ) => ({
    authenticate: async () => ({
      userId: actor.clerkUserId,
      orgId: workspace.organization.clerkOrganizationId,
    }),
    prisma,
  });

  async function addMember(
    workspace: Awaited<ReturnType<typeof createWorkspace>>,
    role: ProjectMembershipRole,
  ) {
    const user = await prisma.user.create({ data: {
      clerkUserId: unique("member"), displayName: role,
    } });
    await prisma.membership.create({ data: {
      organizationId: workspace.organization.id, userId: user.id, role: "MEMBER",
    } });
    await prisma.projectMembership.create({ data: {
      organizationId: workspace.organization.id, projectId: workspace.project.id,
      userId: user.id, role,
    } });
    return user;
  }

  async function createCompleteTestCase(
    workspace: Awaited<ReturnType<typeof createWorkspace>>,
    actor = workspace.owner,
  ) {
    return createTestCase({
      projectId: workspace.project.id,
      title: "Customer completes checkout",
      objective: "Verify a signed-in customer can place an order.",
      preconditions: "A product is in stock.",
      steps: ["Open the cart", "Submit valid payment"],
      expectedResults: ["Order confirmation is displayed"],
      priority: "HIGH",
      type: "END_TO_END",
      tags: ["Checkout", "smoke"],
    }, dependencies(workspace, actor));
  }

  it("creates an immutable initial version and Activity", async () => {
    const workspace = await createWorkspace();
    const testCase = await createCompleteTestCase(workspace);
    const [versions, activity] = await Promise.all([
      prisma.testCaseVersion.findMany({ where: { testCaseId: testCase.id } }),
      prisma.activity.findFirst({ where: { targetId: testCase.id, action: "TEST_CASE_CREATED" } }),
    ]);
    expect(testCase).toMatchObject({ currentVersionNumber: 1, priority: "HIGH", tags: ["checkout", "smoke"] });
    expect(versions).toHaveLength(1);
    expect(activity?.organizationId).toBe(workspace.organization.id);
  });

  it("keeps prior snapshots immutable and rejects stale updates", async () => {
    const workspace = await createWorkspace();
    const testCase = await createCompleteTestCase(workspace);
    await updateTestCaseDraft({
      projectId: workspace.project.id, testCaseId: testCase.id, expectedVersion: 1,
      title: "Customer completes secure checkout",
    }, dependencies(workspace));
    await expect(updateTestCaseDraft({
      projectId: workspace.project.id, testCaseId: testCase.id, expectedVersion: 1,
      title: "Stale title",
    }, dependencies(workspace))).rejects.toMatchObject({ code: "test_case_version_conflict" });
    const versions = await prisma.testCaseVersion.findMany({
      where: { testCaseId: testCase.id }, orderBy: { versionNumber: "asc" },
    });
    expect(versions.map((version) => version.title)).toEqual([
      "Customer completes checkout", "Customer completes secure checkout",
    ]);
  });

  it("requires complete test intent before review", async () => {
    const workspace = await createWorkspace();
    const testCase = await createTestCase({
      projectId: workspace.project.id, title: "Incomplete case",
    }, dependencies(workspace));
    await expect(submitTestCaseForReview({
      projectId: workspace.project.id, testCaseId: testCase.id,
    }, dependencies(workspace))).rejects.toMatchObject({ code: "test_case_review_incomplete" });
  });

  it("lets a Project Lead author and submit but not approve", async () => {
    const workspace = await createWorkspace();
    const lead = await addMember(workspace, "PROJECT_LEAD");
    const testCase = await createCompleteTestCase(workspace, lead);
    await submitTestCaseForReview({
      projectId: workspace.project.id, testCaseId: testCase.id,
    }, dependencies(workspace, lead));
    await expect(approveTestCase({
      projectId: workspace.project.id, testCaseId: testCase.id,
    }, dependencies(workspace, lead))).rejects.toMatchObject({ code: "permission_denied" });
    await approveTestCase({
      projectId: workspace.project.id, testCaseId: testCase.id,
    }, dependencies(workspace));
    const detail = await getTestCaseDetail({
      projectId: workspace.project.id, testCaseId: testCase.id,
    }, dependencies(workspace));
    expect(detail.testCase.status).toBe("APPROVED");
  });

  it("allows change requests and preserves version history on archive", async () => {
    const workspace = await createWorkspace();
    const testCase = await createCompleteTestCase(workspace);
    await submitTestCaseForReview({ projectId: workspace.project.id, testCaseId: testCase.id }, dependencies(workspace));
    await requestTestCaseChanges({ projectId: workspace.project.id, testCaseId: testCase.id }, dependencies(workspace));
    await archiveTestCase({ projectId: workspace.project.id, testCaseId: testCase.id }, dependencies(workspace));
    expect(await prisma.testCaseVersion.count({ where: { testCaseId: testCase.id } })).toBe(1);
  });

  it("reopens approved intent for revision and keeps earlier versions intact", async () => {
    // Approved intent used to be frozen for good, so a team whose behaviour
    // changed had to abandon the Test Case and start a new one, breaking the
    // traceability chain. Reopening appends a version rather than rewriting
    // one, so the evidence recorded against version 1 stays exactly as it was.
    const workspace = await createWorkspace();
    const testCase = await createCompleteTestCase(workspace);
    await submitTestCaseForReview({
      projectId: workspace.project.id, testCaseId: testCase.id,
    }, dependencies(workspace));
    const approved = await approveTestCase({
      projectId: workspace.project.id, testCaseId: testCase.id,
    }, dependencies(workspace));
    expect(approved).toMatchObject({ status: "APPROVED", currentVersionNumber: 1 });

    const reopened = await requestTestCaseChanges({
      projectId: workspace.project.id, testCaseId: testCase.id,
    }, dependencies(workspace));
    expect(reopened).toMatchObject({ status: "DRAFT", currentVersionNumber: 1 });

    const revised = await updateTestCaseDraft({
      projectId: workspace.project.id,
      testCaseId: testCase.id,
      expectedVersion: 1,
      expectedResults: ["Order confirmation is displayed", "A receipt is emailed"],
    }, dependencies(workspace));
    expect(revised.currentVersionNumber).toBe(2);

    await submitTestCaseForReview({
      projectId: workspace.project.id, testCaseId: testCase.id,
    }, dependencies(workspace));
    const reapproved = await approveTestCase({
      projectId: workspace.project.id, testCaseId: testCase.id,
    }, dependencies(workspace));
    expect(reapproved).toMatchObject({ status: "APPROVED", currentVersionNumber: 2 });

    // Version 1 is untouched: it still records what was approved at the time.
    const versions = await prisma.testCaseVersion.findMany({
      where: { testCaseId: testCase.id }, orderBy: { versionNumber: "asc" },
    });
    expect(versions).toHaveLength(2);
    expect(versions[0].versionNumber).toBe(1);
    expect(versions[0].expectedResults).toEqual(["Order confirmation is displayed"]);
    expect(versions[1].expectedResults).toEqual([
      "Order confirmation is displayed",
      "A receipt is emailed",
    ]);
  });

  it("still refuses to edit a Test Case that is awaiting review", async () => {
    // Reopening is a deliberate act by someone who can approve. It must not
    // become a way to edit intent that is currently in front of a reviewer.
    const workspace = await createWorkspace();
    const testCase = await createCompleteTestCase(workspace);
    await submitTestCaseForReview({
      projectId: workspace.project.id, testCaseId: testCase.id,
    }, dependencies(workspace));

    await expect(updateTestCaseDraft({
      projectId: workspace.project.id,
      testCaseId: testCase.id,
      expectedVersion: 1,
      objective: "Changed while under review.",
    }, dependencies(workspace))).rejects.toMatchObject({ code: "test_case_not_editable" });
  });

  it("links and unlinks a same-project Requirement without duplicate activity", async () => {
    const workspace = await createWorkspace();
    const testCase = await createCompleteTestCase(workspace);
    const requirement = await prisma.requirement.create({ data: {
      organizationId: workspace.organization.id, projectId: workspace.project.id,
      title: "Checkout requirement", description: "", acceptanceCriteria: "",
      ownerUserId: workspace.owner.id, createdByUserId: workspace.owner.id,
    } });
    const input = { projectId: workspace.project.id, testCaseId: testCase.id, requirementId: requirement.id };
    await linkRequirementToTestCase(input, dependencies(workspace));
    await linkRequirementToTestCase(input, dependencies(workspace));
    expect(await prisma.requirementTestCase.count()).toBe(1);
    expect(await prisma.activity.count({ where: { action: "TEST_CASE_REQUIREMENT_LINKED" } })).toBe(1);
    expect(await unlinkRequirementFromTestCase(input, dependencies(workspace))).toBe(true);
    expect(await unlinkRequirementFromTestCase(input, dependencies(workspace))).toBe(false);
  });

  it("does not expose or link records across tenants", async () => {
    const first = await createWorkspace();
    const second = await createWorkspace();
    const testCase = await createCompleteTestCase(first);
    const requirement = await prisma.requirement.create({ data: {
      organizationId: second.organization.id, projectId: second.project.id,
      title: "Other tenant", description: "", acceptanceCriteria: "",
      ownerUserId: second.owner.id, createdByUserId: second.owner.id,
    } });
    await expect(getTestCaseDetail({
      projectId: second.project.id, testCaseId: testCase.id,
    }, dependencies(second))).rejects.toMatchObject({ code: "test_case_not_found" });
    await expect(linkRequirementToTestCase({
      projectId: first.project.id, testCaseId: testCase.id, requirementId: requirement.id,
    }, dependencies(first))).rejects.toMatchObject({ code: "requirement_not_found" });
  });
});
