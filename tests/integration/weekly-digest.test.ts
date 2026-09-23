import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { sendWeeklyDigests } from "@/lib/services/weekly-digest";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;
const SLACK = "https://hooks.slack.com/services/T0/B0/weekly";

describe("the weekly digest a project's channel receives", () => {
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

  /** A project whose week is written straight into run evidence. */
  async function projectWithWeek(results: Array<{ title: string; days: Array<[number, "PASSED" | "FAILED"]> }>, webhookUrl: string | null = SLACK) {
    const owner = await prisma.user.create({ data: { clerkUserId: unique("owner"), displayName: "Owner" } });
    const organization = await prisma.organization.create({
      data: { clerkOrganizationId: unique("org"), name: "Weekly", slug: unique("weekly") },
    });
    await prisma.membership.create({ data: { organizationId: organization.id, userId: owner.id, role: "OWNER" } });
    const project = await prisma.project.create({
      data: {
        organizationId: organization.id,
        name: "Shop",
        slug: unique("shop"),
        createdByUserId: owner.id,
        liveUrl: "https://shop.example.com/",
        liveChecksEnabled: true,
        liveChecksActorUserId: owner.id,
        liveChecksWebhookUrl: webhookUrl,
      },
    });

    for (const [index, entry] of results.entries()) {
      const testCase = await prisma.testCase.create({
        data: {
          organizationId: organization.id,
          projectId: project.id,
          title: entry.title,
          objective: "It works.",
          preconditions: "",
          steps: ["Do it"],
          expectedResults: ["It happens"],
          type: "END_TO_END",
          status: "APPROVED",
          ownerUserId: owner.id,
          createdByUserId: owner.id,
          currentVersionNumber: 1,
        },
      });
      const version = await prisma.testCaseVersion.create({
        data: {
          organizationId: organization.id,
          projectId: project.id,
          testCaseId: testCase.id,
          versionNumber: 1,
          title: entry.title,
          objective: "It works.",
          preconditions: "",
          tags: [],
          steps: ["Do it"],
          expectedResults: ["It happens"],
          type: "END_TO_END",
          priority: "MEDIUM",
          automationStatus: "AUTOMATED",
          source: "MANUAL",
          ownerUserId: owner.id,
          createdByUserId: owner.id,
        },
      });
      const testRun = await prisma.testRun.create({
        data: {
          organizationId: organization.id,
          projectId: project.id,
          testCaseId: testCase.id,
          testCaseVersionId: version.id,
          name: `Run ${index}`,
          status: entry.days[entry.days.length - 1][1],
          mode: "PLAYWRIGHT_BROWSER",
          environment: "OTHER",
          browser: "CHROMIUM",
          createdByUserId: owner.id,
          latestAttemptNumber: entry.days.length,
        },
      });
      for (const [attemptNumber, [hoursAgo, result]] of entry.days.entries()) {
        await prisma.testRunAttempt.create({
          data: {
            organizationId: organization.id,
            projectId: project.id,
            testRunId: testRun.id,
            attemptNumber: attemptNumber + 1,
            result,
            mode: "PLAYWRIGHT_BROWSER",
            environment: "OTHER",
            browser: "CHROMIUM",
            summary: "Daily live check.",
            failureDetails: result === "FAILED" ? "Test body: timed out." : "",
            stepResults: [],
            evidence: [],
            sourceRef: "live-check",
            executedByUserId: owner.id,
            executedAt: new Date(Date.now() - hoursAgo * 60 * 60_000),
          },
        });
      }
    }
    return { project, organization };
  }

  it("posts what changed, once a week", async () => {
    const space = await projectWithWeek([
      { title: "Checkout completes", days: [[100, "PASSED"], [10, "FAILED"]] },
      { title: "Sign in works", days: [[100, "PASSED"], [10, "PASSED"]] },
    ]);
    const posts: Array<{ url: string; body: string }> = [];
    const post = async (url: string, body: string) => {
      posts.push({ url, body });
      return true;
    };

    expect(await sendWeeklyDigests({ budgetMs: 30_000, prisma, post })).toMatchObject({ due: 1, sent: 1, quiet: 0 });
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe(SLACK);
    const text = JSON.parse(posts[0].body).text as string;
    expect(text).toContain("week in review -- Shop (https://shop.example.com/)");
    expect(text).toContain("2 tests checked daily; 1 passed every time.");
    expect(text).toContain("Broke this week (1):\n- Checkout completes");
    expect(text).toContain(`/projects/${space.project.id}/health`);

    // Running the job again the same week must not repeat it.
    expect(await sendWeeklyDigests({ budgetMs: 30_000, prisma, post })).toMatchObject({ due: 0, sent: 0 });
    expect(posts).toHaveLength(1);
  });

  it("still says so when the week was quiet, and says nothing without a channel", async () => {
    await projectWithWeek([{ title: "Sign in works", days: [[100, "PASSED"], [10, "PASSED"]] }]);
    const posts: string[] = [];
    expect(
      await sendWeeklyDigests({
        budgetMs: 30_000,
        prisma,
        post: async (_url, body) => {
          posts.push(JSON.parse(body).text);
          return true;
        },
      }),
    ).toMatchObject({ due: 1, sent: 1, quiet: 1 });
    expect(posts[0]).toContain("All 1 test passed every day this week.");

    await cleanPhase1ATables(prisma);
    await projectWithWeek([{ title: "Sign in works", days: [[10, "FAILED"]] }], null);
    const silent: string[] = [];
    expect(
      await sendWeeklyDigests({ budgetMs: 30_000, prisma, post: async (_url, body) => (silent.push(body), true) }),
    ).toMatchObject({ due: 0, sent: 0 });
    expect(silent).toEqual([]);
  });
});
