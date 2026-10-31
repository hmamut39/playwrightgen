import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  approvePageCoverage,
  buildSuite,
  getPageCoverage,
  measureControls,
  PageCoverageError,
  resumePageCoverage,
  retryFailedPageCoverageItems,
  withTestIds,
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

  it("combines proven tests into one file where their helpers cannot collide", () => {
    const suite = buildSuite("https://shop.example.com/", [
      { title: "Adds an item", status: "PASSED", code: "import { test, expect } from '@playwright/test';\nconst ITEM = 'Backpack';\ntest('adds', async ({ page }) => {\n  await expect(page).toHaveTitle(/Shop/);\n});" },
      { title: "Removes an item", status: "PARTIAL", code: "import { test, expect } from \"@playwright/test\";\nconst ITEM = 'Bike light';\ntest('removes', async ({ page }) => {});" },
      { title: "Still failing", status: "FAILED", code: "import { test } from '@playwright/test';\ntest('x', async () => {});" },
      { title: "Never proven", status: "QUEUED", code: null },
    ]);

    expect(suite).not.toBeNull();
    expect(suite!.match(/from '@playwright\/test'|from "@playwright\/test"/g)).toHaveLength(1);
    expect(suite).toContain('test.describe("Adds an item", () => {');
    expect(suite).toContain('test.describe("Removes an item", () => {');
    expect(suite).not.toContain("Still failing");
    // Each file's own const sits inside its own describe block.
    expect(suite).toContain("  const ITEM = 'Backpack';");
    expect(suite).toContain("  const ITEM = 'Bike light';");
    expect(buildSuite("https://shop.example.com/", [{ title: "t", status: "FAILED", code: "x" }])).toBeNull();
  });

  it("counts a control reached through its test attribute, not only its name", () => {
    const controls = withTestIds(
      [{ role: "button", name: "Add to cart" }, { role: "link", name: "About" }],
      ['button "Add to cart" [data-test="add-to-cart-sauce-labs-backpack"]', 'button "Add to cart" [data-test="add-to-cart-bike-light"]'],
    );
    expect(controls[0].testIds).toEqual(["add-to-cart-sauce-labs-backpack", "add-to-cart-bike-light"]);
    const result = measureControls(controls, `await page.locator('[data-test="add-to-cart-bike-light"]').click();`);
    expect(result.reached).toEqual([{ role: "button", name: "Add to cart" }]);
    expect(result.missed).toEqual([{ role: "link", name: "About" }]);
  });

  it("matches control names regardless of case and spacing", () => {
    const result = measureControls(
      [{ role: "button", name: "Place  Order" }, { role: "link", name: "Help" }],
      "await page.getByRole('button', { name: 'place order' }).click();",
    );
    expect(result.reached.map((control) => control.name)).toEqual(["Place  Order"]);
    expect(result.missed.map((control) => control.name)).toEqual(["Help"]);
  });

  it("holds a link to another site outside the score", () => {
    // Nobody should be asked to write a test for a credit line in the footer,
    // and the total it is counted in decides whether they are asked.
    const result = measureControls(
      [
        { role: "textbox", name: "What needs to be done?" },
        { role: "link", name: "Remo H. Jansen", offSite: true },
      ],
      'await page.getByPlaceholder("What needs to be done?").fill("buy milk");',
    );
    expect(result.total).toBe(1);
    expect(result.reached).toHaveLength(1);
    expect(result.missed).toEqual([]);
    expect(result.offSite).toEqual([{ role: "link", name: "Remo H. Jansen" }]);
  });
  /**
   * A test that errored was never run.
   *
   * On a first run against TodoMVC two of five items errored because the
   * live browser could not be reached, and the page offered no way back:
   * the run was finished, so those tests were lost and the person was left
   * with a draft Test Case holding no code.
   */
  it("puts the tests that never ran back in the queue, and nothing else", async () => {
    const s = await space();
    const [errored, failed, passed] = s.run.items;
    await prisma.pageCoverageItem.update({
      where: { id: errored.id },
      data: { status: "ERROR", detail: "Something went wrong.", finishedAt: new Date(), checks: 0, fixes: 0 },
    });
    await prisma.pageCoverageItem.update({
      where: { id: failed.id },
      data: { status: "FAILED", detail: "Still failing after the automatic fixes.", code: "test('x', () => {});" },
    });
    await prisma.pageCoverageItem.update({ where: { id: passed.id }, data: { status: "PASSED", checks: 7 } });

    const result = await retryFailedPageCoverageItems(
      { projectId: s.project.id, coverageId: s.run.id },
      s.owned,
    );

    expect(result).toEqual({ requeued: 1 });
    const items = await prisma.pageCoverageItem.findMany({
      where: { pageCoverageId: s.run.id },
      orderBy: { position: "asc" },
    });
    // Queued again, and the old non-result cleared so the page does not show
    // a reason beside a test that is being tried afresh.
    expect(items[0]).toMatchObject({ status: "QUEUED", detail: null, startedAt: null, finishedAt: null });
    // A failure is a real result with code a person can finish. Re-running it
    // would spend the AI allowance on work already done.
    expect(items[1].status).toBe("FAILED");
    expect(items[2].status).toBe("PASSED");
    // The proving loop only picks items up while the run says it is proving.
    expect(await prisma.pageCoverage.findUniqueOrThrow({ where: { id: s.run.id } })).toMatchObject({
      status: "PROVING",
    });
  });

  it("refuses when nothing errored, rather than re-running a finished plan", async () => {
    const s = await space();
    await prisma.pageCoverageItem.updateMany({
      where: { pageCoverageId: s.run.id },
      data: { status: "PASSED" },
    });

    await expect(
      retryFailedPageCoverageItems({ projectId: s.project.id, coverageId: s.run.id }, s.owned),
    ).rejects.toMatchObject({ code: "nothing_selected" });
  });

  it("does not let a viewer try the failed tests again", async () => {
    const s = await space();
    await prisma.pageCoverageItem.update({
      where: { id: s.run.items[0].id },
      data: { status: "ERROR", detail: "Something went wrong." },
    });

    // Proving spends the organisation's AI allowance, so it is an act, not a
    // read, and a viewer cannot perform it.
    await expect(
      retryFailedPageCoverageItems({ projectId: s.project.id, coverageId: s.run.id }, s.viewed),
    ).rejects.toBeTruthy();
  });
  /**
   * One Test Case per planned item, however many attempts it takes.
   *
   * Proving created one unconditionally, so a second attempt produced a
   * second Test Case with the same title and orphaned the first -- empty,
   * with no code, and no longer pointed at by its own item. Walking a fresh
   * project found two drafts called "Prevent adding an empty todo", one of
   * them useless, and nothing on the screen to tell them apart.
   *
   * Asserted on the item rather than through proving, which needs a live
   * browser and the model: what must hold is that a retry leaves the item
   * pointing at the draft it already had, so the proving loop finds it.
   */
  it("keeps the draft Test Case an item already has when it is tried again", async () => {
    const s = await space();
    const item = s.run.items[0];
    const testCase = await prisma.testCase.create({
      data: {
        organizationId: s.organization.id,
        projectId: s.project.id,
        title: item.title,
        objective: item.objective,
        preconditions: "",
        steps: ["Do it"],
        expectedResults: ["It happens"],
        status: "DRAFT",
        ownerUserId: s.owner.id,
        createdByUserId: s.owner.id,
      },
    });
    await prisma.pageCoverageItem.update({
      where: { id: item.id },
      data: { status: "ERROR", testCaseId: testCase.id, detail: "Something went wrong." },
    });

    await retryFailedPageCoverageItems({ projectId: s.project.id, coverageId: s.run.id }, s.owned);

    const after = await prisma.pageCoverageItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.status).toBe("QUEUED");
    // The link survives the requeue. Clearing it here would send the next
    // attempt off to create the duplicate this exists to prevent.
    expect(after.testCaseId).toBe(testCase.id);
    expect(await prisma.testCase.count({ where: { projectId: s.project.id } })).toBe(1);
  });
});
