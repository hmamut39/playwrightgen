import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AutomationGenerationInput } from "@/lib/ai/automation-generation";
import type { PreviewRunResult } from "@/lib/free-tools/preview-run/execute";
import {
  approveAutomationArtifact,
  generateAutomationArtifact,
  submitAutomationArtifact,
} from "@/lib/services/automation-artifacts";
import {
  runDueLiveChecks,
  runLiveChecksForProject,
  setLiveChecks,
  whyNotCheckable,
} from "@/lib/services/live-checks";
import { approveTestCase, createTestCase, submitTestCaseForReview } from "@/lib/services/test-cases";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;

const publicCode = `import { test, expect } from "@playwright/test";
test("adds a todo", async ({ page }) => {
  await page.goto("/todomvc/");
  await page.getByRole("textbox", { name: "What needs to be done?" }).fill("Buy milk");
  await expect(page.getByText("Buy milk")).toBeVisible();
});`;

const signInCode = `import { test, expect } from "@playwright/test";
test("signs in", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Username" }).fill(process.env.E2E_USERNAME!);
  await expect(page).toHaveURL(/inventory/);
});`;

const run = (counts: Partial<PreviewRunResult["counts"]>): PreviewRunResult => ({
  tests: [{ name: "t", status: counts.failed ? "failed" : "passed", steps: [{ name: "Test body", status: counts.failed ? "failed" : "passed", operations: [{ source: "await page.goto('/')", status: counts.failed ? "failed" : "passed", detail: counts.failed ? "Timeout 5000ms exceeded." : undefined }] }] }],
  counts: { passed: 3, failed: 0, skipped: 0, notReached: 0, ...counts },
  durationMs: 1_000,
  timedOut: false,
});

