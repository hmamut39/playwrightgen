import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type {
  ActivityAction,
  ActivitySource,
  ActivityTargetType,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import { exportProjectActivity } from "@/lib/services/activity-export";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;

/**
 * The trail as something a reviewer can take away.
 *
 * Paging through twenty rows at a time is not an answer to "show me everything
 * that happened to this project last quarter". The record was already
 * append-only; it simply could not leave the screen.
 */
describe("exporting a project's activity", () => {
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

  async function workspace(projectName: string) {
    const owner = await prisma.user.create({
      data: { clerkUserId: unique("owner"), displayName: "Dana Scully" },
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
        name: projectName,
        slug: unique("checkout"),
        createdByUserId: owner.id,
      },
    });
    return { owner, organization, project };
  }

  const deps = (space: Awaited<ReturnType<typeof workspace>>) => ({
    authenticate: async () => ({
      userId: space.owner.clerkUserId,
      orgId: space.organization.clerkOrganizationId,
    }),
    prisma,
  });

  type Overrides = {
    source?: ActivitySource;
    actorUserId?: string | null;
    action?: ActivityAction;
    targetType?: ActivityTargetType;
    targetId?: string;
    metadata?: Prisma.InputJsonValue;
  };

  async function record(
    space: Awaited<ReturnType<typeof workspace>>,
    overrides: Overrides = {},
  ) {
    return prisma.activity.create({
      data: {
        organizationId: space.organization.id,
        projectId: space.project.id,
        actorUserId: space.owner.id,
        source: "USER",
        action: "REQUIREMENT_APPROVED",
        targetType: "REQUIREMENT",
        targetId: randomUUID(),
        metadata: { versionNumber: 2 },
        ...overrides,
      },
    });
  }

  it("writes a header and one row per event, newest first", async () => {
    const space = await workspace("Checkout");
    await record(space);
    await record(space, {
      source: "SYSTEM",
      actorUserId: null,
      action: "CI_RESULTS_DELIVERED",
      targetType: "PROJECT",
      targetId: space.project.id,
      metadata: { provider: "jenkins", ref: "main", recorded: 0, total: 7 },
    });

    const exported = await exportProjectActivity({ projectId: space.project.id }, deps(space));
    const lines = exported.csv.split("\r\n");

    expect(lines[0]).toBe("recorded_at_utc,actor,action,detail,target_type,target_id");
    expect(exported.rowCount).toBe(2);
    expect(exported.capped).toBe(false);

    // Newest first, and the delivery carries the detail the page shows.
    expect(lines[1]).toContain("received results from CI");
    expect(lines[1]).toContain("Jenkins · main · 0 of 7 recorded");
    // An event nobody performed is attributed to the system, not to a blank.
    expect(lines[1]).toContain(",System,");
    expect(lines[2]).toContain("approved a requirement");
    expect(lines[2]).toContain("Dana Scully");
  });

  it("names the file for the project and the dates it covers", async () => {
    const space = await workspace("Checkout");
    await record(space);

    const exported = await exportProjectActivity({ projectId: space.project.id }, deps(space));
    const today = new Date().toISOString().slice(0, 10);

    expect(exported.filename).toContain(space.project.slug);
    expect(exported.filename).toContain(today);
    expect(exported.filename.endsWith(".csv")).toBe(true);
  });

  it("exports a header and nothing else when nothing has happened", async () => {
    const space = await workspace("Quiet");

    const exported = await exportProjectActivity({ projectId: space.project.id }, deps(space));

    expect(exported.rowCount).toBe(0);
    expect(exported.csv.split("\r\n")).toHaveLength(1);
  });

  it("will not export another workspace's trail", async () => {
    const theirs = await workspace("Theirs");
    const ours = await workspace("Ours");
    await record(theirs);

    await expect(
      exportProjectActivity({ projectId: theirs.project.id }, deps(ours)),
    ).rejects.toThrow();

    const exported = await exportProjectActivity({ projectId: ours.project.id }, deps(ours));
    expect(exported.rowCount).toBe(0);
  });
});
