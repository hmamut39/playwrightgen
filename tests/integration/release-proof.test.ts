import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { badgeTokenFor, readBadgeState } from "@/lib/services/evidence-badge";
import {
  createProofLink,
  listProofLinks,
  resolveProofLink,
  revokeProofLink,
} from "@/lib/services/release-proof";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;
const tokenOf = (url: string) => url.split("/proof/")[1];

describe("stopping a shared proof link", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    process.env.RUNNER_INGEST_SECRET ??= "proof-link-integration-secret-long-enough";
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
      data: { clerkOrganizationId: unique("org"), name: "Proof", slug: unique("proof") },
    });
    await prisma.membership.create({ data: { organizationId: organization.id, userId: owner.id, role: "OWNER" } });
    const project = await prisma.project.create({
      data: { organizationId: organization.id, name: "Shop", slug: unique("shop"), createdByUserId: owner.id },
    });
    const member = await prisma.user.create({ data: { clerkUserId: unique("member"), displayName: "Member" } });
    await prisma.membership.create({ data: { organizationId: organization.id, userId: member.id, role: "MEMBER" } });
    await prisma.projectMembership.create({
      data: { organizationId: organization.id, projectId: project.id, userId: member.id, role: "MEMBER" },
    });
    const as = (user: { clerkUserId: string }) => ({
      authenticate: async () => ({ userId: user.clerkUserId, orgId: organization.clerkOrganizationId }),
      prisma,
    });
    return { organization, project, owner, owned: as(owner), membered: as(member) };
  }

  it("opens until it is stopped, and never again after", async () => {
    const area = await space();
    const link = await createProofLink({ projectId: area.project.id }, area.owned);
    const token = tokenOf(link.url);

    expect(await resolveProofLink(token, { prisma })).toMatchObject({ projectId: area.project.id });
    // Reading it is recorded, so a team can see whether anyone opened it.
    const listed = await listProofLinks({ projectId: area.project.id }, area.owned);
    expect(listed).toHaveLength(1);
    expect(listed[0].lastViewedAt).not.toBeNull();
    expect(listed[0].createdBy.displayName).toBe("Lead");

    await revokeProofLink({ projectId: area.project.id, proofLinkId: listed[0].id }, area.owned);
    expect(await resolveProofLink(token, { prisma })).toBeNull();
    expect(await listProofLinks({ projectId: area.project.id }, area.owned)).toEqual([]);
  });

  it("a snapshot holds what was true when it was shared; a live link follows the project", async () => {
    const area = await space();
    const requirement = await prisma.requirement.create({
      data: {
        organizationId: area.organization.id,
        projectId: area.project.id,
        title: "Checkout works",
        description: "A customer can pay.",
        acceptanceCriteria: "An order is created.",
        status: "APPROVED",
        ownerUserId: area.owner.id,
        createdByUserId: area.owner.id,
        currentVersionNumber: 1,
      },
    });

    const frozen = await createProofLink({ projectId: area.project.id, freeze: true }, area.owned);
    const live = await createProofLink({ projectId: area.project.id }, area.owned);
    expect(frozen.frozen).toBe(true);
    expect(live.frozen).toBe(false);

    // The project changes after both links were shared.
    await prisma.requirement.update({ where: { id: requirement.id }, data: { title: "Checkout works with a saved card" } });

    const fromSnapshot = await resolveProofLink(tokenOf(frozen.url), { prisma });
    expect(fromSnapshot?.snapshot?.requirements[0].title).toBe("Checkout works");
    expect(fromSnapshot?.snapshot?.generatedAt).toBeInstanceOf(Date);
    // The live link keeps nothing, so the page reads the project instead.
    expect((await resolveProofLink(tokenOf(live.url), { prisma }))?.snapshot).toBeNull();
  });

  it("a badge reads through the same record, and stops when the link stops", async () => {
    const area = await space();
    await prisma.requirement.create({
      data: {
        organizationId: area.organization.id,
        projectId: area.project.id,
        title: "Checkout works",
        description: "A customer can pay.",
        acceptanceCriteria: "An order is created.",
        status: "APPROVED",
        ownerUserId: area.owner.id,
        createdByUserId: area.owner.id,
        currentVersionNumber: 1,
      },
    });

    const link = await createProofLink({ projectId: area.project.id }, area.owned);
    const badge = badgeTokenFor(tokenOf(link.url))!;
    // Nothing verifies the requirement yet, so the badge says so rather than
    // implying the project is fine.
    expect(await readBadgeState(badge, { prisma })).toEqual({ kind: "unverified" });

    // Reading a badge is not a visit: caches fetch it on their own schedule.
    const [row] = await prisma.proofLink.findMany({ where: { projectId: area.project.id } });
    expect(row.lastViewedAt).toBeNull();

    await revokeProofLink({ projectId: area.project.id, proofLinkId: row.id }, area.owned);
    expect(await readBadgeState(badge, { prisma })).toEqual({ kind: "unavailable" });
  });

  it("keeps only the hash, so the record cannot reopen the link", async () => {
    const area = await space();
    const link = await createProofLink({ projectId: area.project.id }, area.owned);
    const [row] = await prisma.proofLink.findMany({ where: { projectId: area.project.id } });
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(tokenOf(link.url));
  });

  it("is a lead's decision to share and to stop", async () => {
    const area = await space();
    await expect(createProofLink({ projectId: area.project.id }, area.membered)).rejects.toMatchObject({
      code: "permission_denied",
    });
    const link = await createProofLink({ projectId: area.project.id }, area.owned);
    const [row] = await prisma.proofLink.findMany({ where: { projectId: area.project.id } });
    await expect(
      revokeProofLink({ projectId: area.project.id, proofLinkId: row.id }, area.membered),
    ).rejects.toMatchObject({ code: "permission_denied" });
    // Still open, because the refusal changed nothing.
    expect(await resolveProofLink(tokenOf(link.url), { prisma })).not.toBeNull();
  });

  it("refuses a signed token with no record behind it", async () => {
    const area = await space();
    const link = await createProofLink({ projectId: area.project.id }, area.owned);
    await prisma.proofLink.deleteMany({ where: { projectId: area.project.id } });
    expect(await resolveProofLink(tokenOf(link.url), { prisma })).toBeNull();
  });
});
