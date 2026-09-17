import "server-only";

import { z } from "zod";

import { connectRemoteBrowser, isPublicWebAddress } from "@/lib/free-tools/page-snapshot";
import { executePreviewRun, type PreviewRunResult } from "@/lib/free-tools/preview-run/execute";
import { planPreviewRun, type RunPlan } from "@/lib/free-tools/preview-run/plan";
import { readRunReceiptSecret, signRunReceipt } from "@/lib/free-tools/preview-run/receipt";

/**
 * One live run of a draft, shared by the free tools page and the MCP server.
 *
 * Checking the input is separate from running it, so a caller can refuse a bad
 * request before spending an allowance on it.
 */

/**
 * Values for process.env names a draft reads, such as a test account, for one
 * run only. Used as step values in the remote browser; never stored, logged,
 * or returned.
 */
export const runEnvSchema = z
  .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/), z.string().max(500))
  .refine((value) => Object.keys(value).length <= 10, "At most 10 values.");

export type PreparedRun = { code: string; pageUrl: string; env: Record<string, string>; plan: RunPlan };

export function prepareLiveRun(input: {
  code: string;
  pageUrl: string;
  env?: Record<string, string>;
}): { ok: true; run: PreparedRun } | { ok: false; error: string } {
  if (!isPublicWebAddress(input.pageUrl)) return { ok: false, error: "Only public web addresses can be opened." };
  const env = input.env ?? {};
  const plan = planPreviewRun(input.code, { env });
  if (plan.tests.length === 0) return { ok: false, error: "No Playwright test was found in the draft." };
  return { ok: true, run: { code: input.code, pageUrl: input.pageUrl, env, plan } };
}

export class LiveRunUnavailableError extends Error {
  constructor() {
    super("live_run_unavailable");
    this.name = "LiveRunUnavailableError";
  }
}

/** Blanks supplied values (a test account) out of everything the run reports back. */
export function redactSupplied(result: PreviewRunResult, values: string[]): PreviewRunResult {
  const secrets = values.filter((value) => value.length >= 3);
  if (!secrets.length) return result;
  const clean = (text: string | undefined) =>
    text === undefined ? text : secrets.reduce((current, secret) => current.split(secret).join("•••"), text);
  return {
    ...result,
    tests: result.tests.map((test) => ({
      ...test,
      failureSnapshot: clean(test.failureSnapshot),
      steps: test.steps.map((step) => ({
        ...step,
        operations: step.operations.map((operation) => ({ ...operation, detail: clean(operation.detail) })),
      })),
    })),
  };
}

/**
 * Replays the draft in the remote browser. The receipt is signed proof of this
 * outcome for this exact code, so a test that passed keeps its evidence when it
 * is brought into a project.
 */
export async function executeLiveRun(run: PreparedRun): Promise<{ result: PreviewRunResult; receipt: string | null }> {
  const browser = await connectRemoteBrowser().catch(() => null);
  if (!browser) throw new LiveRunUnavailableError();
  try {
    const result = redactSupplied(
      await executePreviewRun(run.plan, { browser, baseUrl: run.pageUrl, budgetMs: 80_000 }),
      Object.values(run.env),
    );
    const secret = readRunReceiptSecret();
    const receipt = secret
      ? signRunReceipt({ code: run.code, pageUrl: run.pageUrl, result, inputs: Object.keys(run.env) }, secret)
      : null;
    return { result, receipt };
  } finally {
    await browser.close().catch(() => {});
  }
}
