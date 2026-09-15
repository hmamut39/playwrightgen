import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { signRunReceipt } from "@/lib/free-tools/preview-run/receipt";
import {
  createAutomationFromImportedDraft,
  getAutomationArtifactDetail,
} from "@/lib/services/automation-artifacts";
import { getImportedDraft, recordImportedDraft } from "@/lib/services/imported-drafts";
import { approveTestCase, createTestCase, submitTestCaseForReview } from "@/lib/services/test-cases";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;
const SECRET = "test-receipt-secret-that-is-long-enough-000";

const code = `import { test, expect } from '@playwright/test';

test('adds a todo', async ({ page }) => {
  await page.goto('/todomvc/');
  await page.getByRole('textbox', { name: 'What needs to be done?' }).fill('Buy milk');
  await page.getByRole('textbox', { name: 'What needs to be done?' }).press('Enter');
  await expect(page.getByTestId('todo-title')).toHaveText('Buy milk');
});`;

const passingRun = {
  tests: [{ name: "adds a todo", status: "passed" as const, steps: [] }],
  counts: { passed: 4, failed: 0, skipped: 0, notReached: 0 },
  durationMs: 3_200,
  timedOut: false,
};

describe("code imported with a Test Case from Quick Generate", () => {
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

  async function approvedTestCase() {
    const owner = await prisma.user.create({ data: { clerkUserId: unique("owner"), displayName: "Owner" } });
    const organization = await prisma.organization.create({
      data: { clerkOrganizationId: unique("org"), name: "Import workspace", slug: unique("import") },
    });
    await prisma.membership.create({ data: { organizationId: organization.id, userId: owner.id, role: "OWNER" } });
    const project = await prisma.project.create({
      data: { organizationId: organization.id, name: "Todos", slug: unique("todos"), createdByUserId: owner.id },
    });
    const deps = {
      authenticate: async () => ({ userId: owner.clerkUserId, orgId: organization.clerkOrganizationId }),
      prisma,
      // Using imported code must never call the model.
      generator: async () => {
        throw new Error("model_called");
      },
    };
    const testCase = await createTestCase({
      projectId: project.id,
      title: "Add a todo",
      objective: "A person can add a todo.",
      steps: ["Type a todo", "Press Enter"],
      expectedResults: ["The todo is listed"],
      type: "END_TO_END",
      source: "AI_SUGGESTED",
      tags: ["free-tool-import"],
      automationStatus: "CANDIDATE",
    }, deps);
    return { owner, organization, project, testCase, deps };
  }

  async function approve(space: Awaited<ReturnType<typeof approvedTestCase>>) {
    await submitTestCaseForReview({ projectId: space.project.id, testCaseId: space.testCase.id }, space.deps);
    await approveTestCase({ projectId: space.project.id, testCaseId: space.testCase.id }, space.deps);
  }

  function record(space: Awaited<ReturnType<typeof approvedTestCase>>, receipt: string | null, importedCode = code) {
    return recordImportedDraft({
      organizationId: space.organization.id,
      projectId: space.project.id,
      testCaseId: space.testCase.id,
      userId: space.owner.id,
      source: "quick-generate",
      code: importedCode,
      pageUrl: "https://demo.playwright.dev/todomvc/",
      receipt,
    }, prisma, SECRET);
  }

  it("keeps the passing run as evidence only for the exact code that ran", async () => {
    const space = await approvedTestCase();
    const receipt = signRunReceipt({ code, pageUrl: "https://demo.playwright.dev/todomvc/", result: passingRun }, SECRET);
    await record(space, receipt);

    const draft = await getImportedDraft({ projectId: space.project.id, testCaseId: space.testCase.id }, space.deps);
    expect(draft?.evidence).toMatchObject({ verdict: "passed", passed: 4, tests: 1 });

    // Edited after the run: the receipt no longer describes this code.
    const other = await approvedTestCase();
    await record(other, receipt, code.replace("Buy milk", "Buy bread"));
    const edited = await getImportedDraft({ projectId: other.project.id, testCaseId: other.testCase.id }, other.deps);
    expect(edited?.code).toContain("Buy bread");
    expect(edited?.evidence).toBeNull();
  });

  it("turns the imported code into the first automation version after approval, once", async () => {
    const space = await approvedTestCase();
    await record(space, signRunReceipt({ code, pageUrl: "https://demo.playwright.dev/todomvc/", result: passingRun }, SECRET));
    const input = { projectId: space.project.id, testCaseId: space.testCase.id };

    await expect(createAutomationFromImportedDraft(input, space.deps)).rejects.toMatchObject({ code: "approved_test_case_required" });

    await approve(space);
    const artifact = await createAutomationFromImportedDraft(input, space.deps);
    const detail = await getAutomationArtifactDetail({ projectId: space.project.id, automationArtifactId: artifact.id }, space.deps);
    const [version] = detail.artifact.versions;
    expect(detail.artifact.engine).toBe("PLAYWRIGHT_BROWSER");
    expect(version).toMatchObject({ generationStatus: "SUCCEEDED", model: "imported-draft", promptVersion: "free-tool-import-v1" });
    expect(version.validationStatus).not.toBe("BLOCKED");
    expect(version.code).toContain("getByTestId('todo-title')");
    expect(version.summary).toContain("passed on the live page before import: 4 checks");

    const used = await getImportedDraft(input, space.deps);
    expect(used?.usedInAutomationVersionId).toBe(version.id);
    await expect(createAutomationFromImportedDraft(input, space.deps)).rejects.toMatchObject({ code: "imported_draft_already_used" });
  });
});
