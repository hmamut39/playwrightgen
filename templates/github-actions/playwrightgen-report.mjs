// PlaywrightGen result reporter.
//
// Download this file from your PlaywrightGen project's Repositories tab and
// commit it beside your pipeline definition. The same file serves GitHub
// Actions, GitLab CI and Jenkins; the pipeline says which one it is running
// under through PLAYWRIGHTGEN_PROVIDER.
//
// Reads the Playwright JSON report, keeps only the fields PlaywrightGen records
// as evidence, signs the exact request body with your project token, and posts
// it. No source, environment variables, or artifacts leave your runner.

import { createHmac } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";

/**
 * One line where somebody is already looking.
 *
 * Everything this script says otherwise is in a collapsed step log, several
 * clicks from the run. What a person wants after a push -- was anything
 * recorded, and if not why -- belongs on the page the pipeline shows first.
 * GitHub Actions gives a file for that; GitLab and Jenkins do not, so there
 * it stays on the console. Writing it is best effort either way: a missing or
 * unwritable summary file must never change what is reported.
 */
const summarise = (line) => {
  console.log(`PlaywrightGen: ${line}`);
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try {
    appendFileSync(file, `**PlaywrightGen** -- ${line}\n`);
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
 * because CI systems expose a URL for the artifact as a whole and not for its
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
  // Nothing ran at all, which on a first pipeline means no test has been
  // pasted in yet. Said as that rather than as a failure: the pipeline works.
  summarise(
    "no tests ran, so nothing was reported. Paste the test PlaywrightGen generated into your tests folder -- keep its [pwg:...] title marker, which is what ties a result to the approved version.",
  );
  process.exit(0);
}

// Which CI this ran under. It is recorded with the evidence so a reviewer
// reading an attempt months later can tell where it came from, which starts
// to matter as soon as a team runs more than one pipeline. Defaults to GitHub
// Actions so a workflow written before this existed keeps reporting unchanged.
const PROVIDERS = new Set(["github_actions", "gitlab_ci", "jenkins", "azure_pipelines", "other"]);
const provider = PROVIDERS.has(process.env.PLAYWRIGHTGEN_PROVIDER ?? "")
  ? process.env.PLAYWRIGHTGEN_PROVIDER
  : "github_actions";

const payload = {
  organizationId,
  projectId,
  run: {
    provider,
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

// The endpoint explains both outcomes in a sentence: what a delivery
// recorded, or why it was turned away. A status code and a blob of JSON do
// not tell a build engineer that their token was rotated.
let note = text;
try {
  const parsed = JSON.parse(text);
  if (parsed && typeof parsed.message === "string") note = parsed.message;
} catch {
  // Not JSON; print whatever came back.
}

if (!response.ok) {
  // Reporting is observability, not a gate: a PlaywrightGen outage must not
  // turn a green test suite red.
  summarise(`could not record this run: ${note}`);
  process.exit(0);
}

summarise(note);
