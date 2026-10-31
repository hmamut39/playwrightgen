import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import type { EvidenceRequirement, ReleaseEvidenceReport } from "@/lib/services/release-evidence";
import { scopeReleaseToMilestone, ReleaseScopeError } from "@/lib/services/release-scope";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;
const numericId = () => String(Math.floor(Math.random() * 1_000_000_000) + 1);

/**
 * Narrowing the evidence to a release, without owning the release.
 *
 * The grouping comes from the tracker and the join is the reference a
 * requirement already carries. What is worth asserting is the arithmetic that
 * follows: only referenced requirements are counted, the totals describe the
 * narrowed set rather than the project, and the issues with no requirement
 * behind them are reported rather than quietly dropped -- a release that looks
 * smaller than it is also looks better verified than it is.
 */

const requirement = (
  title: string,
  externalReference: string | null,
  verdict: EvidenceRequirement["verdict"],
): EvidenceRequirement => ({
  id: `r-${title}`,
  title,
  status: "APPROVED",
  versionNumber: 1,
  externalReference,
  verdict,
  reason: "Because.",
  lastVerifiedAt: verdict === "VERIFIED" ? new Date("2026-10-10T00:00:00.000Z") : null,
  ageDays: verdict === "VERIFIED" ? 1 : null,
  freshness: verdict === "VERIFIED" ? "FRESH" : "MISSING",
  approvedBy: "Dana Scully",
  approvedAt: new Date("2026-09-01T00:00:00.000Z"),
  criteriaCount: 1,
  testCases: [],
});

const report = (requirements: EvidenceRequirement[]): ReleaseEvidenceReport => ({
  project: { id: "p1", name: "Shop", slug: "shop" },
  organization: { name: "Acme", slug: "acme" },
  generatedAt: new Date("2026-10-11T09:00:00.000Z"),
  requirements,
  unlinkedTests: [],
  totals: { verified: 0, failing: 0, unverified: 0, stale: 0 },
  truncated: false,
  coverage: { shown: requirements.length, total: requirements.length },
});

describe("scoping the evidence to a milestone", () => {
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

  const deps = (space: Awaited<ReturnType<typeof workspace>>, references: string[]) => ({
    authenticate: async () => ({
      userId: space.owner.clerkUserId,
      orgId: space.organization.clerkOrganizationId,
    }),
    prisma,
    readMilestones: vi.fn().mockResolvedValue([
      { number: 3, title: "October release", state: "open", issueCount: references.length },
    ]),
    readReferences: vi.fn().mockResolvedValue(references),
  });

  it("counts only the requirements the milestone references", async () => {
    const space = await workspace();
    const scoped = await scopeReleaseToMilestone(
      { projectId: space.project.id, milestoneNumber: 3 },
      report([
        requirement("In the release and passing", "acme/web#1", "VERIFIED"),
        requirement("In the release and failing", "acme/web#2", "FAILING"),
        requirement("A later release", "acme/web#99", "FAILING"),
        requirement("Written by hand, no ticket", null, "UNVERIFIED"),
      ]),
      deps(space, ["acme/web#1", "acme/web#2"]),
    );

    expect(scoped.requirements.map((item) => item.title)).toEqual([
      "In the release and passing",
      "In the release and failing",
    ]);
    // Totals describe the release, not the project: the failing requirement
    // from a later milestone must not make this one look worse.
    expect(scoped.totals).toMatchObject({ verified: 1, failing: 1, unverified: 0 });
    expect(scoped.milestone.title).toBe("October release");
  }, 60_000);

  it("reports issues in the milestone that no requirement covers", async () => {
    const space = await workspace();
    const scoped = await scopeReleaseToMilestone(
      { projectId: space.project.id, milestoneNumber: 3 },
      report([requirement("The only one written up", "acme/web#1", "VERIFIED")]),
      deps(space, ["acme/web#1", "acme/web#2", "acme/web#3"]),
    );

    // Two issues are being shipped with no requirement behind them, which is
    // exactly what a release review exists to notice.
    expect(scoped.withoutRequirement).toBe(2);
  }, 60_000);

  it("matches a reference whatever its casing", async () => {
    const space = await workspace();
    const scoped = await scopeReleaseToMilestone(
      { projectId: space.project.id, milestoneNumber: 3 },
      report([requirement("Typed by hand", "Acme/Web#1", "VERIFIED")]),
      deps(space, ["acme/web#1"]),
    );

    // GitHub treats owner and repository names case-insensitively, and a
    // reference typed by a person will not always match what the fetch wrote.
    expect(scoped.requirements).toHaveLength(1);
    expect(scoped.withoutRequirement).toBe(0);
  }, 60_000);

  it("refuses when the project has no connected repository", async () => {
    const space = await workspace({ connect: false });

    await expect(
      scopeReleaseToMilestone(
        { projectId: space.project.id, milestoneNumber: 3 },
        report([]),
        deps(space, []),
      ),
    ).rejects.toBeInstanceOf(ReleaseScopeError);
  }, 60_000);

  it("keeps one project's milestones out of another's", async () => {
    const theirs = await workspace();
    const ours = await workspace({ connect: false });

    // The connection belongs to theirs; ours has none, so there is nothing to
    // read and nothing to leak.
    await expect(
      scopeReleaseToMilestone(
        { projectId: ours.project.id, milestoneNumber: 3 },
        report([requirement("Theirs", "acme/web#1", "VERIFIED")]),
        deps(ours, ["acme/web#1"]),
      ),
    ).rejects.toMatchObject({ code: "no_repository" });
    expect(theirs.project.id).not.toBe(ours.project.id);
  }, 60_000);
});
