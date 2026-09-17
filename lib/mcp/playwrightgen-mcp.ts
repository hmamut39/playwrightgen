import "server-only";

import { z } from "zod";

import { repairDraft } from "@/lib/ai/draft-repair";
import { generateQuickDraft } from "@/lib/ai/quick-generation";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { capturePageSnapshot, isPublicWebAddress } from "@/lib/free-tools/page-snapshot";
import { runVerdict } from "@/lib/free-tools/preview-run/receipt";
import {
  firstFailureOf,
  proveDraftOnLivePage,
  type ProveRound,
} from "@/lib/free-tools/prove-loop";
import {
  executeLiveRun,
  LiveRunUnavailableError,
  prepareLiveRun,
  runEnvSchema,
} from "@/lib/free-tools/preview-run/run-draft";
import {
  OrganizationAiRateLimitError,
  reserveOrganizationAiRequest,
} from "@/lib/operations/organization-ai-guard";
import { slugify } from "@/lib/format/slug";
import { buildTestCaseVersionMarker } from "@/lib/integrations/runner/ingest-token";
import {
  getAutomationArtifactDetail,
  listAutomationArtifacts,
} from "@/lib/services/automation-artifacts";
import type { EditorSession } from "@/lib/services/editor-access";
import { getReleaseReadiness } from "@/lib/services/release-readiness";
import { attachEditorCode, ImportedDraftError } from "@/lib/services/imported-drafts";
import {
  createTestCase,
  getTestCaseDetail,
  listTestCases,
  readTestCaseList,
  submitTestCaseForReview,
} from "@/lib/services/test-cases";
import { siteUrl } from "@/lib/site";

/**
 * PlaywrightGen as an MCP server: approved test intent, inside the editor.
 *
 * Code generation is not the scarce part any more -- every editor ships an
 * assistant that writes Playwright. What those assistants lack is the thing
 * this product keeps: which behaviour was agreed, by whom, at which version,
 * and what the last run proved. Serving that over the Model Context Protocol
 * lets Copilot, Cursor or Claude Code write a test against the approved case
 * rather than a guess, carry the version marker that maps its results back,
 * and pull reviewed automation into the repository without copy and paste.
 *
 * One protocol reaches every editor, which is why this exists instead of an
 * extension per editor.
 *
 * It is stateless, and it can propose but never decide: agents may create a
 * draft test case or send code for one, and a person approves in PlaywrightGen.
 * It It speaks JSON-RPC over the
 * Streamable HTTP transport, answering each POST with a single JSON response;
 * it opens no streams because nothing here is long-running. Every tool goes
 * through the same services, and so the same authorization, as the web app.
 */

export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
const SERVER_INFO = { name: "playwrightgen", title: "PlaywrightGen", version: "1.0.0" };

const INSTRUCTIONS = `PlaywrightGen holds this project's approved requirements, test cases, reviewed Playwright automation and run evidence.
When writing or changing a Playwright test for this project:
1. Find the test case with list_test_cases and read it with get_test_case. Write the test against its approved steps and expected results, not assumptions.
2. Put the test case's version marker (for example [pwg:1f2e...]) at the start of the test title, exactly as given. It is how results from CI attach back to the approved version; without it the run is reported but proves nothing.
3. Prefer reviewed code: if get_approved_automation has an approved version, use it as-is rather than regenerating.
4. Use list_recent_failures to see what is currently failing and why before fixing a test.
5. To write a new test, generate_playwright_test drafts one from the real page; run_playwright_test checks any test on the live page and shows the failing step with the page tree, so fix and run again until it passes.
6. When behaviour has no test case yet, use propose_test_case (with the Playwright code you wrote, if any). To send code for an existing test case, use submit_playwright_code.
You can propose and send code, but not approve: a person reviews everything in PlaywrightGen before it counts.`;

type JsonRpcId = string | number;
type JsonRpcRequest = { jsonrpc: "2.0"; id?: JsonRpcId | null; method: string; params?: unknown };
type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId | null; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId | null; error: { code: number; message: string } };

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, boolean>;
  run: (session: EditorSession, args: unknown) => Promise<ToolResult>;
};

function text(value: string, structured?: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text: value }], ...(structured ? { structuredContent: structured } : {}) };
}

