import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient, ProjectMembershipRole } from "@/generated/prisma/client";
import type {
  AutomationGenerationInput,
  AutomationGenerationResult,
} from "@/lib/ai/automation-generation";
import {
  approveAutomationArtifact,
  generateAutomationArtifact,
  getAutomationArtifactDetail,
  listAutomationArtifacts,
  requestAutomationChanges,
  submitAutomationArtifact,
} from "@/lib/services/automation-artifacts";
import { readTestCaseVersionMarker } from "@/lib/integrations/runner/ingest-token";
import {
  approveTestCase,
  createTestCase,
  requestTestCaseChanges,
  submitTestCaseForReview,
  updateTestCaseDraft,
} from "@/lib/services/test-cases";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;

describe("tenant-safe versioned automation artifacts", () => {
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

  async function workspace() {
    const owner = await prisma.user.create({
      data: { clerkUserId: unique("owner"), displayName: "Owner" },
    });
    const organization = await prisma.organization.create({
      data: {
        clerkOrganizationId: unique("org"),
        name: "Automation workspace",
        slug: unique("automation"),
      },
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
    return { owner, organization, project };
  }

  const validGeneration = (
    input?: AutomationGenerationInput,
  ): AutomationGenerationResult => ({
    model: "test-model",
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
    name: `${input?.title ?? "Checkout"} automation`,
    summary: "Verifies the approved checkout intent.",
    plan: [{
      title: "Complete checkout",
      intent: "Submit the checkout flow.",
      expectedAssertion: "The confirmation is visible.",
    }],
    code: input?.engine === "PLAYWRIGHT_API"
      ? `import { test, expect } from "@playwright/test";
test("checkout API", async ({ request }) => {
  const response = await request.post("/orders", { data: { sku: "sku-1" } });
  expect(response.status()).toBe(201);
});`
      : `import { test, expect } from "@playwright/test";
test("checkout", async ({ page }) => {
  await page.goto("/checkout");
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByText("Order confirmed")).toBeVisible();
});`,
    configuration: `import { defineConfig } from "@playwright/test";
export default defineConfig({ use: { baseURL: "http://localhost:3000" } });`,
    dependencies: ["@playwright/test"],
    assumptions: ["The route and accessible names match the product."],
  });

  const deps = (
    space: Awaited<ReturnType<typeof workspace>>,
    actor = space.owner,
    generator: (input: AutomationGenerationInput) => Promise<AutomationGenerationResult> =
      async (input) => validGeneration(input),
  ) => ({
    authenticate: async () => ({
      userId: actor.clerkUserId,
      orgId: space.organization.clerkOrganizationId,
    }),
    prisma,
    generator,
  });

  async function addMember(
    space: Awaited<ReturnType<typeof workspace>>,
    role: ProjectMembershipRole,
  ) {
    const user = await prisma.user.create({
      data: { clerkUserId: unique("member"), displayName: role },
    });
    await prisma.membership.create({
      data: {
        organizationId: space.organization.id,
        userId: user.id,
        role: "MEMBER",
      },
    });
    await prisma.projectMembership.create({
      data: {
        organizationId: space.organization.id,
        projectId: space.project.id,
        userId: user.id,
        role,
      },
    });
    return user;
  }

  async function testCase(
    space: Awaited<ReturnType<typeof workspace>>,
    approved = true,
  ) {
    const record = await createTestCase({
      projectId: space.project.id,
      title: "Customer completes checkout",
      objective: "A signed-in customer can place an order.",
      preconditions: "A product is in stock.",
      steps: ["Open the cart", "Submit valid payment"],
      expectedResults: ["Order confirmation is displayed"],
      priority: "HIGH",
      type: "END_TO_END",
      tags: ["checkout"],
    }, deps(space));
    if (approved) {
      await submitTestCaseForReview({
        projectId: space.project.id,
        testCaseId: record.id,
      }, deps(space));
      await approveTestCase({
        projectId: space.project.id,
        testCaseId: record.id,
      }, deps(space));
    }
    return record;
  }

  it("exposes that the pinned version has been superseded", async () => {
    // The artifact page states that automation is pinned to a Test Case
    // version, which is reassuring on its own and misleading once the intent
    // has moved on. It can only warn about that if the detail carries the Test
    // Case's current version alongside the pinned one.
    const space = await workspace();
    const approvedTestCase = await testCase(space);
    const artifact = await generateAutomationArtifact({
      projectId: space.project.id,
      testCaseId: approvedTestCase.id,
      engine: "PLAYWRIGHT_BROWSER",
    }, deps(space));

    const pinned = await getAutomationArtifactDetail({
      projectId: space.project.id,
      automationArtifactId: artifact.id,
    }, deps(space));
    expect(pinned.artifact.testCaseVersion.versionNumber).toBe(1);
    expect(pinned.artifact.testCase.currentVersionNumber).toBe(1);

    // The intent moves on: the Test Case returns to draft, is revised, and is
    // approved again at version 2. The artifact stays pinned to version 1.
    await requestTestCaseChanges({
      projectId: space.project.id,
      testCaseId: approvedTestCase.id,
    }, deps(space));
    await updateTestCaseDraft({
      projectId: space.project.id,
      testCaseId: approvedTestCase.id,
      expectedVersion: 1,
      expectedResults: ["Order confirmation is displayed", "A receipt is emailed"],
    }, deps(space));
    await submitTestCaseForReview({
      projectId: space.project.id,
      testCaseId: approvedTestCase.id,
    }, deps(space));
    await approveTestCase({
      projectId: space.project.id,
      testCaseId: approvedTestCase.id,
    }, deps(space));

    const superseded = await getAutomationArtifactDetail({
      projectId: space.project.id,
      automationArtifactId: artifact.id,
    }, deps(space));

    expect(superseded.artifact.testCaseVersion.versionNumber).toBe(1);
    expect(superseded.artifact.testCase.currentVersionNumber).toBe(2);
    expect(
      superseded.artifact.testCase.currentVersionNumber >
        superseded.artifact.testCaseVersion.versionNumber,
    ).toBe(true);
  });

  it("pins an approved Test Case version and appends generated versions", async () => {
    const space = await workspace();
    const approvedTestCase = await testCase(space);
    const first = await generateAutomationArtifact({
      projectId: space.project.id,
      testCaseId: approvedTestCase.id,
      engine: "PLAYWRIGHT_BROWSER",
    }, deps(space));
    const second = await generateAutomationArtifact({
      projectId: space.project.id,
      testCaseId: approvedTestCase.id,
      engine: "PLAYWRIGHT_BROWSER",
      guidance: "Use the checkout fixture.",
    }, deps(space));

    expect(first.currentVersionNumber).toBe(1);
    expect(second.currentVersionNumber).toBe(2);
    expect(second.versions).toHaveLength(2);
    expect(second.versions[0]).toMatchObject({
      generationStatus: "SUCCEEDED",
      validationStatus: "PASSED",
      model: "test-model",
      totalTokens: 30,
    });
    expect(await prisma.activity.count({
      where: { action: "AUTOMATION_VERSION_GENERATED" },
    })).toBe(2);
  });

  it("stamps generated code with the pinned version so CI results map back", async () => {
    const space = await workspace();
    const approvedTestCase = await testCase(space);
    const artifact = await generateAutomationArtifact({
      projectId: space.project.id,
      testCaseId: approvedTestCase.id,
      engine: "PLAYWRIGHT_BROWSER",
    }, deps(space));

    const stored = artifact.versions[0];
    const title = stored.code.match(/test\(\s*["'`]([^"'`]+)/)?.[1] ?? "";

    // The marker must resolve to the exact immutable version the artifact pins,
    // otherwise an ingested result would attach to the wrong evidence.
    expect(readTestCaseVersionMarker(title)).toBe(artifact.testCaseVersionId);
    expect(stored.validationStatus).toBe("PASSED");
  });

  it("does not double-stamp when a version is regenerated", async () => {
    const space = await workspace();
    const approvedTestCase = await testCase(space);
    await generateAutomationArtifact({
      projectId: space.project.id,
      testCaseId: approvedTestCase.id,
      engine: "PLAYWRIGHT_BROWSER",
    }, deps(space));
    const regenerated = await generateAutomationArtifact({
      projectId: space.project.id,
      testCaseId: approvedTestCase.id,
      engine: "PLAYWRIGHT_BROWSER",
      guidance: "Prefer the checkout fixture.",
    }, deps(space));

    for (const version of regenerated.versions) {
      expect(version.code.match(/\[pwg:/g) ?? []).toHaveLength(1);
    }
  });

  it("requires approved Test Case intent", async () => {
    const space = await workspace();
    const draft = await testCase(space, false);
    await expect(generateAutomationArtifact({
      projectId: space.project.id,
      testCaseId: draft.id,
      engine: "PLAYWRIGHT_BROWSER",
    }, deps(space))).rejects.toMatchObject({ code: "approved_test_case_required" });
  });

  it("stores provider failure safely without executable content", async () => {
    const space = await workspace();
    const approvedTestCase = await testCase(space);
    const artifact = await generateAutomationArtifact({
      projectId: space.project.id,
      testCaseId: approvedTestCase.id,
      engine: "PLAYWRIGHT_BROWSER",
    }, deps(space, space.owner, async () => {
      throw new Error("model_refusal");
    }));
    expect(artifact.versions[0]).toMatchObject({
      generationStatus: "FAILED",
      validationStatus: "BLOCKED",
      failureCode: "model_refusal",
      code: "",
    });
    await expect(submitAutomationArtifact({
      projectId: space.project.id,
      automationArtifactId: artifact.id,
    }, deps(space))).rejects.toMatchObject({ code: "reviewable_automation_required" });
  });

  it("enforces human review roles and preserves the approved version during revision", async () => {
    const space = await workspace();
    const approvedTestCase = await testCase(space);
    const member = await addMember(space, "MEMBER");
    const artifact = await generateAutomationArtifact({
      projectId: space.project.id,
      testCaseId: approvedTestCase.id,
      engine: "PLAYWRIGHT_API",
    }, deps(space, member));
    await expect(submitAutomationArtifact({
      projectId: space.project.id,
      automationArtifactId: artifact.id,
    }, deps(space, member))).rejects.toMatchObject({ code: "permission_denied" });

    const lead = await addMember(space, "PROJECT_LEAD");
    await submitAutomationArtifact({
      projectId: space.project.id,
      automationArtifactId: artifact.id,
    }, deps(space, lead));
    await expect(approveAutomationArtifact({
      projectId: space.project.id,
      automationArtifactId: artifact.id,
    }, deps(space, lead))).rejects.toMatchObject({ code: "permission_denied" });
    await requestAutomationChanges({
      projectId: space.project.id,
      automationArtifactId: artifact.id,
    }, deps(space));
    await submitAutomationArtifact({
      projectId: space.project.id,
      automationArtifactId: artifact.id,
    }, deps(space, lead));
    const approved = await approveAutomationArtifact({
      projectId: space.project.id,
      automationArtifactId: artifact.id,
    }, deps(space));
    expect(approved).toMatchObject({ status: "APPROVED", approvedVersionNumber: 1 });

    const revised = await generateAutomationArtifact({
      projectId: space.project.id,
      testCaseId: approvedTestCase.id,
      engine: "PLAYWRIGHT_API",
    }, deps(space, member));
    expect(revised).toMatchObject({
      status: "DRAFT",
      currentVersionNumber: 2,
      approvedVersionNumber: 1,
    });
    expect((await prisma.testCase.findUniqueOrThrow({ where: { id: approvedTestCase.id } })).automationStatus)
      .toBe("AUTOMATED");
  });

  it("blocks locally invalid output from review", async () => {
    const space = await workspace();
    const approvedTestCase = await testCase(space);
    const artifact = await generateAutomationArtifact({
      projectId: space.project.id,
      testCaseId: approvedTestCase.id,
      engine: "PLAYWRIGHT_BROWSER",
    }, deps(space, space.owner, async (input) => ({
      ...validGeneration(input),
      code: "```ts\ntest.only('unsafe', async () => eval('x'))\n```",
      dependencies: ["shelljs"],
    })));
    expect(artifact.versions[0].validationStatus).toBe("BLOCKED");
    await expect(submitAutomationArtifact({
      projectId: space.project.id,
      automationArtifactId: artifact.id,
    }, deps(space))).rejects.toMatchObject({ code: "reviewable_automation_required" });
  });

  it("does not expose artifacts across tenants", async () => {
    const first = await workspace();
    const second = await workspace();
    const approvedTestCase = await testCase(first);
    const artifact = await generateAutomationArtifact({
      projectId: first.project.id,
      testCaseId: approvedTestCase.id,
      engine: "PLAYWRIGHT_BROWSER",
    }, deps(first));
    expect((await listAutomationArtifacts({ projectId: second.project.id }, deps(second))).items)
      .toEqual([]);
    await expect(getAutomationArtifactDetail({
      projectId: second.project.id,
      automationArtifactId: artifact.id,
    }, deps(second))).rejects.toMatchObject({ code: "automation_artifact_not_found" });
  });
});
