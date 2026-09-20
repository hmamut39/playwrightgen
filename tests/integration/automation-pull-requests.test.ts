import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AutomationGenerationInput } from "@/lib/ai/automation-generation";
import { GitHubProviderError } from "@/lib/integrations/github/app-client";
import type { openPullRequest } from "@/lib/integrations/github/pull-request";
import {
  approveAutomationArtifact,
  generateAutomationArtifact,
  submitAutomationArtifact,
} from "@/lib/services/automation-artifacts";
import { openAutomationPullRequest } from "@/lib/services/automation-pull-requests";
import { approveTestCase, createTestCase, submitTestCaseForReview } from "@/lib/services/test-cases";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;
const CODE = `import { test, expect } from "@playwright/test";
test("[pwg:abc] a visitor adds a todo", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("textbox")).toBeVisible();
});`;

describe("offering approved automation to the connected repository", () => {
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

  async function space(options: { connectRepository?: boolean } = {}) {
    const owner = await prisma.user.create({ data: { clerkUserId: unique("owner"), displayName: "Owner" } });
    const organization = await prisma.organization.create({
      data: { clerkOrganizationId: unique("org"), name: "PR", slug: unique("pr") },
    });
    await prisma.membership.create({ data: { organizationId: organization.id, userId: owner.id, role: "OWNER" } });
    const project = await prisma.project.create({
      data: { organizationId: organization.id, name: "Web", slug: unique("web"), createdByUserId: owner.id },
    });
    const contributor = await prisma.user.create({ data: { clerkUserId: unique("dev"), displayName: "Dev" } });
    await prisma.membership.create({ data: { organizationId: organization.id, userId: contributor.id, role: "MEMBER" } });
    await prisma.projectMembership.create({
      data: { organizationId: organization.id, projectId: project.id, userId: contributor.id, role: "MEMBER" },
    });

    if (options.connectRepository !== false) {
      const installation = await prisma.gitHubInstallation.create({
        data: {
          organizationId: organization.id,
          externalInstallationId: "555",
          accountId: "1",
          accountLogin: "acme",
          accountType: "Organization",
          repositorySelection: "selected",
          connectedByUserId: owner.id,
        },
      });
      await prisma.repositoryConnection.create({
        data: {
          organizationId: organization.id,
          projectId: project.id,
          githubInstallationId: installation.id,
          externalRepositoryId: "9001",
          ownerLogin: "acme",
          name: "web",
          fullName: "acme/web",
          defaultBranch: "main",
          createdByUserId: owner.id,
        },
      });
    }

    const as = (user: { clerkUserId: string }) => ({
      authenticate: async () => ({ userId: user.clerkUserId, orgId: organization.clerkOrganizationId }),
      prisma,
      generator: async (generation: AutomationGenerationInput) => ({
        model: "test-model",
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        name: `${generation.title} automation`,
        summary: "Passed on the live page: 8 checks.",
        plan: [{ title: "Add", intent: "Add a todo", expectedAssertion: "It is listed" }],
        code: CODE,
        configuration: `import { defineConfig } from "@playwright/test";\nexport default defineConfig({});`,
        dependencies: ["@playwright/test"],
        assumptions: [],
      }),
    });
    return { owner, contributor, organization, project, owned: as(owner), contributed: as(contributor) };
  }

  async function approvedArtifact(area: Awaited<ReturnType<typeof space>>) {
    const deps = area.owned;
    const testCase = await createTestCase(
      { projectId: area.project.id, title: "A visitor adds a todo", objective: "Adding works.", steps: ["Type"], expectedResults: ["Listed"], type: "END_TO_END" },
      deps,
    );
    await submitTestCaseForReview({ projectId: area.project.id, testCaseId: testCase.id }, deps);
    await approveTestCase({ projectId: area.project.id, testCaseId: testCase.id }, deps);
    const artifact = await generateAutomationArtifact({ projectId: area.project.id, testCaseId: testCase.id, engine: "PLAYWRIGHT_BROWSER" }, deps);
    return { artifact, testCase };
  }

  const recorder = () => {
    const calls: Parameters<typeof openPullRequest>[0][] = [];
    const opener = (async (input: Parameters<typeof openPullRequest>[0]) => {
      calls.push(input);
      return { url: "https://github.com/acme/web/pull/3", number: 3, branch: input.branch, created: true };
    }) as typeof openPullRequest;
    return { calls, opener };
  };

  it("sends the approved code to a branch, with the record in the description and the audit trail", async () => {
    const area = await space();
    const { artifact } = await approvedArtifact(area);
    await submitAutomationArtifact({ projectId: area.project.id, automationArtifactId: artifact.id }, area.owned);
    await approveAutomationArtifact({ projectId: area.project.id, automationArtifactId: artifact.id }, area.owned);
    const github = recorder();

    const result = await openAutomationPullRequest(
      { projectId: area.project.id, automationArtifactId: artifact.id },
      area.owned,
      github.opener,
    );

    expect(result).toMatchObject({ url: "https://github.com/acme/web/pull/3", repository: "acme/web" });
    const [call] = github.calls;
    expect(call).toMatchObject({ installationId: "555", externalRepositoryId: "9001", owner: "acme", repo: "web", baseBranch: "main" });
    expect(call.branch).toMatch(/^playwrightgen\/.+-v1$/);
    expect(call.files[0].path).toMatch(/^tests\/playwrightgen\/.+\.spec\.ts$/);
    expect(call.files[0].content).toContain("[pwg:abc]");
    expect(call.body).toContain("Test Case version 1");
    expect(call.body).toContain("cannot merge it");
    const activity = await prisma.activity.findFirst({
      where: { projectId: area.project.id, action: "AUTOMATION_PULL_REQUEST_OPENED" },
    });
    expect(activity?.metadata).toMatchObject({ repository: "acme/web", pullRequestNumber: 3, alreadyOpen: false });
  });

  it("offers nothing that is not approved, and nothing without a repository", async () => {
    const area = await space();
    const { artifact } = await approvedArtifact(area);
    const github = recorder();
    // Still a draft: no pull request.
    await expect(
      openAutomationPullRequest({ projectId: area.project.id, automationArtifactId: artifact.id }, area.owned, github.opener),
    ).rejects.toMatchObject({ code: "not_approved" });

    const bare = await space({ connectRepository: false });
    const draft = await approvedArtifact(bare);
    await submitAutomationArtifact({ projectId: bare.project.id, automationArtifactId: draft.artifact.id }, bare.owned);
    await approveAutomationArtifact({ projectId: bare.project.id, automationArtifactId: draft.artifact.id }, bare.owned);
    await expect(
      openAutomationPullRequest({ projectId: bare.project.id, automationArtifactId: draft.artifact.id }, bare.owned, github.opener),
    ).rejects.toMatchObject({ code: "no_repository" });
    expect(github.calls).toHaveLength(0);
  });

  it("is a lead's decision, and says plainly when the app may only read", async () => {
    const area = await space();
    const { artifact } = await approvedArtifact(area);
    await submitAutomationArtifact({ projectId: area.project.id, automationArtifactId: artifact.id }, area.owned);
    await approveAutomationArtifact({ projectId: area.project.id, automationArtifactId: artifact.id }, area.owned);

    await expect(
      openAutomationPullRequest({ projectId: area.project.id, automationArtifactId: artifact.id }, area.contributed),
    ).rejects.toMatchObject({ code: "permission_denied" });

    const refusing = (async () => {
      throw new GitHubProviderError("github_pull_request_permission_missing");
    }) as typeof openPullRequest;
    await expect(
      openAutomationPullRequest({ projectId: area.project.id, automationArtifactId: artifact.id }, area.owned, refusing),
    ).rejects.toMatchObject({ code: "permission_missing" });
    expect(await prisma.activity.count({ where: { action: "AUTOMATION_PULL_REQUEST_OPENED" } })).toBe(0);
  });
});
