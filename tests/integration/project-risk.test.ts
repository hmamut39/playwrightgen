import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { getOrganizationProjectRisk } from "@/lib/services/project-risk";
import {
  approveTestCase,
  createTestCase,
  submitTestCaseForReview,
} from "@/lib/services/test-cases";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

describe("organization project risk", () => {
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

  async function organization() {
    const owner = await prisma.user.create({
      data: { clerkUserId: unique("owner"), displayName: "Owner" },
    });
    const org = await prisma.organization.create({
      data: {
        clerkOrganizationId: unique("org"),
        name: "Risk workspace",
        slug: unique("risk"),
      },
    });
    await prisma.membership.create({
      data: { organizationId: org.id, userId: owner.id, role: "OWNER" },
    });
    return { owner, org };
  }

  async function project(space: Awaited<ReturnType<typeof organization>>, name: string) {
    return prisma.project.create({
      data: {
        organizationId: space.org.id,
        name,
        slug: unique(name.toLowerCase()),
        createdByUserId: space.owner.id,
      },
    });
  }

  const deps = (space: Awaited<ReturnType<typeof organization>>) => ({
    authenticate: async () => ({
      userId: space.owner.clerkUserId,
      orgId: space.org.clerkOrganizationId,
    }),
    prisma,
  });

  /** Records a run whose latest attempt fails on a newer commit than a pass. */
  async function regressingRun(
    space: Awaited<ReturnType<typeof organization>>,
    projectId: string,
  ) {
    const testCase = await createTestCase({
      projectId,
      title: "Customer completes checkout",
      objective: "A signed-in customer can place an order.",
      preconditions: "A product is in stock.",
      steps: ["Open the cart"],
      expectedResults: ["Order confirmation is displayed"],
      priority: "HIGH",
      type: "END_TO_END",
      tags: [],
    }, deps(space));
    await submitTestCaseForReview({ projectId, testCaseId: testCase.id }, deps(space));
    await approveTestCase({ projectId, testCaseId: testCase.id }, deps(space));

    const version = await prisma.testCaseVersion.findFirstOrThrow({
      where: { organizationId: space.org.id, projectId, testCaseId: testCase.id },
      orderBy: { versionNumber: "desc" },
      select: { id: true },
    });

    const run = await prisma.testRun.create({
      data: {
        organizationId: space.org.id,
        projectId,
        testCaseId: testCase.id,
        testCaseVersionId: version.id,
        name: "checkout",
        status: "FAILED",
        mode: "PLAYWRIGHT_BROWSER",
        environment: "DEVELOPMENT",
        browser: "CHROMIUM",
        latestAttemptNumber: 2,
        createdByUserId: space.owner.id,
      },
    });

    const attempt = (attemptNumber: number, result: "PASSED" | "FAILED", commitSha: string) => ({
      organizationId: space.org.id,
      projectId,
      testRunId: run.id,
      attemptNumber,
      result,
      mode: "PLAYWRIGHT_BROWSER" as const,
      environment: "DEVELOPMENT" as const,
      browser: "CHROMIUM" as const,
      summary: "",
      failureDetails: "",
      stepResults: [],
      evidence: [],
      commitSha,
      sourceRef: "main",
      executedByUserId: space.owner.id,
      executedAt: new Date(attemptNumber * 1_000_000),
    });

    await prisma.testRunAttempt.create({ data: attempt(1, "PASSED", SHA_A) });
    await prisma.testRunAttempt.create({ data: attempt(2, "FAILED", SHA_B) });
    return run;
  }

  it("attributes a regression to the project that owns the run", async () => {
    const space = await organization();
    const failing = await project(space, "Checkout");
    const clean = await project(space, "Billing");
    await regressingRun(space, failing.id);

    const risk = await getOrganizationProjectRisk({}, deps(space));

    expect(risk.get(failing.id)?.regressions).toBe(1);
    expect(risk.get(clean.id)).toBeUndefined();
  });

  it("reports a project with no attempts as having no evidence", async () => {
    const space = await organization();
    const empty = await project(space, "Reporting");

    const risk = await getOrganizationProjectRisk({}, deps(space));

    // Absent rather than zero-with-a-green-tick: the caller must decide how to
    // present a project that has never run anything.
    expect(risk.get(empty.id)).toBeUndefined();
  });

  it("records the latest evidence timestamp per project", async () => {
    const space = await organization();
    const target = await project(space, "Checkout");
    await regressingRun(space, target.id);

    const risk = await getOrganizationProjectRisk({}, deps(space));

    expect(risk.get(target.id)?.lastEvidenceAt).toEqual(new Date(2_000_000));
  });

  it("does not include another organization's projects", async () => {
    const space = await organization();
    const foreign = await organization();
    const foreignProject = await project(foreign, "Foreign");
    await regressingRun(foreign, foreignProject.id);

    const risk = await getOrganizationProjectRisk({}, deps(space));

    expect(risk.has(foreignProject.id)).toBe(false);
  });
});