function toolError(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
/** Adds a draft or code for review; changes nothing approved, deletes nothing. */
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
/** Changes nothing in PlaywrightGen, but opens a public page and uses the daily allowance. */
const USES_ALLOWANCE = { readOnlyHint: true, idempotentHint: false, openWorldHint: true };

/**
 * The free tools over MCP draw on the connected workspace's daily AI allowance
 * -- the same one its members use in the web app -- rather than a per-address
 * limit, since the caller is a known person in a known workspace.
 */
async function reserveWorkspaceAllowance(session: EditorSession) {
  const context = await requireWorkspaceContext(
    { orgSlug: session.orgSlug, projectId: session.projectId, permission: "testcase:create" },
    session.dependencies,
  );
  return reserveOrganizationAiRequest({ organizationId: context.organization.id, surface: "free-tools" });
}

const uuidArg = z.string().uuid();

const tools: Tool[] = [
  {
    name: "project_overview",
    title: "Project overview",
    description:
      "Release readiness for this project: whether it can ship, coverage counts, and the blockers and cautions standing in the way.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async run(session) {
      const readiness = await getReleaseReadiness(
        { orgSlug: session.orgSlug, projectId: session.projectId },
        session.dependencies,
      );
      const lines = [
        `Project: ${readiness.project.name}`,
        `Releasable: ${readiness.releasable ? "yes" : "no"}`,
        `Approved requirements: ${readiness.counts.approvedRequirements} (${readiness.counts.requirementsWithApprovedTests} with an approved test)`,
        `Approved test cases: ${readiness.counts.approvedTestCases} (${readiness.counts.testCasesWithCurrentAutomation} with current automation)`,
        `Regressions: ${readiness.counts.regressions} · Flaky: ${readiness.counts.flaky} · Open findings: ${readiness.counts.openFindings}`,
        `Recorded attempts: ${readiness.evidence.attemptCount}`,
        "",
        readiness.findings.length ? "Findings:" : "No findings.",
        ...readiness.findings.map(
          (finding) => `- [${finding.severity}] ${finding.title} (${finding.count}): ${finding.detail}`,
        ),
      ];
      return text(lines.join("\n"), {
        releasable: readiness.releasable,
        counts: readiness.counts,
        findings: readiness.findings.map(({ severity, code, title, detail, count }) => ({
          severity, code, title, detail, count,
        })),
      });
    },
  },
  {
    name: "list_test_cases",
    title: "List test cases",
    description:
      "Test cases in this project with their review status, current version and automation status. Approved ones are the agreed behaviour to test against.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Words from the title." },
        status: {
          type: "string",
          enum: ["APPROVED", "IN_REVIEW", "DRAFT"],
          description: "Only test cases in this review state.",
        },
        page: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
    async run(session, args) {
      const input = z
        .object({
          search: z.string().max(200).optional(),
          status: z.enum(["APPROVED", "IN_REVIEW", "DRAFT"]).optional(),
          page: z.number().int().positive().optional(),
        })
        .parse(args ?? {});
      const result = await listTestCases(
        {
          orgSlug: session.orgSlug,
          projectId: session.projectId,
          search: input.search,
          page: input.page,
          pageSize: 100,
        },
        session.dependencies,
      );
      const items = result.items
        .filter((item) => !input.status || item.status === input.status)
        .map((item) => ({
          id: item.id,
          title: item.title,
          status: item.status,
          version: item.currentVersionNumber,
          automationStatus: item.automationStatus,
          priority: item.priority,
        }));
      const body = items.length
        ? items
            .map(
              (item) =>
                `- ${item.title}\n  id: ${item.id} · ${item.status} · v${item.version} · automation ${item.automationStatus.toLowerCase()} · ${item.priority.toLowerCase()} priority`,
            )
            .join("\n")
        : "No test cases match.";
      return text(`${body}\n\nPage ${result.page} of ${result.pageCount}.`, {
        testCases: items,
        page: result.page,
        pageCount: result.pageCount,
      });
    },
  },
  {
    name: "get_test_case",
    title: "Get a test case",
    description:
      "The current version of one test case: objective, preconditions, steps, expected results, linked requirements, and the version marker to put in the Playwright test title.",
    inputSchema: {
      type: "object",
      properties: { testCaseId: { type: "string", description: "Id from list_test_cases." } },
      required: ["testCaseId"],
      additionalProperties: false,
    },
    async run(session, args) {
      const { testCaseId } = z.object({ testCaseId: uuidArg }).parse(args);
      const { testCase } = await getTestCaseDetail(
        { orgSlug: session.orgSlug, projectId: session.projectId, testCaseId },
        session.dependencies,
      );
      const current = testCase.versions.find(
        (version) => version.versionNumber === testCase.currentVersionNumber,
      );
      if (!current) return toolError("This test case has no current version.");
      const steps = readTestCaseList(current.steps);
      const expected = readTestCaseList(current.expectedResults);
      const marker = buildTestCaseVersionMarker(current.id);
      const approvedNote =
        testCase.status === "APPROVED"
          ? "This version is approved."
          : `This version is ${testCase.status.replace("_", " ").toLowerCase()}, not approved: results against it will not count as approved coverage.`;
      const body = [
        `# ${current.title}`,
        `Status: ${testCase.status} · Version ${current.versionNumber} · ${current.priority} priority · ${current.type}`,
        approvedNote,
        `Version marker for the test title: ${marker}`,
        "",
        `Objective: ${current.objective || "(none)"}`,
        current.preconditions ? `Preconditions: ${current.preconditions}` : null,
        "",
        "Steps:",
        ...steps.map((step, index) => `${index + 1}. ${step}`),
        "",
        "Expected results:",
        ...expected.map((result) => `- ${result}`),
        testCase.requirementLinks.length ? "" : null,
        testCase.requirementLinks.length ? "Verifies requirements:" : null,
        ...testCase.requirementLinks.map(
          (link) => `- ${link.requirement.title} (${link.requirement.status})`,
        ),
      ]
        .filter((line) => line !== null)
        .join("\n");
      return text(body, {
        id: testCase.id,
        status: testCase.status,
        versionId: current.id,
        versionNumber: current.versionNumber,
        marker,
        title: current.title,
        objective: current.objective,
        preconditions: current.preconditions,
        steps,
        expectedResults: expected,
        requirements: testCase.requirementLinks.map((link) => ({
          id: link.requirement.id,
          title: link.requirement.title,
          status: link.requirement.status,
        })),
      });
    },
  },
  {
    name: "list_approved_automation",
    title: "List approved automation",
    description:
      "Playwright automation in this project that a person has reviewed and approved, with the test case each one covers.",
    inputSchema: {
      type: "object",
      properties: { search: { type: "string", description: "Words from the name or test case title." } },
      additionalProperties: false,
    },
    async run(session, args) {
      const { search } = z.object({ search: z.string().max(200).optional() }).parse(args ?? {});
      const result = await listAutomationArtifacts(
        { orgSlug: session.orgSlug, projectId: session.projectId, search, pageSize: 100 },
        session.dependencies,
      );
      const items = result.items
        .filter((item) => item.approvedVersionNumber !== null)
        .map((item) => ({
          id: item.id,
          name: item.name,
          engine: item.engine,
          testCaseId: item.testCase.id,
          testCaseTitle: item.testCase.title,
          approvedVersion: item.approvedVersionNumber,
          suggestedPath: suggestedPath(item.testCase.title),
        }));
      const body = items.length
        ? items
            .map(
              (item) =>
                `- ${item.name}\n  id: ${item.id} · covers "${item.testCaseTitle}" · approved v${item.approvedVersion} · ${item.suggestedPath}`,
            )
            .join("\n")
        : "No automation has been approved in this project yet.";
      return text(body, { automation: items });
    },
  },
  {
    name: "get_approved_automation",
    title: "Get approved automation",
    description:
      "The approved Playwright code for one automation artifact, ready to save into the repository unchanged, with any configuration and dependencies it needs.",
    inputSchema: {
      type: "object",
      properties: {
        automationArtifactId: { type: "string", description: "Id from list_approved_automation." },
      },
      required: ["automationArtifactId"],
      additionalProperties: false,
    },
    async run(session, args) {
      const { automationArtifactId } = z.object({ automationArtifactId: uuidArg }).parse(args);
      const { artifact } = await getAutomationArtifactDetail(
        { orgSlug: session.orgSlug, projectId: session.projectId, automationArtifactId },
        session.dependencies,
      );
      const approved = artifact.versions.find(
        (version) => version.versionNumber === artifact.approvedVersionNumber,
      );
      if (!approved) {
        return toolError(
          "This automation has no approved version yet. It has to be reviewed and approved in PlaywrightGen first.",
        );
      }
      const path = suggestedPath(artifact.testCase.title);
      const stale =
        artifact.testCase.currentVersionNumber !== artifact.testCaseVersion.versionNumber
          ? `Warning: this automation covers test case version ${artifact.testCaseVersion.versionNumber}, and the test case is now at version ${artifact.testCase.currentVersionNumber}. Its results will describe the older behaviour.`
          : null;
      const body = [
        `Approved version ${approved.versionNumber} of "${artifact.name}". Save it unchanged, keeping the [pwg:...] marker in the test title.`,
        `Suggested path: ${path}`,
        stale,
        approved.dependencies.length ? `Dependencies: ${approved.dependencies.join(", ")}` : null,
        "",
        "```ts",
        approved.code,
        "```",
        approved.configuration ? `\nConfiguration:\n\`\`\`ts\n${approved.configuration}\n\`\`\`` : null,
      ]
        .filter((line) => line !== null)
        .join("\n");
      return text(body, {
        id: artifact.id,
        approvedVersion: approved.versionNumber,
        suggestedPath: path,
        code: approved.code,
        configuration: approved.configuration,
        dependencies: approved.dependencies,
        coversCurrentTestCaseVersion: stale === null,
      });
    },
  },
  {
    name: "list_recent_failures",
    title: "List recent failures",
    description:
      "The most recent failed or blocked test attempts in this project, with the failure output, so a broken test can be fixed against what actually happened.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 25 } },
      additionalProperties: false,
    },
    async run(session, args) {
      const { limit } = z
        .object({ limit: z.number().int().min(1).max(25).optional() })
        .parse(args ?? {});
      const context = await requireWorkspaceContext(
        { projectId: session.projectId, permission: "testrun:read" },
        session.dependencies,
      );
      const attempts = await session.dependencies.prisma.testRunAttempt.findMany({
        where: {
          organizationId: context.organization.id,
          projectId: session.projectId,
          result: { in: ["FAILED", "BLOCKED"] },
        },
        orderBy: [{ executedAt: "desc" }, { id: "desc" }],
        take: limit ?? 10,
        select: {
          id: true,
          result: true,
          executedAt: true,
          commitSha: true,
          browser: true,
          failureDetails: true,
          testRun: {
            select: { id: true, name: true, testCase: { select: { id: true, title: true } } },
          },
        },
      });
      if (attempts.length === 0) return text("Nothing has failed recently.", { failures: [] });
      const failures = attempts.map((attempt) => ({
        attemptId: attempt.id,
        result: attempt.result,
        executedAt: attempt.executedAt.toISOString(),
        commitSha: attempt.commitSha,
        browser: attempt.browser,
        testRunName: attempt.testRun.name,
        testCaseId: attempt.testRun.testCase.id,
        testCaseTitle: attempt.testRun.testCase.title,
        failureDetails: attempt.failureDetails.slice(0, 4_000),
      }));
      const body = failures
        .map(
          (failure) =>
            `## ${failure.testCaseTitle} — ${failure.result.toLowerCase()} ${failure.executedAt}${failure.commitSha ? ` @ ${failure.commitSha.slice(0, 7)}` : ""}\ntest case id: ${failure.testCaseId}\n${failure.failureDetails || "(no failure output recorded)"}`,
        )
        .join("\n\n");
      return text(body, { failures });
    },
  },
  {
    name: "generate_playwright_test",
    title: "Generate a Playwright test",
    description:
      "Write a Playwright test draft for described behaviour. When pageUrl is a public page, PlaywrightGen opens it and builds locators from its real accessibility tree. Returns the code, the plan, and which locators could not be confirmed on the page. Uses one request from the workspace's daily AI allowance. Next, check it with run_playwright_test.",
    annotations: USES_ALLOWANCE,
    inputSchema: {
      type: "object",
      properties: {
        request: { type: "string", description: "The behaviour to test and what should happen." },
        pageUrl: { type: "string", description: "Public URL of the page the test starts on (recommended)." },
        api: { type: "boolean", description: "Write an API test with the request fixture instead of a browser test." },
        depth: { type: "string", enum: ["FOCUSED", "EXPANDED"], description: "EXPANDED adds negative and edge cases." },
      },
      required: ["request"],
      additionalProperties: false,
    },
    async run(session, args) {
      const input = z
        .object({
          request: z.string().trim().min(1).max(30_000),
          pageUrl: z.string().trim().max(2_000).optional(),
          api: z.boolean().optional(),
          depth: z.enum(["FOCUSED", "EXPANDED"]).optional(),
        })
        .parse(args);
      if (input.pageUrl && !isPublicWebAddress(input.pageUrl)) {
        return toolError("pageUrl must be a public web address (not localhost or a private network).");
      }
      const allowance = await reserveWorkspaceAllowance(session);
      const mode = input.api ? "API" : "FLOW";
      const snapshot = input.pageUrl && mode !== "API" ? await capturePageSnapshot(input.pageUrl) : null;
      const draft = await generateQuickDraft({
        mode,
        request: input.request,
        pageUrl: input.pageUrl ?? "",
        depth: input.depth ?? "FOCUSED",
        fileContext: "",
        imageDataUrls: [],
        pageSnapshot: snapshot?.ok ? snapshot : null,
      });
      const pageLine = !input.pageUrl
        ? "No page was given, so every locator is a best guess."
        : snapshot?.ok
          ? `Read the live page "${snapshot.title}" (${snapshot.counts.buttons} buttons, ${snapshot.counts.fields} fields, ${snapshot.counts.links} links).${draft.locatorCheck ? ` ${draft.locatorCheck.found} of ${draft.locatorCheck.checked} named locators match it.` : ""}`
          : `The page could not be opened (${snapshot?.ok === false ? snapshot.reason : "not read"}), so locators are best guesses.`;
      const unverified = [...new Set([...(draft.locatorCheck?.notFound ?? []), ...draft.unverifiedLocators])].slice(0, 20);
      const body = [
        `# ${draft.title}`,
        draft.summary,
        pageLine,
        "",
        "Plan:",
        ...draft.testPlan.map((item, index) => `${index + 1}. ${item.scenario}: ${item.intent} (expect: ${item.expectedOutcome})`),
        unverified.length ? `\nConfirm these locators, which were not on the page read: ${unverified.join(", ")}` : null,
        draft.warnings.length ? `\nWarnings: ${draft.warnings.join(" ")}` : null,
        "",
        "```ts",
        draft.code,
        "```",
        "",
        input.pageUrl && mode !== "API"
          ? `Not run yet. Check it with run_playwright_test (pageUrl: ${snapshot?.ok ? snapshot.finalUrl : input.pageUrl}).`
          : "Not run yet.",
        `Workspace AI requests left today: ${allowance.dailyRemaining}.`,
      ]
        .filter((line) => line !== null)
        .join("\n");
      return text(body, {
        title: draft.title,
        code: draft.code,
        plan: draft.testPlan,
        pageRead: Boolean(snapshot?.ok),
        pageUrl: snapshot?.ok ? snapshot.finalUrl : input.pageUrl ?? null,
        locatorCheck: draft.locatorCheck,
        unverifiedLocators: unverified,
        warnings: draft.warnings,
        remainingToday: allowance.dailyRemaining,
      });
    },
  },
  {
    name: "run_playwright_test",
    title: "Run a Playwright test on the live page",
    description:
      "Replay a Playwright test step by step in a real remote browser against a public page, and report which step failed, why, and the page's accessibility tree at that moment so the locator can be fixed. The code is read into safe Playwright steps, never executed as code. Pass env for process.env values the test reads, such as a test account; they are used for this run only. A passing run returns a runReceipt to give submit_playwright_code. Uses one request from the workspace's daily AI allowance.",
    annotations: USES_ALLOWANCE,
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "The full Playwright test file." },
        pageUrl: { type: "string", description: "Public base URL relative page.goto paths resolve against." },
        env: { type: "object", additionalProperties: { type: "string" }, description: "Values for process.env names the test reads." },
      },
      required: ["code", "pageUrl"],
      additionalProperties: false,
    },
    async run(session, args) {
      const input = z
        .object({ code: z.string().min(1).max(100_000), pageUrl: z.string().trim().min(1).max(2_000), env: runEnvSchema.optional() })
        .parse(args);
      const prepared = prepareLiveRun(input);
      if (!prepared.ok) return toolError(prepared.error);
      const allowance = await reserveWorkspaceAllowance(session);
      const { result, receipt } = await executeLiveRun(prepared.run);
      const verdict = runVerdict(result);
      const icon = { passed: "✓", failed: "✗", skipped: "–", not_reached: "·" } as const;
      const lines: string[] = [
        verdict === "passed"
          ? `Passed on the live page: ${result.counts.passed} checks in ${Math.round(result.durationMs / 1000)}s.`
          : verdict === "partial"
            ? `Nothing failed, but not every step ran: ${result.counts.passed} passed, ${result.counts.skipped} not run in the preview, ${result.counts.notReached} not reached${result.timedOut ? " (time limit)" : ""}.`
            : `Failed: ${result.counts.passed} passed, ${result.counts.failed} failed, ${result.counts.notReached} not reached.`,
      ];
      for (const test of result.tests) {
        lines.push("", `## ${test.name} — ${test.status}`);
        for (const step of test.steps) {
          lines.push(`${step.name}:`);
          for (const operation of step.operations) {
            lines.push(`  ${icon[operation.status]} ${operation.source}${operation.detail && operation.status !== "passed" ? ` — ${operation.detail}` : ""}`);
          }
        }
        if (test.failureSnapshot) {
          lines.push("", "Page at the failure (accessibility tree; fix the locator from it, then run again):", test.failureSnapshot.slice(0, 6_000));
        }
      }
      if (receipt && verdict !== "failed") {
        lines.push("", `runReceipt (give it to submit_playwright_code with this exact code): ${receipt}`);
      }
      lines.push("", `Workspace AI requests left today: ${allowance.dailyRemaining}.`);
      return text(lines.join("\n"), {
        verdict,
        counts: result.counts,
        durationMs: result.durationMs,
        timedOut: result.timedOut,
        // Screenshots are large images an agent cannot use; the page tree is enough.
        tests: result.tests.map((test) => ({ ...test, failureScreenshot: undefined })),
        runReceipt: verdict === "failed" ? null : receipt,
        remainingToday: allowance.dailyRemaining,
      });
    },
  },
  {
    name: "prove_playwright_test",
    title: "Write a Playwright test and make it pass",
    description:
      "The whole loop in one call: write a test for described behaviour from the real page, run it in a remote browser, fix the failing step from the page as it was, and run again until it passes or the fix budget runs out. Returns the code, what happened in each round, and a runReceipt when it passed, which propose_test_case accepts as evidence. Uses one request from the workspace's daily AI allowance, plus one per fix.",
    annotations: USES_ALLOWANCE,
    inputSchema: {
      type: "object",
      properties: {
        request: { type: "string", description: "The behaviour to test and what should happen." },
        pageUrl: { type: "string", description: "Public URL of the page the test starts on." },
        env: { type: "object", additionalProperties: { type: "string" }, description: "Values for process.env names the test needs, such as a test account. Used for these runs only." },
        maxFixes: { type: "integer", minimum: 0, maximum: 3, description: "AI fixes to allow. Default 2." },
      },
      required: ["request", "pageUrl"],
      additionalProperties: false,
    },
    async run(session, args) {
      const input = z
        .object({
          request: z.string().trim().min(1).max(30_000),
          pageUrl: z.string().trim().min(1).max(2_000),
          env: runEnvSchema.optional(),
          maxFixes: z.number().int().min(0).max(3).optional(),
        })
        .parse(args);
      if (!isPublicWebAddress(input.pageUrl)) {
        return toolError("pageUrl must be a public web address (not localhost or a private network).");
      }

      // One request for the draft; each fix costs another. Runs are bounded by
      // the loop itself, so they are not charged separately here.
      const allowance = await reserveWorkspaceAllowance(session);
      const rounds: ProveRound[] = [];
      let pageRead = false;
      let pageTreeAtStart: string | undefined;
      let runPageUrl = input.pageUrl;
      let title = "";

      const outcome = await proveDraftOnLivePage(
        {
          report: (round) => rounds.push(round),
          generate: async () => {
            const snapshot = await capturePageSnapshot(input.pageUrl);
            pageRead = snapshot.ok;
            if (snapshot.ok) {
              pageTreeAtStart = snapshot.aria.slice(0, 4_000);
              runPageUrl = snapshot.finalUrl;
            }
            const draft = await generateQuickDraft({
              mode: "FLOW",
              request: input.request,
              pageUrl: input.pageUrl,
              depth: "FOCUSED",
              fileContext: "",
              imageDataUrls: [],
              pageSnapshot: snapshot.ok ? snapshot : null,
            });
            title = draft.title;
            return { ok: true as const, code: draft.code, title: draft.title, payload: draft };
          },
          run: async (code) => {
            const prepared = prepareLiveRun({ code, pageUrl: runPageUrl, env: input.env });
            if (!prepared.ok) return { ok: false as const, limit: false, message: prepared.error };
            const { result, receipt } = await executeLiveRun(prepared.run);
            return {
              ok: true as const,
              verdict: runVerdict(result),
              passed: result.counts.passed,
              failed: result.counts.failed,
              skipped: result.counts.skipped + result.counts.notReached,
              receipt,
              failure: firstFailureOf(result),
              payload: result,
            };
          },
          fix: async (code, failure) => {
            try {
              await reserveWorkspaceAllowance(session);
            } catch (error) {
              if (error instanceof OrganizationAiRateLimitError) {
                return { ok: false as const, limit: true, message: describeToolFailure(error) };
              }
              throw error;
            }
            const repaired = await repairDraft({
              code,
              pageUrl: runPageUrl,
              failure: { step: failure.step, line: failure.line, reason: failure.reason },
              pageTreeAtFailure: failure.pageTree,
              ...(pageTreeAtStart ? { pageTreeAtStart } : {}),
              ...(failure.skippedEarlier.length ? { skippedEarlier: failure.skippedEarlier } : {}),
            });
            return { ok: true as const, code: repaired.code, explanation: repaired.explanation, payload: repaired };
          },
        },
        { maxFixes: input.maxFixes ?? 2 },
      );

      const history = rounds.flatMap((round) => {
        if (round.kind === "generated") return [`Wrote "${round.title}"${pageRead ? " from the live page" : " (the page could not be read, so locators are guesses)"}.`];
        if (round.kind === "ran") {
          return [
            round.verdict === "passed"
              ? `Run ${round.attempt}: passed, ${round.passed} checks.`
              : round.verdict === "partial"
                ? `Run ${round.attempt}: nothing failed, ${round.skipped} steps could not run here.`
                : `Run ${round.attempt}: failed at "${round.failingStep ?? "a step"}" after ${round.passed} checks.`,
          ];
        }
        if (round.kind === "fixed") return [`Fixed: ${round.explanation}`];
        return [];
      });
      const lastRun = outcome.lastRun as { counts?: { passed: number } } | null;
      const verdictLine =
        outcome.verdict === "passed"
          ? `Passed on the live page: ${lastRun?.counts?.passed ?? 0} checks.`
          : outcome.verdict === "partial"
            ? "Nothing failed, but some steps could not run in the preview; the rest is unproven."
            : outcome.stopped === "out_of_fixes"
              ? "Still failing after the fixes allowed. The code and the last failure are below; fix it yourself and call run_playwright_test again."
              : `Stopped: ${outcome.message ?? outcome.stopped}.`;

      const failureDetail =
        outcome.verdict === "failed" && lastRun ? firstFailureOf(lastRun as never) : null;
      const body = [
        verdictLine,
        "",
        ...history,
        "",
        "```ts",
        outcome.code ?? "",
        "```",
        failureDetail
          ? `\nStill failing at "${failureDetail.step}": ${failureDetail.line} — ${failureDetail.reason}\n\nPage at the failure:\n${failureDetail.pageTree.slice(0, 4_000)}`
          : null,
        outcome.receipt && outcome.verdict !== "failed"
          ? `\nrunReceipt (give it to propose_test_case with this exact code): ${outcome.receipt}`
          : null,
        `\nWorkspace AI requests left today: ${allowance.dailyRemaining - outcome.fixesUsed}.`,
      ]
        .filter((line) => line !== null)
        .join("\n");

      return text(body, {
        title,
        code: outcome.code,
        verdict: outcome.verdict,
        runs: outcome.runs,
        fixesUsed: outcome.fixesUsed,
        stopped: outcome.stopped,
        pageRead,
        pageUrl: runPageUrl,
        runReceipt: outcome.verdict === "failed" ? null : outcome.receipt,
      });
    },
  },
  {
    name: "propose_test_case",
    title: "Propose a test case",
    description:
      "Create a draft test case in PlaywrightGen for behaviour that has none yet, optionally with the Playwright code you wrote for it and optionally submitted for review. A person on the team reviews and approves it; nothing proposed here counts as approved coverage until then.",
    annotations: WRITE,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "What the test proves, in one line." },
        objective: { type: "string", description: "The behaviour and why it matters." },
        preconditions: { type: "string" },
        steps: { type: "array", items: { type: "string" }, description: "One action per item." },
        expectedResults: { type: "array", items: { type: "string" }, description: "One observable outcome per item." },
        type: { type: "string", enum: ["FUNCTIONAL", "END_TO_END", "API", "INTEGRATION", "REGRESSION"] },
        priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
        playwrightCode: { type: "string", description: "Optional: the full Playwright test file you wrote for it." },
        runReceipt: { type: "string", description: "Optional: runReceipt from run_playwright_test for exactly this code." },
        submitForReview: { type: "boolean", description: "Send it to a reviewer now. Default false." },
      },
      required: ["title", "objective", "steps", "expectedResults"],
      additionalProperties: false,
    },
    async run(session, args) {
      const input = z
        .object({
          title: z.string().trim().min(1).max(300),
          objective: z.string().trim().min(1).max(50_000),
          preconditions: z.string().trim().max(50_000).optional(),
          steps: z.array(z.string().trim().min(1).max(2_000)).min(1).max(200),
          expectedResults: z.array(z.string().trim().min(1).max(2_000)).min(1).max(200),
          type: z.enum(["FUNCTIONAL", "END_TO_END", "API", "INTEGRATION", "REGRESSION"]).optional(),
          priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
          playwrightCode: z.string().min(1).max(100_000).optional(),
          runReceipt: z.string().max(4_000).optional(),
          submitForReview: z.boolean().optional(),
        })
        .parse(args);
      const scope = { orgSlug: session.orgSlug, projectId: session.projectId };
      const created = await createTestCase(
        {
          ...scope,
          title: input.title,
          objective: input.objective,
          preconditions: input.preconditions,
          steps: input.steps,
          expectedResults: input.expectedResults,
          type: input.type,
          priority: input.priority,
          source: "AI_SUGGESTED",
          tags: ["from-editor"],
          automationStatus: input.playwrightCode ? "CANDIDATE" : undefined,
        },
        session.dependencies,
      );
      const notes: string[] = [];
      if (input.playwrightCode) {
        try {
          const attached = await attachEditorCode(
            { ...scope, testCaseId: created.id, code: input.playwrightCode, runReceipt: input.runReceipt },
            session.dependencies,
          );
          notes.push(
            [
              attached.warnings.length ? `Code attached, with warnings: ${attached.warnings.join(" ")}` : "Code attached.",
              evidenceNote(attached.evidence, input.runReceipt),
            ].filter(Boolean).join(" "),
          );
        } catch (error) {
          notes.push(`The test case was created, but the code was not attached: ${describeToolFailure(error)}`);
        }
      }
      let status = "DRAFT";
      if (input.submitForReview) {
        try {
          await submitTestCaseForReview({ ...scope, testCaseId: created.id }, session.dependencies);
          status = "IN_REVIEW";
        } catch (error) {
          notes.push(`It stays a draft: ${describeToolFailure(error)}`);
        }
      }
      const url = testCaseUrl(session, created.id);
      return text(
        [
          `Created "${input.title}" as a ${status === "IN_REVIEW" ? "test case waiting for review" : "draft test case"}.`,
          `id: ${created.id}`,
          `Open: ${url}`,
          ...notes,
          "It is not approved: a person on the team reviews it in PlaywrightGen.",
        ].join("\n"),
        { id: created.id, status, url, codeAttached: Boolean(input.playwrightCode) && notes[0]?.startsWith("Code attached") },
      );
    },
  },
  {
    name: "submit_playwright_code",
    title: "Submit Playwright code for a test case",
    description:
      "Attach the Playwright test you wrote for an existing test case. It waits on the test case in PlaywrightGen until a person turns it into a reviewed automation version; it replaces code sent earlier that has not been used yet. Keep the test case's version marker in the test title.",
    annotations: WRITE,
    inputSchema: {
      type: "object",
      properties: {
        testCaseId: { type: "string", description: "Id from list_test_cases." },
        code: { type: "string", description: "The full Playwright test file." },
        runReceipt: { type: "string", description: "Optional: runReceipt from run_playwright_test for exactly this code." },
      },
      required: ["testCaseId", "code"],
      additionalProperties: false,
    },
    async run(session, args) {
      const input = z
        .object({ testCaseId: uuidArg, code: z.string().min(1).max(100_000), runReceipt: z.string().max(4_000).optional() })
        .parse(args);
      const attached = await attachEditorCode(
        {
          orgSlug: session.orgSlug,
          projectId: session.projectId,
          testCaseId: input.testCaseId,
          code: input.code,
          runReceipt: input.runReceipt,
        },
        session.dependencies,
      );
      const url = testCaseUrl(session, input.testCaseId);
      const next =
        attached.testCaseStatus === "APPROVED"
          ? "A person can now use it as the automation from the test case page, where it is reviewed like any other version."
          : "The test case is not approved yet; once it is, a person can use this code as its automation.";
      return text(
        [
          "Code received.",
          evidenceNote(attached.evidence, input.runReceipt),
          next,
          attached.warnings.length ? `Warnings: ${attached.warnings.join(" ")}` : null,
          `Open: ${url}`,
        ]
          .filter((line) => line !== null)
          .join("\n"),
        {
          testCaseId: input.testCaseId,
          testCaseStatus: attached.testCaseStatus,
          warnings: attached.warnings,
          evidence: attached.evidence ? { verdict: attached.evidence.verdict, passed: attached.evidence.passed } : null,
          url,
        },
      );
    },
  },
];

