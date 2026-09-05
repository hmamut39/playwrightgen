import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient, ProjectMembershipRole } from "@/generated/prisma/client";
import { WorkspaceAuthorizationError } from "@/lib/auth/workspace-context";
import { deriveProjectRunnerToken } from "@/lib/integrations/runner/ingest-token";
import {
  getProjectRunnerSetup,
  rotateProjectRunnerToken,
} from "@/lib/services/runner-setup";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;
const SECRET = "runner-ingest-secret-for-integration-tests";

describe("project runner setup", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    await connectTestDatabase(prisma);
  });
  beforeEach(async () => cleanPhase1ATables(prisma));
  afterEach(() => vi.unstubAllEnvs());
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
        name: "Runner workspace",
        slug: unique("runner"),
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

  async function member(
    space: Awaited<ReturnType<typeof workspace>>,
    role: ProjectMembershipRole,
  ) {
    const user = await prisma.user.create({
      data: { clerkUserId: unique("member"), displayName: role },
    });
    await prisma.membership.create({
      data: { organizationId: space.organization.id, userId: user.id, role: "MEMBER" },
    });
    await prisma.projectMembership.create({
      data: {
        organizationId: space.organization.id,
        projectId: space.project.id,
        userId: user.id,
        role,
      },
    });
    return user;
  }

  const deps = (
    space: Awaited<ReturnType<typeof workspace>>,
    actor: { clerkUserId: string } = space.owner,
  ) => ({
    authenticate: async () => ({
      userId: actor.clerkUserId,
      orgId: space.organization.clerkOrganizationId,
    }),
    prisma,
  });

  it("issues a token that matches the server derivation for that exact project", async () => {
    vi.stubEnv("RUNNER_INGEST_SECRET", SECRET);
    const space = await workspace();

    const setup = await getProjectRunnerSetup(
      { projectId: space.project.id },
      deps(space),
    );

    expect(setup.configured).toBe(true);
    if (!setup.configured) return;
    expect(setup.organizationId).toBe(space.organization.id);
    expect(setup.projectId).toBe(space.project.id);
    expect(setup.token).toBe(
      deriveProjectRunnerToken({
        secret: SECRET,
        organizationId: space.organization.id,
        projectId: space.project.id,
      tokenVersion: 1,
    }),
    );
  });

  it("issues different tokens to different projects in one organization", async () => {
    vi.stubEnv("RUNNER_INGEST_SECRET", SECRET);
    const space = await workspace();
    const other = await prisma.project.create({
      data: {
        organizationId: space.organization.id,
        name: "Billing",
        slug: unique("billing"),
        createdByUserId: space.owner.id,
      },
    });

    const first = await getProjectRunnerSetup({ projectId: space.project.id }, deps(space));
    const second = await getProjectRunnerSetup({ projectId: other.id }, deps(space));

    expect(first.configured && second.configured).toBe(true);
    if (!first.configured || !second.configured) return;
    expect(first.token).not.toBe(second.token);
  });

  it("reports unconfigured instead of failing when the server secret is absent", async () => {
    vi.stubEnv("RUNNER_INGEST_SECRET", "");
    const space = await workspace();

    await expect(
      getProjectRunnerSetup({ projectId: space.project.id }, deps(space)),
    ).resolves.toEqual({ configured: false });
  });

  it("denies the token to members who cannot connect a repository", async () => {
    vi.stubEnv("RUNNER_INGEST_SECRET", SECRET);
    const space = await workspace();
    const viewer = await member(space, "VIEWER");

    await expect(
      getProjectRunnerSetup({ projectId: space.project.id }, deps(space, viewer)),
    ).rejects.toBeInstanceOf(WorkspaceAuthorizationError);
  });

  it("invalidates only the rotated project's token", async () => {
    vi.stubEnv("RUNNER_INGEST_SECRET", SECRET);
    const space = await workspace();
    const other = await prisma.project.create({
      data: {
        organizationId: space.organization.id,
        name: "Billing",
        slug: unique("billing"),
        createdByUserId: space.owner.id,
      },
    });

    const before = await getProjectRunnerSetup({ projectId: space.project.id }, deps(space));
    const otherBefore = await getProjectRunnerSetup({ projectId: other.id }, deps(space));

    const rotated = await rotateProjectRunnerToken({ projectId: space.project.id }, deps(space));
    const otherAfter = await getProjectRunnerSetup({ projectId: other.id }, deps(space));

    if (!before.configured || !rotated.configured) throw new Error("expected configured");
    if (!otherBefore.configured || !otherAfter.configured) throw new Error("expected configured");

    expect(rotated.token).not.toBe(before.token);
    expect(rotated.tokenVersion).toBe(before.tokenVersion + 1);
    // Revocation must be local. A sibling project keeping its token is the
    // whole point of moving the version out of the server secret.
    expect(otherAfter.token).toBe(otherBefore.token);
  });

  it("returns the same token on repeated reads until it is rotated", async () => {
    vi.stubEnv("RUNNER_INGEST_SECRET", SECRET);
    const space = await workspace();

    const first = await getProjectRunnerSetup({ projectId: space.project.id }, deps(space));
    const second = await getProjectRunnerSetup({ projectId: space.project.id }, deps(space));
    await rotateProjectRunnerToken({ projectId: space.project.id }, deps(space));
    const third = await getProjectRunnerSetup({ projectId: space.project.id }, deps(space));

    if (!first.configured || !second.configured || !third.configured) {
      throw new Error("expected configured");
    }
    expect(second.token).toBe(first.token);
    expect(third.token).not.toBe(first.token);
  });

  it("records a rotation as auditable Activity without storing the token", async () => {
    vi.stubEnv("RUNNER_INGEST_SECRET", SECRET);
    const space = await workspace();

    const rotated = await rotateProjectRunnerToken({ projectId: space.project.id }, deps(space));

    const activity = await prisma.activity.findFirst({
      where: { organizationId: space.organization.id, projectId: space.project.id },
      orderBy: { createdAt: "desc" },
    });
    expect(activity?.action).toBe("PROJECT_UPDATED");
    expect(activity?.actorUserId).toBe(space.owner.id);
    expect(activity?.metadata).toMatchObject({ change: "runner_token_rotated" });

    // A credential must never be written into an audit record.
    if (!rotated.configured) throw new Error("expected configured");
    expect(JSON.stringify(activity?.metadata)).not.toContain(rotated.token);
  });

  it("denies rotation to members who cannot connect a repository", async () => {
    vi.stubEnv("RUNNER_INGEST_SECRET", SECRET);
    const space = await workspace();
    const viewer = await member(space, "VIEWER");

    await expect(
      rotateProjectRunnerToken({ projectId: space.project.id }, deps(space, viewer)),
    ).rejects.toBeInstanceOf(WorkspaceAuthorizationError);
  });

  it("does not leak a token across tenants", async () => {
    vi.stubEnv("RUNNER_INGEST_SECRET", SECRET);
    const space = await workspace();
    const foreign = await workspace();

    await expect(
      getProjectRunnerSetup({ projectId: foreign.project.id }, deps(space)),
    ).rejects.toBeInstanceOf(WorkspaceAuthorizationError);
  });
});
