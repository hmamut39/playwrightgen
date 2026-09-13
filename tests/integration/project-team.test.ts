import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient, ProjectMembershipRole } from "@/generated/prisma/client";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { provisionMembershipFromClerk } from "@/lib/auth/workspace-provisioning";
import { dispatchClerkWebhook } from "@/lib/services/clerk-sync";
import { readInvitedProjectRoles } from "@/lib/services/invited-project-roles";
import {
  getProjectTeam,
  inviteToProject,
  type InvitationGateway,
} from "@/lib/services/project-team";
import { clerkMembershipData } from "@/tests/helpers/clerk";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;

describe("project team and invitations", () => {
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
      data: { clerkUserId: unique("owner"), displayName: "Owner", primaryEmail: "owner@example.test" },
    });
    const organization = await prisma.organization.create({
      data: { clerkOrganizationId: unique("org"), name: "Team", slug: unique("team") },
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

  async function addMember(
    workspace: Awaited<ReturnType<typeof createWorkspace>>,
    projectRole: ProjectMembershipRole | null,
    email = `${unique("person")}@example.test`,
  ) {
    const user = await prisma.user.create({
      data: { clerkUserId: unique("member"), displayName: projectRole ?? "Unassigned", primaryEmail: email },
    });
    await prisma.membership.create({
      data: { organizationId: workspace.organization.id, userId: user.id, role: "MEMBER" },
    });
    if (projectRole) {
      await prisma.projectMembership.create({
        data: {
          organizationId: workspace.organization.id,
          projectId: workspace.project.id,
          userId: user.id,
          role: projectRole,
        },
      });
    }
    return user;
  }

  function fakeInvitations() {
    const sent: Array<Parameters<InvitationGateway["create"]>[0]> = [];
    const gateway: InvitationGateway = {
      async create(input) {
        sent.push(input);
      },
      async listPending() {
        return sent.map((invitation, index) => ({
          id: `inv_${index}`,
          emailAddress: invitation.emailAddress,
          createdAt: new Date(1_800_000_000_000),
          publicMetadata: invitation.publicMetadata,
        }));
      },
      async revoke() {},
    };
    return { sent, gateway };
  }

  function as(
    workspace: Awaited<ReturnType<typeof createWorkspace>>,
    actor: { clerkUserId: string },
    invitations?: InvitationGateway,
  ) {
    return {
      authenticate: async () => ({
        userId: actor.clerkUserId,
        orgId: workspace.organization.clerkOrganizationId,
      }),
      prisma,
      invitations,
    };
  }

  describe("accepting an invitation", () => {
    async function webhookWorkspace() {
      const ownerClerkId = unique("owner");
      const clerkOrganizationId = unique("org");
      const organization = { id: clerkOrganizationId, slug: unique("slug"), creatorUserId: ownerClerkId };
      await dispatchClerkWebhook({
        type: "organizationMembership.created",
        data: clerkMembershipData({ id: unique("mem"), userId: ownerClerkId, organization }),
        eventId: unique("event"),
        prisma,
      });
      const org = await prisma.organization.findUniqueOrThrow({ where: { clerkOrganizationId } });
      const owner = await prisma.user.findUniqueOrThrow({ where: { clerkUserId: ownerClerkId } });
      const project = await prisma.project.create({
        data: { organizationId: org.id, name: "Checkout", slug: unique("p"), createdByUserId: owner.id },
      });
      return { organization, org, project };
    }

    function invitedMembership(
      organization: { id: string; slug: string; creatorUserId: string },
      userId: string,
      metadata: unknown,
      id = unique("mem"),
    ) {
      return { ...clerkMembershipData({ id, userId, organization }), public_metadata: metadata };
    }

    it("puts the new member into the project with the role they were invited to", async () => {
      const { organization, org, project } = await webhookWorkspace();
      const foreign = await createWorkspace();
      const inviteeClerkId = unique("invitee");

      const result = await dispatchClerkWebhook({
        type: "organizationMembership.created",
        data: invitedMembership(organization, inviteeClerkId, {
          playwrightgenProjectRoles: {
            [project.id]: "PROJECT_LEAD",
            // A project in another organization is ignored, not honoured.
            [foreign.project.id]: "PROJECT_LEAD",
          },
        }),
        eventId: unique("event"),
        prisma,
      });

      expect(result.status).toBe("applied");
      const invitee = await prisma.user.findUniqueOrThrow({ where: { clerkUserId: inviteeClerkId } });
      const memberships = await prisma.projectMembership.findMany({ where: { userId: invitee.id } });
      expect(memberships).toHaveLength(1);
      expect(memberships[0]).toMatchObject({
        organizationId: org.id,
        projectId: project.id,
        role: "PROJECT_LEAD",
        status: "ACTIVE",
      });
      expect(
        await prisma.activity.count({
          where: { action: "PROJECT_MEMBER_ASSIGNED", targetId: memberships[0].id },
        }),
      ).toBe(1);
    });

    it("never overrides a later decision when the event is delivered again", async () => {
      const { organization, project } = await webhookWorkspace();
      const inviteeClerkId = unique("invitee");
      const membershipId = unique("mem");
      const data = invitedMembership(
        organization,
        inviteeClerkId,
        { playwrightgenProjectRoles: { [project.id]: "MEMBER" } },
        membershipId,
      );
      await dispatchClerkWebhook({
        type: "organizationMembership.created",
        data,
        eventId: unique("event"),
        prisma,
      });
      const invitee = await prisma.user.findUniqueOrThrow({ where: { clerkUserId: inviteeClerkId } });
      // An admin takes them off the project afterwards.
      await prisma.projectMembership.updateMany({
        where: { userId: invitee.id },
        data: { status: "REMOVED", removedAt: new Date() },
      });

      await dispatchClerkWebhook({
        type: "organizationMembership.created",
        data: { ...data, updated_at: data.updated_at + 1000 },
        eventId: unique("event"),
        prisma,
      });

      const rows = await prisma.projectMembership.findMany({ where: { userId: invitee.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("REMOVED");
    });

    it("treats malformed metadata as no project roles", () => {
      expect(readInvitedProjectRoles(null)).toEqual([]);
      expect(readInvitedProjectRoles({ playwrightgenProjectRoles: "lead" })).toEqual([]);
      expect(
        readInvitedProjectRoles({ playwrightgenProjectRoles: { "not-a-uuid": "MEMBER" } }),
      ).toEqual([]);
      expect(
        readInvitedProjectRoles({ playwrightgenProjectRoles: { [randomUUID()]: "OWNER" } }),
      ).toEqual([]);
    });
  });

  describe("the team page", () => {
    it("shows managers everyone with emails and pending invitations", async () => {
      const workspace = await createWorkspace();
      await addMember(workspace, "PROJECT_LEAD");
      await addMember(workspace, "MEMBER");
      await addMember(workspace, null);
      const { gateway } = fakeInvitations();
      await inviteToProject(
        { projectId: workspace.project.id, email: "New.Person@Example.test", role: "VIEWER" },
        as(workspace, workspace.owner, gateway),
      );

      const team = await getProjectTeam(
        { projectId: workspace.project.id },
        as(workspace, workspace.owner, gateway),
      );

      expect(team.canManage).toBe(true);
      expect(team.members.map((member) => member.projectRole ?? member.organizationRole)).toEqual([
        "OWNER",
        "PROJECT_LEAD",
        "MEMBER",
        "MEMBER",
      ]);
      expect(team.members.at(-1)?.projectRole).toBeNull();
      expect(team.members[0].email).toBe("owner@example.test");
      expect(team.pendingInvitations).toEqual([
        expect.objectContaining({ emailAddress: "new.person@example.test", projectRole: "VIEWER" }),
      ]);
    });

    it("shows other people the team without email addresses", async () => {
      const workspace = await createWorkspace();
      const member = await addMember(workspace, "MEMBER");

      const team = await getProjectTeam({ projectId: workspace.project.id }, as(workspace, member));

      expect(team.canManage).toBe(false);
      expect(team.members.every((person) => person.email === null)).toBe(true);
      expect(team.pendingInvitations).toEqual([]);
    });
  });

  describe("inviting", () => {
    it("sends the project role along with the invitation", async () => {
      const workspace = await createWorkspace();
      const { sent, gateway } = fakeInvitations();

      await inviteToProject(
        { projectId: workspace.project.id, email: " qa.lead@example.test ", role: "PROJECT_LEAD" },
        as(workspace, workspace.owner, gateway),
      );

      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        clerkOrganizationId: workspace.organization.clerkOrganizationId,
        inviterClerkUserId: workspace.owner.clerkUserId,
        emailAddress: "qa.lead@example.test",
      });
      expect(readInvitedProjectRoles(sent[0].publicMetadata)).toEqual([
        { projectId: workspace.project.id, role: "PROJECT_LEAD" },
      ]);
    });

    it("refuses people already in the workspace, bad input, and non-managers", async () => {
      const workspace = await createWorkspace();
      const lead = await addMember(workspace, "PROJECT_LEAD", "lead@example.test");
      const { sent, gateway } = fakeInvitations();

      await expect(
        inviteToProject(
          { projectId: workspace.project.id, email: "LEAD@example.test", role: "MEMBER" },
          as(workspace, workspace.owner, gateway),
        ),
      ).rejects.toMatchObject({ code: "already_a_member" });
      await expect(
        inviteToProject(
          { projectId: workspace.project.id, email: "not an email", role: "MEMBER" },
          as(workspace, workspace.owner, gateway),
        ),
      ).rejects.toMatchObject({ code: "invalid_email" });
      await expect(
        inviteToProject(
          { projectId: workspace.project.id, email: "someone@example.test", role: "OWNER" },
          as(workspace, workspace.owner, gateway),
        ),
      ).rejects.toMatchObject({ code: "invalid_role" });
      await expect(
        inviteToProject(
          { projectId: workspace.project.id, email: "someone@example.test", role: "MEMBER" },
          as(workspace, lead, gateway),
        ),
      ).rejects.toMatchObject({ code: "permission_denied" });
      expect(sent).toHaveLength(0);
    });
  });

  describe("joining before the webhook lands", () => {
    // The minutes that matter most for a team: someone accepts an invitation
    // and is sent straight into the workspace. The organization exists; their
    // membership row does not yet.
    async function orgWithProject() {
      const ownerClerkId = unique("owner");
      const organization = { id: unique("org"), slug: unique("slug"), creatorUserId: ownerClerkId };
      await dispatchClerkWebhook({
        type: "organizationMembership.created",
        data: clerkMembershipData({ id: unique("mem"), userId: ownerClerkId, organization }),
        eventId: unique("event"),
        prisma,
      });
      const org = await prisma.organization.findUniqueOrThrow({
        where: { clerkOrganizationId: organization.id },
      });
      const owner = await prisma.user.findUniqueOrThrow({ where: { clerkUserId: ownerClerkId } });
      const project = await prisma.project.create({
        data: { organizationId: org.id, name: "Checkout", slug: unique("p"), createdByUserId: owner.id },
      });
      return { organization, org, project };
    }

    it("lets an invited person in on their first request, with their project role", async () => {
      const { organization, org, project } = await orgWithProject();
      const inviteeClerkId = unique("invitee");
      let asked = 0;

      const context = await requireWorkspaceContext(
        { projectId: project.id, permission: "testcase:create" },
        {
          authenticate: async () => ({ userId: inviteeClerkId, orgId: organization.id }),
          prisma,
          provisionMembership: (input) =>
            provisionMembershipFromClerk({
              ...input,
              fetchMembership: async () => {
                asked += 1;
                return {
                  ...clerkMembershipData({ id: unique("mem"), userId: inviteeClerkId, organization }),
                  public_metadata: { playwrightgenProjectRoles: { [project.id]: "MEMBER" } },
                };
              },
            }),
        },
      );

      expect(asked).toBe(1);
      expect(context.organization.id).toBe(org.id);
      expect(context.projectRole).toBe("MEMBER");
      expect(context.can("testcase:create")).toBe(true);
    });

    it("does not bring back a membership that was removed", async () => {
      const { organization, project } = await orgWithProject();
      const formerClerkId = unique("former");
      const membershipId = unique("mem");
      const data = clerkMembershipData({ id: membershipId, userId: formerClerkId, organization });
      await dispatchClerkWebhook({
        type: "organizationMembership.created", data, eventId: unique("event"), prisma,
      });
      await prisma.membership.updateMany({
        where: { clerkMembershipId: membershipId },
        data: { status: "REMOVED", removedAt: new Date() },
      });
      let asked = 0;

      await expect(requireWorkspaceContext(
        { projectId: project.id, permission: "project:read" },
        {
          authenticate: async () => ({ userId: formerClerkId, orgId: organization.id }),
          prisma,
          provisionMembership: async () => {
            asked += 1;
            return true;
          },
        },
      )).rejects.toMatchObject({ status: 403 });
      expect(asked).toBe(0);
    });

    it("refuses someone Clerk does not list as a member", async () => {
      const { organization, project } = await orgWithProject();
      const strangerClerkId = unique("stranger");
      await expect(requireWorkspaceContext(
        { projectId: project.id, permission: "project:read" },
        {
          authenticate: async () => ({ userId: strangerClerkId, orgId: organization.id }),
          prisma,
          provisionMembership: (input) =>
            provisionMembershipFromClerk({ ...input, fetchMembership: async () => null }),
        },
      )).rejects.toMatchObject({ status: 403 });
    });
  });
});