describe("daily live checks of approved automation", () => {
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

  async function projectWithApprovedAutomation(codes: string[]) {
    const owner = await prisma.user.create({ data: { clerkUserId: unique("owner"), displayName: "Owner" } });
    const organization = await prisma.organization.create({
      data: { clerkOrganizationId: unique("org"), name: "Live", slug: unique("live") },
    });
    await prisma.membership.create({ data: { organizationId: organization.id, userId: owner.id, role: "OWNER" } });
    const project = await prisma.project.create({
      data: { organizationId: organization.id, name: "Todos", slug: unique("todos"), createdByUserId: owner.id, liveUrl: "https://demo.playwright.dev/todomvc/" },
    });
    const viewer = await prisma.user.create({ data: { clerkUserId: unique("viewer"), displayName: "Viewer" } });
    await prisma.membership.create({ data: { organizationId: organization.id, userId: viewer.id, role: "MEMBER" } });
    await prisma.projectMembership.create({ data: { organizationId: organization.id, projectId: project.id, userId: viewer.id, role: "VIEWER" } });

    const as = (user: { clerkUserId: string }, code = "") => ({
      authenticate: async () => ({ userId: user.clerkUserId, orgId: organization.clerkOrganizationId }),
      prisma,
      generator: async (input: AutomationGenerationInput) => ({
        model: "test-model",
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        name: `${input.title} automation`,
        summary: "Checks it.",
        plan: [{ title: "It", intent: "Do it", expectedAssertion: "It happens" }],
        code,
        configuration: `import { defineConfig } from "@playwright/test";\nexport default defineConfig({});`,
        dependencies: ["@playwright/test"],
        assumptions: [],
      }),
    });

    const testCaseIds: string[] = [];
    for (const [index, code] of codes.entries()) {
      const deps = as(owner, code);
      const testCase = await createTestCase(
        { projectId: project.id, title: `Behaviour ${index}`, objective: "It works.", steps: ["Do it"], expectedResults: ["It happens"], type: "END_TO_END" },
        deps,
      );
      await submitTestCaseForReview({ projectId: project.id, testCaseId: testCase.id }, deps);
      await approveTestCase({ projectId: project.id, testCaseId: testCase.id }, deps);
      const artifact = await generateAutomationArtifact({ projectId: project.id, testCaseId: testCase.id, engine: "PLAYWRIGHT_BROWSER" }, deps);
      await submitAutomationArtifact({ projectId: project.id, automationArtifactId: artifact.id }, deps);
      await approveAutomationArtifact({ projectId: project.id, automationArtifactId: artifact.id }, deps);
      testCaseIds.push(testCase.id);
    }
    return { owner, viewer, organization, project, testCaseIds, owned: as(owner), viewed: as(viewer) };
  }

  it("records each day's result as a run attempt, so a failure after a pass is a regression", async () => {
    const space = await projectWithApprovedAutomation([publicCode]);
    await setLiveChecks({ projectId: space.project.id, enabled: true }, space.owned);

    const first = await runLiveChecksForProject(space.project.id, { prisma, runner: async () => run({}) });
    expect(first).toMatchObject({ checked: 1, passed: 1, failed: 0 });

    const second = await runLiveChecksForProject(space.project.id, { prisma, runner: async () => run({ passed: 1, failed: 1 }) });
    expect(second).toMatchObject({ checked: 1, passed: 0, failed: 1 });

    const testRun = await prisma.testRun.findFirstOrThrow({
      where: { projectId: space.project.id, testCaseId: space.testCaseIds[0] },
      include: { attempts: { orderBy: { attemptNumber: "asc" } } },
    });
    expect(testRun.status).toBe("FAILED");
    expect(testRun.attempts.map((attempt) => attempt.result)).toEqual(["PASSED", "FAILED"]);
    expect(testRun.attempts[1]).toMatchObject({ sourceRef: "live-check", executedByUserId: space.owner.id, baseUrl: "https://demo.playwright.dev/todomvc/" });
    expect(testRun.attempts[1].failureDetails).toContain("Timeout 5000ms exceeded.");
    expect(testRun.attempts[1].summary).toContain("Daily live check on https://demo.playwright.dev/todomvc/");
  });

  it("skips a test that needs a sign-in account instead of reporting it broken", async () => {
    const space = await projectWithApprovedAutomation([publicCode, signInCode]);
    await setLiveChecks({ projectId: space.project.id, enabled: true }, space.owned);
    const ran: string[] = [];

    const summary = await runLiveChecksForProject(space.project.id, {
      prisma,
      runner: async (code) => {
        ran.push(code);
        return run({});
      },
    });

    expect(ran).toHaveLength(1);
    expect(summary).toMatchObject({ checked: 1, passed: 1 });
    expect(summary?.notChecked).toEqual([{ title: "Behaviour 1", reason: "It needs E2E_USERNAME, and test accounts are never stored." }]);
  });

  it("runs a project at most once a day, and not at all when turned off", async () => {
    const space = await projectWithApprovedAutomation([publicCode]);
    const runner = async () => run({});

    expect((await runDueLiveChecks({ budgetMs: 60_000, prisma, runner })).due).toBe(0);
    await setLiveChecks({ projectId: space.project.id, enabled: true }, space.owned);
    expect(await runDueLiveChecks({ budgetMs: 60_000, prisma, runner })).toMatchObject({ due: 1, ran: 1 });
    expect((await runDueLiveChecks({ budgetMs: 60_000, prisma, runner })).due).toBe(0);

    await setLiveChecks({ projectId: space.project.id, enabled: false }, space.owned);
    expect(await runLiveChecksForProject(space.project.id, { prisma, runner })).toBeNull();
  });

  it("needs a live URL, and only someone who can update the project can turn it on", async () => {
    const space = await projectWithApprovedAutomation([]);
    await expect(setLiveChecks({ projectId: space.project.id, enabled: true }, space.viewed)).rejects.toMatchObject({ code: "permission_denied" });
    await prisma.project.update({ where: { id: space.project.id }, data: { liveUrl: null } });
    await expect(setLiveChecks({ projectId: space.project.id, enabled: true }, space.owned)).rejects.toMatchObject({ code: "live_url_required" });
  });

  it("names what a test needs from the environment", () => {
    expect(whyNotCheckable(publicCode)).toBeNull();
    expect(whyNotCheckable(signInCode)).toBe("It needs E2E_USERNAME, and test accounts are never stored.");
    expect(whyNotCheckable("const x = 1;")).toBe("No test could be read from the code.");
  });
});