function evidenceNote(evidence: { verdict: string; passed: number } | null, receipt: string | undefined) {
  if (evidence) {
    return evidence.verdict === "passed"
      ? `Its live run is kept as evidence: passed, ${evidence.passed} checks.`
      : `Its live run is kept as evidence: ${evidence.passed} checks passed, some steps did not run.`;
  }
  return receipt ? "The runReceipt was not for this exact code (or has expired), so no run evidence was kept." : null;
}

function testCaseUrl(session: EditorSession, testCaseId: string) {
  return `${siteUrl()}/workspace/${session.orgSlug}/projects/${session.projectId}/test-cases/${testCaseId}`;
}

function suggestedPath(testCaseTitle: string) {
  return `tests/${slugify(testCaseTitle, "automation")}.spec.ts`;
}

function describeToolFailure(error: unknown): string {
  if (error instanceof z.ZodError) {
    return `Invalid arguments: ${error.issues.map((issue) => `${issue.path.join(".") || "input"} ${issue.message}`).join("; ")}`;
  }
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : null;
  if (error instanceof ImportedDraftError && error.code === "invalid_playwright_code") {
    return `The code is not a usable Playwright test: ${error.detail ?? "check the import and the test body."}`;
  }
  if (code === "test_case_archived") return "That test case is archived.";
  if (error instanceof OrganizationAiRateLimitError) {
    return error.code === "organization_burst_limit"
      ? "Too many requests in a minute; wait a minute and try again."
      : "This workspace has used today's AI allowance. It resets at midnight UTC; the Team plan raises it.";
  }
  if (error instanceof LiveRunUnavailableError) return "Live runs are not available right now; try again shortly.";
  if (code?.endsWith("_not_found")) return "Not found in this project.";
  if (code?.startsWith("invalid_")) return "Some fields are missing or too long.";
  if (code === "permission_denied") return "Your role in this project does not allow that.";
  console.error("[mcp] tool failed", error);
  return "PlaywrightGen could not complete that request.";
}

