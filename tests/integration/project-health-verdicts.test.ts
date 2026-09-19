import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { getProjectHealthVerdicts } from "@/lib/services/project-health-verdicts";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;

describe("health verdicts on the workspace home", () => {
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

  it("gives each active project the Health page's verdict, and none to archived or unreadable ones", async () => {
    const owner = await prisma.user.create({ data: { clerkUserId: unique("owner"), displayName: "Owner" } });
    const organization = await prisma.organization.create({
      data: { clerkOrganizationId: unique("org"), name: "Health", slug: unique("health") },
    });
    await prisma.membership.create({ data: { organizationId: organization.id, userId: owner.id, role: "OWNER" } });
    const project = (name: string, extra: Record<string, unknown> = {}) =>
      prisma.project.create({
        data: { organizationId: organization.id, name, slug: unique(name.toLowerCase()), createdByUserId: owner.id, ...extra },
      });
    const quiet = await project("Quiet");
    const failing = await project("Failing", {
      liveChecksEnabled: true,
      liveChecksLastSummary: { checked: 2, passed: 1, failed: 1, partial: 0, notChecked: [], failing: [], recovered: [], alert: null, ranAt: new Date().toISOString() },
    });
    const archived = await project("Archived", { status: "ARCHIVED" });
    const deps = {
      authenticate: async () => ({ userId: owner.clerkUserId, orgId: organization.clerkOrganizationId }),
      prisma,
    };

    const verdicts = await getProjectHealthVerdicts(
      {
        orgSlug: organization.slug,
        projects: [quiet, failing, archived, { id: randomUUID(), status: "ACTIVE", liveChecksEnabled: false, liveChecksLastSummary: null }],
      },
      deps,
    );

    expect(verdicts.get(quiet.id)).toEqual({ verdict: "no-evidence", reasons: ["no test has run yet"] });
    expect(verdicts.get(failing.id)?.verdict).toBe("attention");
    expect(verdicts.get(failing.id)?.reasons).toContain("1 failing in the last live check");
    expect(verdicts.has(archived.id)).toBe(false);
    expect(verdicts.size).toBe(2);
  });
});
