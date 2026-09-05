import { randomUUID } from "node:crypto";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import type {
  PrismaClient,
  ProjectMembershipRole,
} from "@/generated/prisma/client";
import {
  approveRequirement,
  archiveRequirement,
  createRequirement,
  getRequirementDetail,
  listRequirements,
  requestRequirementChanges,
  submitRequirementForReview,
  updateRequirementDraft,
} from "@/lib/services/requirements";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

function uniqueValue(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

describe("tenant-safe Requirement workflow", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    await connectTestDatabase(prisma);
  });

  beforeEach(async () => {
    await cleanPhase1ATables(prisma);
  });

  afterAll(async () => {
    if (prisma) {
      await cleanPhase1ATables(prisma);
      await disconnectTestDatabase(prisma);
    }
  });

  async function createWorkspace() {
    const owner = await prisma.user.create({
      data: {
        clerkUserId: uniqueValue("clerk-owner"),
        displayName: "Workspace owner",
      },
    });
    const organization = await prisma.organization.create({
      data: {
        clerkOrganizationId: uniqueValue("clerk-org"),
        name: "Requirements workspace",
        slug: uniqueValue("requirements-workspace"),
      },
    });
    await prisma.membership.create({
      data: {
        organizationId: organization.id,
        userId: owner.id,
        role: "OWNER",
      },
    });
    const project = await prisma.project.create({
      data: {
        organizationId: organization.id,
        name: "Release readiness",
        slug: uniqueValue("release-readiness"),
        createdByUserId: owner.id,
      },
    });
    return { organization, owner, project };
  }

  function dependencies(
    workspace: Awaited<ReturnType<typeof createWorkspace>>,
    actor = workspace.owner,
  ) {
    return {
      authenticate: async () => ({
        userId: actor.clerkUserId,
        orgId: workspace.organization.clerkOrganizationId,
      }),
      prisma,
    };
  }

  async function addProjectMember(
    workspace: Awaited<ReturnType<typeof createWorkspace>>,
    role: ProjectMembershipRole,
  ) {
    const user = await prisma.user.create({
      data: {
        clerkUserId: uniqueValue("clerk-member"),
        displayName: role,
      },
    });
    await prisma.membership.create({
      data: {
        organizationId: workspace.organization.id,
        userId: user.id,
        role: "MEMBER",
      },
    });
    await prisma.projectMembership.create({
      data: {
        organizationId: workspace.organization.id,
        projectId: workspace.project.id,
        userId: user.id,
        role,
      },
    });
    return user;
  }

  async function createCompleteRequirement(
    workspace: Awaited<ReturnType<typeof createWorkspace>>,
  ) {
    return createRequirement(
      {
        projectId: workspace.project.id,
        title: "Users can recover access",
        description: "A signed-out user can request an account recovery link.",
        acceptanceCriteria: "A valid account receives a single-use recovery link.",
        externalReference: "AUTH-42",
      },
      dependencies(workspace),
    );
  }

  it("creates version 1 and Activity atomically", async () => {
    const workspace = await createWorkspace();
    const requirement = await createCompleteRequirement(workspace);
    const [versions, activity] = await Promise.all([
      prisma.requirementVersion.findMany({
        where: { requirementId: requirement.id },
      }),
      prisma.activity.findFirst({
        where: {
          targetId: requirement.id,
          action: "REQUIREMENT_CREATED",
        },
      }),
    ]);

    expect(requirement.organizationId).toBe(workspace.organization.id);
    expect(requirement.projectId).toBe(workspace.project.id);
    expect(requirement.ownerUserId).toBe(workspace.owner.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      versionNumber: 1,
      title: requirement.title,
    });
    expect(activity).toMatchObject({
      organizationId: workspace.organization.id,
      projectId: workspace.project.id,
      actorUserId: workspace.owner.id,
    });
  });

  it("keeps old versions immutable when a draft changes", async () => {
    const workspace = await createWorkspace();
    const requirement = await createCompleteRequirement(workspace);
    const updated = await updateRequirementDraft(
      {
        projectId: workspace.project.id,
        requirementId: requirement.id,
        expectedVersion: 1,
        title: "Users can securely recover access",
      },
      dependencies(workspace),
    );
    const versions = await prisma.requirementVersion.findMany({
      where: { requirementId: requirement.id },
      orderBy: { versionNumber: "asc" },
    });

    expect(updated.currentVersionNumber).toBe(2);
    expect(versions.map((version) => version.title)).toEqual([
      "Users can recover access",
      "Users can securely recover access",
    ]);
  });

  it("rejects a stale draft update without writing a version", async () => {
    const workspace = await createWorkspace();
    const requirement = await createCompleteRequirement(workspace);
    await updateRequirementDraft(
      {
        projectId: workspace.project.id,
        requirementId: requirement.id,
        expectedVersion: 1,
        title: "First change",
      },
      dependencies(workspace),
    );

    await expect(
      updateRequirementDraft(
        {
          projectId: workspace.project.id,
          requirementId: requirement.id,
          expectedVersion: 1,
          title: "Stale change",
        },
        dependencies(workspace),
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "requirement_version_conflict",
    });
    expect(
      await prisma.requirementVersion.count({
        where: { requirementId: requirement.id },
      }),
    ).toBe(2);
  });

  it("requires description and acceptance criteria before review", async () => {
    const workspace = await createWorkspace();
    const requirement = await createRequirement(
      { projectId: workspace.project.id, title: "Incomplete draft" },
      dependencies(workspace),
    );

    await expect(
      submitRequirementForReview(
        { projectId: workspace.project.id, requirementId: requirement.id },
        dependencies(workspace),
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "requirement_review_incomplete",
    });
  });

  it("allows a Project Lead to draft and submit but not approve", async () => {
    const workspace = await createWorkspace();
    const lead = await addProjectMember(workspace, "PROJECT_LEAD");
    const requirement = await createRequirement(
      {
        projectId: workspace.project.id,
        title: "Lead-owned requirement",
        description: "Complete description",
        acceptanceCriteria: "A measurable outcome exists.",
      },
      dependencies(workspace, lead),
    );
    const submitted = await submitRequirementForReview(
      { projectId: workspace.project.id, requirementId: requirement.id },
      dependencies(workspace, lead),
    );

    expect(submitted.status).toBe("IN_REVIEW");
    await expect(
      approveRequirement(
        { projectId: workspace.project.id, requirementId: requirement.id },
        dependencies(workspace, lead),
      ),
    ).rejects.toMatchObject({ status: 403, code: "permission_denied" });

    const approved = await approveRequirement(
      { projectId: workspace.project.id, requirementId: requirement.id },
      dependencies(workspace),
    );
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedAt).not.toBeNull();
  });

  it("lets approvers request changes without changing content history", async () => {
    const workspace = await createWorkspace();
    const requirement = await createCompleteRequirement(workspace);
    await submitRequirementForReview(
      { projectId: workspace.project.id, requirementId: requirement.id },
      dependencies(workspace),
    );
    const draft = await requestRequirementChanges(
      { projectId: workspace.project.id, requirementId: requirement.id },
      dependencies(workspace),
    );

    expect(draft.status).toBe("DRAFT");
    expect(draft.currentVersionNumber).toBe(1);
    expect(
      await prisma.requirementVersion.count({
        where: { requirementId: requirement.id },
      }),
    ).toBe(1);
  });

  it("records only one approval when concurrent transitions race", async () => {
    const workspace = await createWorkspace();
    const requirement = await createCompleteRequirement(workspace);
    await submitRequirementForReview(
      { projectId: workspace.project.id, requirementId: requirement.id },
      dependencies(workspace),
    );

    const results = await Promise.allSettled([
      approveRequirement(
        { projectId: workspace.project.id, requirementId: requirement.id },
        dependencies(workspace),
      ),
      approveRequirement(
        { projectId: workspace.project.id, requirementId: requirement.id },
        dependencies(workspace),
      ),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      await prisma.activity.count({
        where: {
          targetId: requirement.id,
          action: "REQUIREMENT_APPROVED",
        },
      }),
    ).toBe(1);
  });

  it("does not let an ordinary assigned member create requirements", async () => {
    const workspace = await createWorkspace();
    const member = await addProjectMember(workspace, "MEMBER");

    expect(
      (await listRequirements(
        { projectId: workspace.project.id },
        dependencies(workspace, member),
      )).items,
    ).toEqual([]);
    await expect(
      createRequirement(
        { projectId: workspace.project.id, title: "Denied" },
        dependencies(workspace, member),
      ),
    ).rejects.toMatchObject({ status: 403, code: "permission_denied" });
  });

  it("never reads a requirement through a foreign tenant", async () => {
    const workspace = await createWorkspace();
    const foreign = await createWorkspace();
    const foreignRequirement = await createCompleteRequirement(foreign);

    await expect(
      getRequirementDetail(
        {
          projectId: workspace.project.id,
          requirementId: foreignRequirement.id,
        },
        dependencies(workspace),
      ),
    ).rejects.toMatchObject({
      status: 404,
      code: "requirement_not_found",
    });
  });

  it("preserves approved content and all versions when archived", async () => {
    const workspace = await createWorkspace();
    const requirement = await createCompleteRequirement(workspace);
    await submitRequirementForReview(
      { projectId: workspace.project.id, requirementId: requirement.id },
      dependencies(workspace),
    );
    await approveRequirement(
      { projectId: workspace.project.id, requirementId: requirement.id },
      dependencies(workspace),
    );

    await expect(
      updateRequirementDraft(
        {
          projectId: workspace.project.id,
          requirementId: requirement.id,
          expectedVersion: 1,
          title: "Overwrite approved content",
        },
        dependencies(workspace),
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "requirement_not_editable",
    });

    const archived = await archiveRequirement(
      { projectId: workspace.project.id, requirementId: requirement.id },
      dependencies(workspace),
    );
    expect(archived.status).toBe("ARCHIVED");
    expect(archived.archivedAt).not.toBeNull();
    expect(
      await prisma.requirementVersion.count({
        where: { requirementId: requirement.id },
      }),
    ).toBe(1);
  });
});
