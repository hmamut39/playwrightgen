// PlaywrightGen result reporter.
//
// Copy this file into your repository at .github/workflows/playwrightgen-report.mjs
//
// Reads the Playwright JSON report, keeps only the fields PlaywrightGen records
// as evidence, signs the exact request body with your project token, and posts
// it. No source, environment variables, or artifacts leave your runner.

import { createHmac } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";

/**
 * One line on the run's own page, so the answer is where somebody is looking.
 *
 * Everything this script says otherwise is in a collapsed step log, three
 * clicks from the run. What a person wants to know after a push -- did
 * anything get recorded, and if not why -- belongs on the summary GitHub
 * shows first. Writing it is best effort: a missing or unwritable summary
 * file must never affect the report itself.
 */
const summarise = (line) => {
  console.log(`PlaywrightGen: ${line}`);
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try {
    appendFileSync(file, `**PlaywrightGen** — ${line}\n`);
  } catch {}
};

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

// Where the workflow uploaded playwright-report and test-results, if it did.
// Playwright records local runner paths for traces, screenshots and videos, and
// those paths mean nothing once the runner is gone, so an artifact is only
// worth reporting when there is somewhere durable to point at.
const artifactUrl = (process.env.PLAYWRIGHTGEN_ARTIFACT_URL ?? "").trim();

const attachmentKind = (attachment) => {
  const name = String(attachment.name ?? "").toLowerCase();
  const type = String(attachment.contentType ?? "").toLowerCase();
  if (name.includes("trace") || type === "application/zip") return "TRACE";
  if (name.includes("screenshot") || type.startsWith("image/")) return "SCREENSHOT";
  if (name.includes("video") || type.startsWith("video/")) return "VIDEO";
  if (type.startsWith("text/")) return "LOG";
  return null;
};

/**
 * One entry per kind of artifact this test produced.
 *
 * Every entry points at the uploaded archive rather than at an individual file,
 * because GitHub exposes a URL for the artifact as a whole and not for its
 * contents. The label says so, so a reviewer following the link knows they are
 * downloading an archive to look inside rather than opening the trace itself.
 */
function artifactsFor(result) {
  if (!artifactUrl) return undefined;
  const kinds = new Set();
  for (const attachment of result.attachments ?? []) {
    const kind = attachmentKind(attachment);
    if (kind) kinds.add(kind);
  }
  if (kinds.size === 0) return undefined;

  const label = {
    TRACE: "Trace (in CI artifacts)",
    SCREENSHOT: "Screenshot (in CI artifacts)",
    VIDEO: "Video (in CI artifacts)",
    LOG: "Log (in CI artifacts)",
  };
  return [...kinds].map((kind) => ({ kind, label: label[kind], url: artifactUrl }));
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
      artifacts: artifactsFor(result),
    });
  }
  for (const child of suite.suites ?? []) collect(child, out);
}

const results = [];
for (const suite of report.suites ?? []) collect(suite, results);

if (results.length === 0) {
  // Nothing ran at all, which on a first push means the tests have not been
  // written yet. Said as that rather than as an error: the workflow worked.
  summarise(
    "no tests ran, so nothing was reported. Paste the test PlaywrightGen generated into tests/ -- keep its [pwg:...] title marker, which is what ties a result to the approved version.",
  );
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
  summarise(`could not record this run (${response.status}): ${text.slice(0, 300)}`);
  process.exit(0);
}

summarise(text.slice(0, 500));
