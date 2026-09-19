import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  approvePageCoverage,
  getPageCoverage,
  measureControls,
  PageCoverageError,
  resumePageCoverage,
} from "@/lib/services/page-coverage";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;

describe("cover a page: approving, pausing and counting what was reached", () => {
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
    const owner = await prisma.user.create({ data: { clerkUserId: unique("owner"), displayName: "Owner" } });
    const organization = await prisma.organization.create({
      data: { clerkOrganizationId: unique("org"), name: "Cover", slug: unique("cover") },
    });
    await prisma.membership.create({ data: { organizationId: organization.id, userId: owner.id, role: "OWNER" } });
    const project = await prisma.project.create({
      data: { organizationId: organization.id, name: "Shop", slug: unique("shop"), createdByUserId: owner.id },
    });
    const viewer = await prisma.user.create({ data: { clerkUserId: unique("viewer"), displayName: "Viewer" } });
    await prisma.membership.create({ data: { organizationId: organization.id, userId: viewer.id, role: "MEMBER" } });
    await prisma.projectMembership.create({
      data: { organizationId: organization.id, projectId: project.id, userId: viewer.id, role: "VIEWER" },
    });
    const as = (user: { clerkUserId: string }) => ({
      authenticate: async () => ({ userId: user.clerkUserId, orgId: organization.clerkOrganizationId }),
      prisma,
    });
    const run = await prisma.pageCoverage.create({
      data: {
        organizationId: organization.id,
        projectId: project.id,
        pageUrl: "https://shop.example.com/cart",
        pageTitle: "Cart",
        focus: "",
        message: "Covers the cart.\nLeft out: paying with a real card",
        controls: [
          { role: "button", name: "Add to cart" },
          { role: "button", name: "Checkout" },
          { role: "link", name: "Continue shopping" },
        ],
        createdByUserId: owner.id,
        items: {
          create: [0, 1, 2].map((position) => ({
            position,
            title: `Test ${position}`,
            objective: "Something a person can do.",
            steps: ["Do it"],
            expectedResults: ["It happens"],
            rationale: "It matters.",
          })),
        },
      },
      include: { items: { orderBy: { position: "asc" } } },
    });
    return { owner, viewer, organization, project, run, owned: as(owner), viewed: as(viewer) };
  }

  it("queues what was kept, leaves the rest out, and refuses a second approval", async () => {
    const s = await space();
    const input = { projectId: s.project.id, coverageId: s.run.id };

    await expect(approvePageCoverage({ ...input, itemIds: [] }, s.owned)).rejects.toMatchObject({ code: "nothing_selected" });
    await approvePageCoverage({ ...input, itemIds: [s.run.items[0].id, s.run.items[2].id] }, s.owned);

    const items = await prisma.pageCoverageItem.findMany({ where: { pageCoverageId: s.run.id }, orderBy: { position: "asc" } });
    expect(items.map((item) => item.status)).toEqual(["QUEUED", "SKIPPED", "QUEUED"]);
    expect((await prisma.pageCoverage.findUniqueOrThrow({ where: { id: s.run.id } })).status).toBe("PROVING");

    await expect(approvePageCoverage({ ...input, itemIds: [s.run.items[1].id] }, s.owned)).rejects.toBeInstanceOf(PageCoverageError);
  });

  it("does not let a viewer approve or resume a plan, but lets them read it", async () => {
    const s = await space();
    const input = { projectId: s.project.id, coverageId: s.run.id };

    await expect(approvePageCoverage({ ...input, itemIds: [s.run.items[0].id] }, s.viewed)).rejects.toMatchObject({ code: "permission_denied" });
    await expect(resumePageCoverage(input, s.viewed)).rejects.toMatchObject({ code: "permission_denied" });
    const read = await getPageCoverage(input, s.viewed);
    expect(read.canAct).toBe(false);
    expect(read.run.items).toHaveLength(3);
  });

  it("counts the page's controls the proven tests reach, from their locators", async () => {
    const s = await space();
    await prisma.pageCoverageItem.update({
      where: { id: s.run.items[0].id },
      data: { status: "PASSED", code: "await page.getByRole('button', { name: 'Add to cart' }).click();" },
    });
    await prisma.pageCoverageItem.update({
      where: { id: s.run.items[1].id },
      // Failed tests do not count as reaching anything.
      data: { status: "FAILED", code: "await page.getByRole('button', { name: 'Checkout' }).click();" },
    });

    const { coverage } = await getPageCoverage({ projectId: s.project.id, coverageId: s.run.id }, s.owned);
    expect(coverage.total).toBe(3);
    expect(coverage.reached).toEqual([{ role: "button", name: "Add to cart" }]);
    expect(coverage.missed.map((control) => control.name)).toEqual(["Checkout", "Continue shopping"]);
  });

  it("resumes only a paused plan", async () => {
    const s = await space();
    const input = { projectId: s.project.id, coverageId: s.run.id };
    await expect(resumePageCoverage(input, s.owned)).rejects.toMatchObject({ code: "not_found" });
    await prisma.pageCoverage.update({ where: { id: s.run.id }, data: { status: "PAUSED", message: "Allowance used." } });
    await resumePageCoverage(input, s.owned);
    expect(await prisma.pageCoverage.findUniqueOrThrow({ where: { id: s.run.id } })).toMatchObject({ status: "PROVING", message: null });
  });

  it("matches control names regardless of case and spacing", () => {
    const result = measureControls(
      [{ role: "button", name: "Place  Order" }, { role: "link", name: "Help" }],
      "await page.getByRole('button', { name: 'place order' }).click();",
    );
    expect(result.reached.map((control) => control.name)).toEqual(["Place  Order"]);
    expect(result.missed.map((control) => control.name)).toEqual(["Help"]);
  });
});
