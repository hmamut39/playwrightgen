import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import type { RequirementFromTicket } from "@/lib/ai/requirement-from-ticket";
import {
  draftRequirementFromTicket,
  RequirementDraftingError,
} from "@/lib/services/requirement-drafting";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;

const reading = (overrides: Partial<RequirementFromTicket> = {}): RequirementFromTicket => ({
  isBehaviour: true,
  notBehaviourReason: "",
  title: "A customer can pay with a saved card",
  description: "A returning customer selects a saved card and completes the order.",
  acceptanceCriteria: ["An order confirmation appears", "  ", "The saved card is charged once"],
  externalReference: "SHOP-412",
  assumptions: ["The ticket does not say what happens when the saved card has expired."],
  model: "test-model",
  totalTokens: 900,
  ...overrides,
});

/**
 * This feeds the root of the chain: a requirement somebody approves, a test
 * verifies, and an auditor is eventually shown. What it refuses to write
 * matters more than what it writes.
 */
describe("reading a ticket into a requirement", () => {
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
    const owner = await prisma.user.create({ data: { clerkUserId: unique("owner"), displayName: "Lead" } });
    const organization = await prisma.organization.create({
      data: { clerkOrganizationId: unique("org"), name: "Shop", slug: unique("shop") },
    });
    await prisma.membership.create({ data: { organizationId: organization.id, userId: owner.id, role: "OWNER" } });
    const project = await prisma.project.create({
      data: { organizationId: organization.id, name: "Checkout", slug: unique("p"), createdByUserId: owner.id },
    });
    const viewer = await prisma.user.create({ data: { clerkUserId: unique("viewer"), displayName: "Viewer" } });
    await prisma.membership.create({ data: { organizationId: organization.id, userId: viewer.id, role: "MEMBER" } });
    await prisma.projectMembership.create({
      data: { organizationId: organization.id, projectId: project.id, userId: viewer.id, role: "VIEWER" },
    });
    const as = (user: { clerkUserId: string }, read?: () => Promise<RequirementFromTicket>) => ({
      authenticate: async () => ({ userId: user.clerkUserId, orgId: organization.clerkOrganizationId }),
      prisma,
      ...(read ? { read } : {}),
    });
    return { owner, viewer, organization, project, as };
  }

  const ticket = "SHOP-412 Saved cards\n\nA returning customer should be able to pay with a card they saved earlier.";

  it("fills the fields from the ticket, one criterion per line", async () => {
    const area = await space();
    const drafted = await draftRequirementFromTicket(
      { projectId: area.project.id, ticket },
      area.as(area.owner, async () => reading()),
    );

    expect(drafted.title).toBe("A customer can pay with a saved card");
    // Blank lines are dropped: an empty criterion is not a criterion.
    expect(drafted.acceptanceCriteria).toBe("An order confirmation appears\nThe saved card is charged once");
    expect(drafted.externalReference).toBe("SHOP-412");
  });

  it("hands back what the ticket left open instead of writing it in", async () => {
    const area = await space();
    const drafted = await draftRequirementFromTicket(
      { projectId: area.project.id, ticket },
      area.as(area.owner, async () => reading()),
    );

    // The open question is for a person to settle, and must not appear in the
    // description or the criteria as though it had been agreed.
    expect(drafted.assumptions).toEqual([
      "The ticket does not say what happens when the saved card has expired.",
    ]);
    expect(drafted.description).not.toContain("expired");
    expect(drafted.acceptanceCriteria).not.toContain("expired");
  });

  it("refuses a ticket that is not about product behaviour", async () => {
    const area = await space();
    await expect(
      draftRequirementFromTicket(
        { projectId: area.project.id, ticket: "Upgrade the Postgres driver to 8.13 and redeploy." },
        area.as(area.owner, async () =>
          reading({ isBehaviour: false, notBehaviourReason: "a dependency upgrade", title: "" }),
        ),
      ),
    ).rejects.toMatchObject({ code: "not_behaviour" });
  });

  it("refuses text too short to be a ticket, before spending anything", async () => {
    const area = await space();
    let called = 0;
    await expect(
      draftRequirementFromTicket(
        { projectId: area.project.id, ticket: "make it faster" },
        area.as(area.owner, async () => {
          called += 1;
          return reading();
        }),
      ),
    ).rejects.toMatchObject({ code: "empty_ticket" });
    expect(called).toBe(0);
  });

  it("is for someone who may write requirements, not a viewer", async () => {
    const area = await space();
    await expect(
      draftRequirementFromTicket(
        { projectId: area.project.id, ticket },
        area.as(area.viewer, async () => reading()),
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("says it is unavailable rather than leaking why the model failed", async () => {
    const area = await space();
    const { RequirementFromTicketError } = await import("@/lib/ai/requirement-from-ticket");
    await expect(
      draftRequirementFromTicket(
        { projectId: area.project.id, ticket },
        area.as(area.owner, async () => {
          throw new RequirementFromTicketError("model_refusal");
        }),
      ),
    ).rejects.toBeInstanceOf(RequirementDraftingError);
  });
});
