// PlaywrightGen result reporter.
//
// Copy this file into your repository at .github/workflows/playwrightgen-report.mjs
//
// Reads the Playwright JSON report, keeps only the fields PlaywrightGen records
// as evidence, signs the exact request body with your project token, and posts
// it. No source, environment variables, or artifacts leave your runner.

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const REPORT_PATH = "playwright-report.json";

const required = (name) => {
  const value = process.env[name];
  if (!value) {
    console.error(`PlaywrightGen: ${name} is not set; skipping report.`);
    process.exit(0);
  }
  return value;
};

const token = required("PLAYWRIGHTGEN_TOKEN");
const organizationId = required("PLAYWRIGHTGEN_ORG_ID");
const projectId = required("PLAYWRIGHTGEN_PROJECT_ID");
const baseUrl = required("PLAYWRIGHTGEN_URL").replace(/\/+$/, "");

let report;
try {
  report = JSON.parse(readFileSync(REPORT_PATH, "utf8"));
} catch (error) {
  console.error(`PlaywrightGen: could not read ${REPORT_PATH}: ${error.message}`);
  process.exit(0);
}

/** Playwright nests specs inside arbitrarily deep suites. */
function collect(suite, out) {
  for (const spec of suite.specs ?? []) {
    const test = spec.tests?.[spec.tests.length - 1];
    const result = test?.results?.[test.results.length - 1];
    if (!result) continue;

    out.push({
      title: spec.title,
      status: result.status ?? "skipped",
      durationMs: Math.max(0, Math.round(result.duration ?? 0)),
      errorMessage: result.error?.message
        ? String(result.error.message).slice(0, 20_000)
        : undefined,
      steps: (result.steps ?? []).slice(0, 200).map((step) => ({
        title: String(step.title).slice(0, 500),
        status: step.error ? "failed" : "passed",
      })),
    });
  }
  for (const child of suite.suites ?? []) collect(child, out);
}

const results = [];
for (const suite of report.suites ?? []) collect(suite, results);

if (results.length === 0) {
  console.log("PlaywrightGen: no test results found; nothing to report.");
  process.exit(0);
}

const payload = {
  organizationId,
  projectId,
  run: {
    provider: "github_actions",
    externalId: process.env.RUN_ID ?? "unknown",
    url: process.env.RUN_URL ?? `${baseUrl}/`,
    commitSha: process.env.COMMIT_SHA ?? "",
    ref: process.env.REF_NAME ?? "unknown",
  },
  environment: process.env.PLAYWRIGHTGEN_ENVIRONMENT ?? "DEVELOPMENT",
  browser: "CHROMIUM",
  baseUrl: process.env.PLAYWRIGHTGEN_BASE_URL ?? null,
  results: results.slice(0, 500),
};

// The signature must cover the exact bytes sent, so serialize once and reuse.
const body = JSON.stringify(payload);
const signature = createHmac("sha256", token).update(body, "utf8").digest("hex");

const headers = {
  "content-type": "application/json",
  "x-playwrightgen-signature": `sha256=${signature}`,
};

// Deployments behind Vercel Deployment Protection reject unauthenticated
// requests before they reach the application. This header only gets the request
// past that edge check; the ingest endpoint still requires a valid HMAC
// signature, so the bypass grants reachability, never authority.
if (process.env.VERCEL_PROTECTION_BYPASS) {
  headers["x-vercel-protection-bypass"] = process.env.VERCEL_PROTECTION_BYPASS;
  headers["x-vercel-set-bypass-cookie"] = "false";
}

const response = await fetch(`${baseUrl}/api/runs/ingest`, {
  method: "POST",
  headers,
  body,
});

const text = await response.text();
if (!response.ok) {
  // Reporting is observability, not a gate: a PlaywrightGen outage must not
  // turn a green test suite red.
  console.error(`PlaywrightGen: ingest returned ${response.status}: ${text}`);
  process.exit(0);
}

console.log(`PlaywrightGen: ${text}`);