function negotiateProtocol(requested: unknown) {
  return SUPPORTED_PROTOCOL_VERSIONS.find((version) => version === requested) ??
    SUPPORTED_PROTOCOL_VERSIONS[0];
}

/**
 * Answers one JSON-RPC message. Returns null for notifications, which take no
 * reply.
 */
export async function handleMcpMessage(
  message: unknown,
  session: EditorSession,
): Promise<JsonRpcResponse | null> {
  const parsed = z
    .object({
      jsonrpc: z.literal("2.0"),
      id: z.union([z.string(), z.number()]).nullable().optional(),
      method: z.string(),
      params: z.unknown().optional(),
    })
    .safeParse(message);
  if (!parsed.success) {
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } };
  }
  const request = parsed.data as JsonRpcRequest;
  const isNotification = request.id === undefined || request.id === null;
  const id = request.id ?? null;
  const reply = (result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, messageText: string): JsonRpcResponse => ({
    jsonrpc: "2.0",
    id,
    error: { code, message: messageText },
  });

  if (isNotification) return null;

  switch (request.method) {
    case "initialize": {
      const params = (request.params ?? {}) as { protocolVersion?: unknown };
      return reply({
        protocolVersion: negotiateProtocol(params.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: `${INSTRUCTIONS}\n\nConnected project: ${session.projectName}.`,
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({
        tools: tools.map(({ name, title, description, inputSchema, annotations }) => ({
          name,
          title,
          description,
          inputSchema,
          annotations: { title, ...(annotations ?? READ_ONLY) },
        })),
      });
    case "tools/call": {
      const params = z
        .object({ name: z.string(), arguments: z.unknown().optional() })
        .safeParse(request.params);
      if (!params.success) return fail(-32602, "Invalid params");
      const tool = tools.find((candidate) => candidate.name === params.data.name);
      if (!tool) return fail(-32602, `Unknown tool: ${params.data.name}`);
      try {
        return reply(await tool.run(session, params.data.arguments));
      } catch (error) {
        // Tool failures are results the model can read and act on, not
        // protocol errors that end the conversation.
        return reply(toolError(describeToolFailure(error)));
      }
    }
    case "resources/list":
      return reply({ resources: [] });
    case "prompts/list":
      return reply({ prompts: [] });
    default:
      return fail(-32601, `Method not found: ${request.method}`);
  }
}
