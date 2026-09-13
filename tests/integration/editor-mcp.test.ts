import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { handleMcpRequest } from "@/app/api/mcp/route";
import type { PrismaClient } from "@/generated/prisma/client";
import type { AutomationGenerationInput } from "@/lib/ai/automation-generation";
import { deriveEditorToken, parseEditorToken } from "@/lib/integrations/editor/editor-token";
import { handleMcpMessage } from "@/lib/mcp/playwrightgen-mcp";
import {
  approveAutomationArtifact,
  generateAutomationArtifact,
  submitAutomationArtifact,
} from "@/lib/services/automation-artifacts";
import { authenticateEditorRequest, type EditorSession } from "@/lib/services/editor-access";
import { approveTestCase, createTestCase, submitTestCaseForReview } from "@/lib/services/test-cases";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;
const SECRET = "editor-token-test-secret-with-enough-length";

describe("editor connection over MCP", () => {
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
      data: { clerkOrganizationId: unique("org"), name: "Editor", slug: unique("editor") },
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
    const engineer = await prisma.user.create({
      data: { clerkUserId: unique("engineer"), displayName: "Engineer" },
    });
    await prisma.membership.create({
      data: { organizationId: organization.id, userId: engineer.id, role: "MEMBER" },
    });
    await prisma.projectMembership.create({
      data: {
        organizationId: organization.id,
        projectId: project.id,
        userId: engineer.id,
        role: "MEMBER",
      },
    });
    return { owner, engineer, organization, project };
  }

  type Space = Awaited<ReturnType<typeof workspace>>;

  const deps = (space: Space) => ({
    authenticate: async () => ({
      userId: space.owner.clerkUserId,
      orgId: space.organization.clerkOrganizationId,
    }),
    prisma,
    generator: async (input: AutomationGenerationInput) => ({
      model: "test-model",
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      name: `${input.title} automation`,
      summary: "Checks checkout.",
      plan: [{ title: "Checkout", intent: "Buy", expectedAssertion: "Confirmed" }],
      code: `import { test, expect } from "@playwright/test";
test("checkout", async ({ page }) => {
  await page.goto("/checkout");
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByText("Order confirmed")).toBeVisible();
});`,
      configuration: `import { defineConfig } from "@playwright/test";
export default defineConfig({ use: { baseURL: "http://localhost:3000" } });`,
      dependencies: ["@playwright/test"],
      assumptions: ["The route and accessible names match the product."],
    }),
  });

  async function approvedTestCaseWithAutomation(space: Space) {
    const testCase = await createTestCase({
      projectId: space.project.id,
      title: "Customer completes checkout",
      objective: "A customer can place an order.",
      steps: ["Open the cart", "Pay"],
      expectedResults: ["Order confirmation is displayed"],
      priority: "HIGH",
      type: "END_TO_END",
    }, deps(space));
    await submitTestCaseForReview({ projectId: space.project.id, testCaseId: testCase.id }, deps(space));
    await approveTestCase({ projectId: space.project.id, testCaseId: testCase.id }, deps(space));
    const artifact = await generateAutomationArtifact({
      projectId: space.project.id,
      testCaseId: testCase.id,
      engine: "PLAYWRIGHT_BROWSER",
    }, deps(space));
    await submitAutomationArtifact({ projectId: space.project.id, automationArtifactId: artifact.id }, deps(space));
    await approveAutomationArtifact({ projectId: space.project.id, automationArtifactId: artifact.id }, deps(space));
    return { testCase, artifact };
  }

  function tokenFor(space: Space, userId: string, tokenVersion = 1) {
    return deriveEditorToken({
      secret: SECRET,
      organizationId: space.organization.id,
      projectId: space.project.id,
      userId,
      tokenVersion,
    });
  }

  const authenticate = (token: string | null) =>
    authenticateEditorRequest(token === null ? null : `Bearer ${token}`, { prisma, secret: SECRET });

  describe("tokens", () => {
    it("round-trips the ids it carries", () => {
      const projectId = randomUUID();
      const userId = randomUUID();
      const token = deriveEditorToken({
        secret: SECRET, organizationId: randomUUID(), projectId, userId, tokenVersion: 1,
      });
      expect(parseEditorToken(token)).toEqual({ projectId, userId });
      expect(parseEditorToken("pwg1.not-a-token")).toBeNull();
    });

    it("accepts a member's own token", async () => {
      const space = await workspace();
      const session = await authenticate(tokenFor(space, space.engineer.id));
      expect(session).toMatchObject({ projectId: space.project.id, projectName: "Checkout" });
    });

    it("rejects tampering, another user's claim, the wrong secret and rotation", async () => {
      const space = await workspace();
      const valid = tokenFor(space, space.engineer.id);
      // Swap the user id for the owner's while keeping the engineer's MAC.
      const [prefix, project, , signature] = valid.split(".");
      const forged = [prefix, project, space.owner.id.replace(/-/g, ""), signature].join(".");

      expect(await authenticate(forged)).toBeNull();
      expect(await authenticate(null)).toBeNull();
      expect(
        await authenticateEditorRequest(`Bearer ${valid}`, { prisma, secret: `${SECRET}-other` }),
      ).toBeNull();

      await prisma.project.update({
        where: { id: space.project.id },
        data: { runnerTokenVersion: 2 },
      });
      expect(await authenticate(valid)).toBeNull();
      expect(await authenticate(tokenFor(space, space.engineer.id, 2))).not.toBeNull();
    });

    it("stops working the moment the person loses access", async () => {
      const space = await workspace();
      const token = tokenFor(space, space.engineer.id);
      expect(await authenticate(token)).not.toBeNull();

      await prisma.projectMembership.updateMany({
        where: { userId: space.engineer.id },
        data: { status: "REMOVED", removedAt: new Date() },
      });
      expect(await authenticate(token)).toBeNull();
    });

    it("does not let a token for one tenant read another", async () => {
      const first = await workspace();
      const second = await workspace();
      // The second tenant's project id, signed as if by the first organization.
      const crossed = deriveEditorToken({
        secret: SECRET,
        organizationId: first.organization.id,
        projectId: second.project.id,
        userId: first.engineer.id,
        tokenVersion: 1,
      });
      expect(await authenticate(crossed)).toBeNull();
    });
  });

  describe("protocol", () => {
    async function sessionFor(space: Space): Promise<EditorSession> {
      const session = await authenticate(tokenFor(space, space.engineer.id));
      if (!session) throw new Error("expected a session");
      return session;
    }

    const call = (session: EditorSession, name: string, args: unknown = {}) =>
      handleMcpMessage(
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
        session,
      ) as Promise<{ result: { content: Array<{ text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean } }>;

    it("initializes, lists read-only tools, and ignores notifications", async () => {
      const space = await workspace();
      const session = await sessionFor(space);

      const init = await handleMcpMessage(
        { jsonrpc: "2.0", id: "a", method: "initialize", params: { protocolVersion: "2025-03-26" } },
        session,
      );
      expect(init).toMatchObject({
        id: "a",
        result: { protocolVersion: "2025-03-26", serverInfo: { name: "playwrightgen" } },
      });
      expect(
        await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, session),
      ).toBeNull();

      const list = (await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, session)) as {
        result: { tools: Array<{ name: string; annotations: { readOnlyHint: boolean } }> };
      };
      expect(list.result.tools.map((tool) => tool.name)).toEqual([
        "project_overview",
        "list_test_cases",
        "get_test_case",
        "list_approved_automation",
        "get_approved_automation",
        "list_recent_failures",
      ]);
      expect(list.result.tools.every((tool) => tool.annotations.readOnlyHint)).toBe(true);
    });

    it("serves the approved test case with its version marker, and the approved code", async () => {
      const space = await workspace();
      const { testCase, artifact } = await approvedTestCaseWithAutomation(space);
      const session = await sessionFor(space);

      const listed = await call(session, "list_test_cases", { status: "APPROVED" });
      expect(listed.result.structuredContent?.testCases).toEqual([
        expect.objectContaining({ id: testCase.id, status: "APPROVED" }),
      ]);

      const detail = await call(session, "get_test_case", { testCaseId: testCase.id });
      const version = await prisma.testCaseVersion.findFirstOrThrow({ where: { testCaseId: testCase.id } });
      expect(detail.result.structuredContent).toMatchObject({
        marker: `[pwg:${version.id}]`,
        steps: ["Open the cart", "Pay"],
      });
      expect(detail.result.content[0].text).toContain(`[pwg:${version.id}]`);

      const automation = await call(session, "list_approved_automation");
      expect(automation.result.structuredContent?.automation).toEqual([
        expect.objectContaining({
          id: artifact.id,
          suggestedPath: "tests/customer-completes-checkout.spec.ts",
        }),
      ]);

      const code = await call(session, "get_approved_automation", { automationArtifactId: artifact.id });
      expect(code.result.isError).toBeUndefined();
      expect(String(code.result.structuredContent?.code)).toContain(`[pwg:${version.id}]`);
    });

    it("answers bad arguments and foreign ids as tool errors, not crashes", async () => {
      const space = await workspace();
      const other = await workspace();
      const { testCase } = await approvedTestCaseWithAutomation(other);
      const session = await sessionFor(space);

      const invalid = await call(session, "get_test_case", { testCaseId: "nope" });
      expect(invalid.result.isError).toBe(true);
      const foreign = await call(session, "get_test_case", { testCaseId: testCase.id });
      expect(foreign.result).toMatchObject({ isError: true });
      expect(foreign.result.content[0].text).toBe("Not found in this project.");

      const unknown = await handleMcpMessage(
        { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "delete_everything" } },
        session,
      );
      expect(unknown).toMatchObject({ error: { code: -32602 } });
    });
  });

  describe("endpoint", () => {
    it("refuses a request without a valid token", async () => {
      const response = await handleMcpRequest(
        new NextRequest("https://playwrightgen.test/api/mcp", {
          method: "POST",
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
        { authenticate: async () => null },
      );
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("Bearer");
    });

    it("answers requests with JSON and notifications with 202", async () => {
      const space = await workspace();
      const token = tokenFor(space, space.engineer.id);
      const dependencies = {
        authenticate: (header: string | null) =>
          authenticateEditorRequest(header, { prisma, secret: SECRET }),
      };
      const post = (body: unknown) =>
        handleMcpRequest(
          new NextRequest("https://playwrightgen.test/api/mcp", {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
          dependencies,
        );

      const listed = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" });
      expect(listed.status).toBe(200);
      expect((await listed.json()).result.tools).toHaveLength(6);

      const notified = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
      expect(notified.status).toBe(202);
    });
  });
});
