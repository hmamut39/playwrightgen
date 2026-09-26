import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  EvidenceSignatureError,
  evidenceHash,
  listEvidenceSignatures,
  readLinkSignatures,
  signEvidence,
  stillMatches,
} from "@/lib/services/evidence-signature";
import { buildReleaseEvidenceReport } from "@/lib/services/release-evidence";
import { createProofLink, revokeProofLink } from "@/lib/services/release-proof";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;
const tokenOf = (url: string) => url.split("/proof/")[1];

/**
 * A signature is only worth keeping if it cannot be moved to other evidence,
 * and if a stopped link cannot produce one.
 */
describe("accepting shared evidence", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    process.env.RUNNER_INGEST_SECRET ??= "evidence-signature-secret-long-enough";
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
      data: { clerkOrganizationId: unique("org"), name: "Sign", slug: unique("sign") },
    });
    await prisma.membership.create({ data: { organizationId: organization.id, userId: owner.id, role: "OWNER" } });
    const project = await prisma.project.create({
      data: { organizationId: organization.id, name: "Shop", slug: unique("shop"), createdByUserId: owner.id },
    });
    const requirement = await prisma.requirement.create({
      data: {
        organizationId: organization.id,
        projectId: project.id,
        title: "Checkout works",
        description: "A customer can pay.",
        acceptanceCriteria: "An order is created.",
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

  it("keeps the name, the role and a copy of exactly what was accepted", async () => {
    const area = await space();
    const link = await createProofLink({ projectId: area.project.id }, area.owned);

    const signature = await signEvidence(
      tokenOf(link.url),
      { signedName: "  Dana Okonkwo  ", signedRole: "Product owner", note: "Fine to release." },
      { prisma },
    );
    expect(signature.signedName).toBe("Dana Okonkwo");
    expect(signature.evidenceHash).toMatch(/^[0-9a-f]{64}$/);

    const stored = await prisma.evidenceSignature.findUniqueOrThrow({ where: { id: signature.id } });
    expect(stored.note).toBe("Fine to release.");
    // The evidence itself is kept, so the signature is still readable years
    // later even after the project has moved on.
    expect(JSON.stringify(stored.evidence)).toContain("Checkout works");

    const report = await buildReleaseEvidenceReport({
      organizationId: area.organization.id,
      projectId: area.project.id,
      prisma,
    });
    expect(stillMatches(stored, report)).toBe(true);
  });

  it("notices when the project has moved on since somebody accepted it", async () => {
    const area = await space();
    const link = await createProofLink({ projectId: area.project.id }, area.owned);
    const signature = await signEvidence(tokenOf(link.url), { signedName: "Dana" }, { prisma });

    await prisma.requirement.update({
      where: { id: area.requirement.id },
      data: { title: "Checkout works with a saved card" },
    });

    const report = await buildReleaseEvidenceReport({
      organizationId: area.organization.id,
      projectId: area.project.id,
      prisma,
    });
    expect(stillMatches(signature, report)).toBe(false);
  });

  it("hashes the claims, not the moment they were read", async () => {
    const area = await space();
    const read = () =>
      buildReleaseEvidenceReport({ organizationId: area.organization.id, projectId: area.project.id, prisma });
    // Read twice, a moment apart: unchanged evidence must hash the same, or
    // the hash says nothing about whether anything changed.
    expect(evidenceHash(await read())).toBe(evidenceHash(await read()));
  });

  it("signs nothing through a link that was stopped, expired or never issued", async () => {
    const area = await space();
    const link = await createProofLink({ projectId: area.project.id }, area.owned);
    const token = tokenOf(link.url);

    const [row] = await prisma.proofLink.findMany({ where: { projectId: area.project.id } });
    await revokeProofLink({ projectId: area.project.id, proofLinkId: row.id }, area.owned);
    await expect(signEvidence(token, { signedName: "Dana" }, { prisma })).rejects.toBeInstanceOf(
      EvidenceSignatureError,
    );
    // And a stopped link shows no signatures either.
    expect(await readLinkSignatures(token, { prisma })).toEqual([]);

    const fresh = await createProofLink({ projectId: area.project.id, days: 1 }, area.owned);
    const later = new Date(Date.now() + 2 * 86_400_000);
    await expect(
      signEvidence(tokenOf(fresh.url), { signedName: "Dana" }, { prisma, now: later }),
    ).rejects.toMatchObject({ code: "link_invalid" });

    await expect(signEvidence(`${token}x`, { signedName: "Dana" }, { prisma })).rejects.toMatchObject({
      code: "link_invalid",
    });
  });

  it("needs a name, and will not take an unbounded one", async () => {
    const area = await space();
    const link = await createProofLink({ projectId: area.project.id }, area.owned);
    const token = tokenOf(link.url);

    for (const signedName of ["", "   "]) {
      await expect(signEvidence(token, { signedName }, { prisma })).rejects.toMatchObject({
        code: "invalid_input",
      });
    }
    await expect(
      signEvidence(token, { signedName: "x".repeat(121) }, { prisma }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("is a link for a few people, not a petition", async () => {
    const area = await space();
    const link = await createProofLink({ projectId: area.project.id }, area.owned);
    const token = tokenOf(link.url);

    for (let index = 0; index < 20; index += 1) {
      await signEvidence(token, { signedName: `Reader ${index}` }, { prisma });
    }
    await expect(signEvidence(token, { signedName: "One too many" }, { prisma })).rejects.toMatchObject({
      code: "too_many",
    });
    expect(await readLinkSignatures(token, { prisma })).toHaveLength(20);
  });

  it("shows the team every acceptance, and never another tenant's", async () => {
    const area = await space();
    const link = await createProofLink({ projectId: area.project.id }, area.owned);
    await signEvidence(tokenOf(link.url), { signedName: "Dana", signedRole: "Product owner" }, { prisma });

    const listed = await listEvidenceSignatures({ projectId: area.project.id }, area.owned);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ signedName: "Dana", signedRole: "Product owner" });

    const other = await space();
    expect(await listEvidenceSignatures({ projectId: other.project.id }, other.owned)).toEqual([]);
    await expect(listEvidenceSignatures({ projectId: area.project.id }, other.owned)).rejects.toBeTruthy();
  });
});
