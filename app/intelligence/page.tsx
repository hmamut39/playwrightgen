"use client";

import { GenerationProgress } from "@/components/free-tools/generation-progress";
import { useMemo, useRef, useState } from "react";

import { ResultActions } from "@/components/free-tools/result-actions";
import { WorkspaceHandoffButton } from "@/components/free-tools/workspace-handoff-button";
import type { FreeToolHandoff } from "@/lib/free-tools/handoff";
import { LimitReached, readFreeToolLimit, type FreeToolLimit } from "@/components/free-tools/limit-reached";

type ReviewLens = "COVERAGE" | "FLAKY" | "ARCHITECTURE" | "ASSERTIONS";
type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

type CoverageResult = {
  summary: string;
  evidenceQuality: {
    level: "LOW" | "MEDIUM" | "HIGH";
    suppliedSignals: string[];
    missingSignals: string[];
    limitations: string[];
  };
  findings: {
    category: string;
    severity: Severity;
    title: string;
    evidenceBasis: string;
    whyItMatters: string;
    recommendation: string;
  }[];
  nextTests: {
    title: string;
    priority: Severity;
    rationale: string;
    objective: string;
    expectedOutcome: string;
  }[];
};

const lenses: Array<{ id: ReviewLens; title: string; description: string }> = [
  { id: "COVERAGE", title: "Coverage gaps", description: "Missing business, negative, boundary, regression, role, and accessibility scenarios." },
  { id: "FLAKY", title: "Flaky-test risk", description: "Brittle locators, hard waits, race conditions, shared state, and retry masking." },
  { id: "ARCHITECTURE", title: "Suite architecture", description: "Fixtures, duplication, boundaries, maintainability, and scaling pressure." },
  { id: "ASSERTIONS", title: "Assertion quality", description: "False positives, shallow checks, missing visible outcomes, and weak contracts." },
];

const severityStyles: Record<Severity, string> = {
  LOW: "border-sky-200 bg-sky-50 text-sky-800",
  MEDIUM: "border-amber-200 bg-amber-50 text-amber-800",
  HIGH: "border-orange-200 bg-orange-50 text-orange-800",
  CRITICAL: "border-red-200 bg-red-50 text-red-800",
};

function titleFromInput(requirement: string, pageUrl: string) {
  const firstLine = requirement.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (firstLine) return `Quality review: ${firstLine.slice(0, 240)}`;
  if (pageUrl) return `Quality review: ${pageUrl.slice(0, 240)}`;
  return "Quality review follow-up";
}

type LiveCoveragePage =
  | {
      status: "read";
      url: string;
      title: string;
      counts: { buttons: number; links: number; fields: number; headings: number };
      controls: number;
      surface: {
        total: number;
        mentioned: { role: string; name: string }[];
        unmentioned: { role: string; name: string }[];
      } | null;
    }
  | { status: "not_read"; reason: string };

const LIVE_REASONS: Record<string, string> = {
  blocked_address: "Only public web addresses can be opened (not localhost or private networks).",
  timeout: "The page took too long to load.",
  unreachable: "The page could not be opened.",
  not_configured: "Page reading is not available right now.",
};

/** A public practice site, so the first review runs against a real page. */
const LIVE_EXAMPLE = {
  url: "https://www.saucedemo.com/",
  requirement: `A standard user signs in with a username and password and lands on the products page.

A locked-out user sees an error explaining the account is locked. A wrong password shows an error and keeps the user on the sign-in page.`,
  tests: `import { test, expect } from "@playwright/test";

test("user can log in", async ({ page }) => {
  await page.goto("https://www.saucedemo.com/");
  await page.getByPlaceholder("Username").fill("standard_user");
  await page.locator("#password").fill(process.env.SAUCE_PASSWORD!);
  await page.locator("#login-button").click();
  await page.waitForTimeout(2000);
  expect(page.url()).toContain("inventory");
});`,
};

const exampleRequirement = `A signed-in customer can apply one promotion code at checkout.

The discount is shown as a separate line before tax. An expired or unknown code shows an inline error and leaves the total unchanged. Only one code applies at a time; entering a second replaces the first.`;

const exampleTests = `import { test, expect } from "@playwright/test";

test("applies a promo code", async ({ page }) => {
  await page.goto("/checkout");
  await page.locator("#promo").fill("SAVE10");
  await page.locator("button.apply").click();
  await page.waitForTimeout(2000);
  expect(await page.locator(".total").textContent()).toBeTruthy();
});`;

export default function CoverageReviewPage() {
  const [lens, setLens] = useState<ReviewLens>("COVERAGE");
  const [pageUrl, setPageUrl] = useState("");
  const [requirement, setRequirement] = useState("");
  const [existingTests, setExistingTests] = useState("");
  const [testFile, setTestFile] = useState<File | null>(null);
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [result, setResult] = useState<CoverageResult | null>(null);
  const [livePage, setLivePage] = useState<LiveCoveragePage | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [limit, setLimit] = useState<FreeToolLimit | null>(null);
  const testFileRef = useRef<HTMLInputElement>(null);
  const screenshotRef = useRef<HTMLInputElement>(null);

  const activeLens = useMemo(() => lenses.find((item) => item.id === lens) ?? lenses[0], [lens]);
  const invalidate = () => { setResult(null); setError(""); };

  const analyze = async () => {
    if (!pageUrl.trim() && !requirement.trim() && !existingTests.trim() && !screenshot) {
      setError("Add a requirement, existing test, URL, or screenshot first.");
      return;
    }

    try {
      setLoading(true);
      setLimit(null);
      setError("");
      setResult(null);
      const formData = new FormData();
      formData.set("lens", lens);
      formData.set("pageUrl", pageUrl);
      formData.set("requirement", requirement);
      formData.set("existingTests", existingTests);
      if (screenshot) formData.set("screenshot", screenshot);

      const response = await fetch("/api/coverage-review", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) {
        const reached = readFreeToolLimit(response.status, data);
        setLimit(reached);
        setError(reached ? "" : data.error || "Coverage Review failed.");
        if (typeof data.remaining === "number") setRemaining(data.remaining);
        return;
      }
      setResult(data.result);
      setLivePage(data.livePage ?? null);
      if (typeof data.remaining === "number") setRemaining(data.remaining);
      window.requestAnimationFrame(() => document.getElementById("coverage-result")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch {
      setError("Coverage Review could not reach the service. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handoff: FreeToolHandoff | null = result
    ? {
        version: 1,
        source: "coverage-review",
        target: "REQUIREMENT",
        createdAt: new Date().toISOString(),
        title: titleFromInput(requirement, pageUrl),
        summary: [
          requirement.trim(),
          `Preliminary ${activeLens.title.toLowerCase()} review:\n${result.summary}`,
          result.findings.map((finding) => `[${finding.severity}] ${finding.title}\n${finding.recommendation}`).join("\n\n"),
        ].filter(Boolean).join("\n\n"),
        acceptanceCriteria: result.nextTests.map((item) => `${item.title}: ${item.expectedOutcome}`).join("\n"),
        externalReference: pageUrl.trim() || undefined,
        tags: ["coverage-review", lens.toLowerCase()],
        notice:
          "This creates an AI-suggested Requirement draft so the team can review the finding and decide what becomes approved intent. Preliminary findings are not measured coverage and do not prove release readiness.",
      }
    : null;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <div className="mx-auto max-w-7xl">
        <section className="relative overflow-hidden rounded-[2.25rem] bg-slate-950 px-6 py-10 text-white shadow-xl sm:px-9 sm:py-12 lg:px-12">
          <div className="pointer-events-none absolute left-[-9rem] top-[-12rem] h-80 w-80 rounded-full bg-violet-500/20 blur-3xl" />
          <div className="relative">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">Free Tool · Coverage Review</p>
            <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-[-0.05em] sm:text-5xl lg:text-6xl">Find the next quality gap your evidence can support</h1>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-300">
              Review requirements, Playwright tests, URLs, and UI screenshots through one focused lens. Results separate issue severity from evidence quality and never invent a coverage percentage.
            </p>
          </div>
        </section>

        <section className="mt-8 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
          <div className="flex min-w-max gap-1">
            {lenses.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => { setLens(item.id); invalidate(); }}
                className={`rounded-xl px-4 py-3 text-left text-sm font-semibold transition ${lens === item.id ? "bg-slate-950 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`}
              >
                <span className={`mr-2 text-xs ${lens === item.id ? "text-cyan-300" : "text-slate-400"}`}>0{index + 1}</span>
                {item.title}
              </button>
            ))}
          </div>
        </section>

        <section className="mt-6 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          <div className="border-b border-slate-200 pb-6">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">Active lens</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">{activeLens.title}</h2>
            <p className="mt-2 text-sm text-slate-600">{activeLens.description}</p>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {/* The example buttons sit beside the label, not inside it: a
                <label> names its first labelable descendant, so wrapping
                buttons made the first button carry the whole label as its
                name and left the text box with none. */}
            <div className="text-sm font-semibold text-slate-800">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="coverage-requirement">Requirement or user flow</label>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setLens("COVERAGE");
                    setRequirement(LIVE_EXAMPLE.requirement);
                    setExistingTests(LIVE_EXAMPLE.tests);
                    setPageUrl(LIVE_EXAMPLE.url);
                    invalidate();
                  }}
                  className="rounded-xl border border-slate-900 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
                >
                  Try it on a live page
                </button>
                {/* Reviewing coverage needs two inputs, which is twice the blank
                    page. One click supplies a requirement and a deliberately
                    weak test so the tool has something real to find. */}
                <button
                  type="button"
                  onClick={() => {
                    setRequirement(exampleRequirement);
                    setExistingTests(exampleTests);
                    invalidate();
                  }}
                  className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-cyan-800 transition hover:border-cyan-300 hover:bg-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
                >
                  Use an example
                </button>
              </div>
              </div>
              <textarea id="coverage-requirement" value={requirement} onChange={(event) => { setRequirement(event.target.value); invalidate(); }} rows={7} maxLength={30_000} placeholder="Describe the observable behavior, roles, constraints, and acceptance criteria…" className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm leading-6 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100" />
            </div>
            <label className="text-sm font-semibold text-slate-800">
              Existing Playwright tests
              <textarea value={existingTests} onChange={(event) => { setExistingTests(event.target.value); invalidate(); }} rows={7} maxLength={250_000} placeholder="Paste the tests that currently cover this behavior…" className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 font-mono text-xs leading-6 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100" />
            </label>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_0.9fr_0.9fr]">
            <label className="text-sm font-semibold text-slate-800">
              Page URL <span className="font-normal text-slate-400">(optional &mdash; we open it and compare its controls with your tests)</span>
              <input value={pageUrl} onChange={(event) => { setPageUrl(event.target.value); invalidate(); }} maxLength={2_000} placeholder="https://app.example.com/checkout" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-600" />
            </label>
            <EvidenceUpload label="Test or framework file" detail={testFile?.name} onChoose={() => testFileRef.current?.click()}>
              <input ref={testFileRef} type="file" accept=".ts,.tsx,.js,.jsx,.json,.txt" className="hidden" onChange={async (event) => { const file = event.target.files?.[0] ?? null; if (file && file.size > 250_000) { setError("Keep the test file under 250KB."); return; } setTestFile(file); setExistingTests(file ? await file.text() : ""); invalidate(); }} />
            </EvidenceUpload>
            <EvidenceUpload label="UI screenshot" detail={screenshot?.name} onChoose={() => screenshotRef.current?.click()}>
              <input ref={screenshotRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { const file = event.target.files?.[0] ?? null; if (file && file.size > 2_000_000) { setError("Keep the screenshot under 2MB."); return; } setScreenshot(file); invalidate(); }} />
            </EvidenceUpload>
          </div>

          {limit ? <LimitReached limit={limit} returnTo="/intelligence" /> : null}
          {error ? <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
          <div className="mt-6 flex flex-col gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">{remaining === null ? "Up to 5 successful reviews per day." : `${remaining} successful review${remaining === 1 ? "" : "s"} remaining today.`}</p>
            <button type="button" onClick={analyze} disabled={loading} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-slate-950 px-6 text-sm font-bold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50">{loading ? "Reviewing supplied evidence…" : "Run preliminary review"}</button>
          </div>
        </section>

        {loading ? (
          <GenerationProgress
            message="Reviewing coverage against the requirement"
            steps={[
              "Comparing the supplied tests against the behaviour described",
              "Identifying scenarios that nothing currently exercises",
              "Checking assertions actually prove the stated outcome",
              "Flagging fixed waits and DOM-coupled selectors",
            ]}
          />
        ) : result ? (
          <section id="coverage-result" className="scroll-mt-24 mt-8 space-y-6">
            {livePage ? <LiveCoveragePanel livePage={livePage} /> : null}
            <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
                <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">Preliminary review</p><h2 className="mt-2 text-3xl font-semibold tracking-[-0.035em]">What the supplied evidence suggests</h2><p className="mt-3 max-w-4xl leading-7 text-slate-600">{result.summary}</p></div>
                <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
                  <span className={`w-fit rounded-full border px-3 py-1 text-xs font-bold ${result.evidenceQuality.level === "HIGH" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : result.evidenceQuality.level === "MEDIUM" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-slate-100 text-slate-700"}`}>Evidence quality: {result.evidenceQuality.level.toLowerCase()}</span>
                  <ResultActions content={JSON.stringify(result, null, 2)} filename="playwrightgen-coverage-review.json" copyLabel="Copy report" downloadLabel="Download report" />
                </div>
              </div>
              <div className="mt-7 grid gap-4 md:grid-cols-3">
                <SignalCard title="Supplied" items={result.evidenceQuality.suppliedSignals} tone="emerald" />
                <SignalCard title="Still missing" items={result.evidenceQuality.missingSignals} tone="amber" />
                <SignalCard title="Limitations" items={result.evidenceQuality.limitations} tone="slate" />
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              {result.findings.map((finding, index) => (
                <article key={`${finding.title}-${index}`} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">{finding.category.replaceAll("_", " ")}</p><h3 className="mt-2 text-lg font-semibold text-slate-950">{finding.title}</h3></div><span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${severityStyles[finding.severity]}`}>{finding.severity}</span></div>
                  <div className="mt-5 space-y-4 text-sm leading-6 text-slate-600"><div><p className="font-semibold text-slate-900">Evidence basis</p><p className="mt-1">{finding.evidenceBasis}</p></div><div><p className="font-semibold text-slate-900">Why it matters</p><p className="mt-1">{finding.whyItMatters}</p></div><div className="rounded-xl bg-cyan-50 p-3 text-cyan-950"><p className="font-semibold">Recommended action</p><p className="mt-1">{finding.recommendation}</p></div></div>
                </article>
              ))}
            </div>

            <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-700">Highest-value next tests</p>
              <div className="mt-5 grid gap-4 lg:grid-cols-2">{result.nextTests.map((test, index) => <div key={`${test.title}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-5"><div className="flex justify-between gap-3"><h3 className="font-semibold text-slate-950">{test.title}</h3><span className={`h-fit rounded-full border px-2.5 py-1 text-xs font-bold ${severityStyles[test.priority]}`}>{test.priority}</span></div><p className="mt-3 text-sm leading-6 text-slate-600">{test.rationale}</p><p className="mt-3 text-sm"><span className="font-semibold">Objective:</span> {test.objective}</p><p className="mt-2 text-sm"><span className="font-semibold">Expected:</span> {test.expectedOutcome}</p></div>)}</div>
            </div>

            <div className="rounded-[2rem] border border-cyan-200 bg-cyan-50 p-6 sm:p-8"><div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-800">Turn a finding into team-owned intent</p><h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">Continue as a draft Requirement</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Choose a project, edit the proposed content, and create an AI-suggested draft. A person still decides whether it is correct and worthy of approval.</p></div>{handoff ? <WorkspaceHandoffButton handoff={handoff} className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-bold text-white hover:bg-cyan-700 lg:w-auto">Continue in Workspace →</WorkspaceHandoffButton> : null}</div></div>
          </section>
        ) : (
          /* Rendered nothing before, so the page ended in blank space and gave
             no reason to believe the review would be worth two paste operations. */
          <section className="mt-8 rounded-[2rem] border border-dashed border-slate-300 bg-white p-6 sm:p-8">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
              What this review reports
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-950">
              Gaps you can check, not a score
            </h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {[
                ["Scenarios nothing covers", "Behaviour the requirement describes that no supplied test exercises."],
                ["Weak or missing assertions", "Tests that run without proving the outcome the requirement asks for."],
                ["Brittle patterns", "Fixed waits and DOM-coupled selectors that will fail for reasons unrelated to the product."],
                ["Nothing invented", "Findings come from the text you supply. Missing detail is reported as missing."],
              ].map(([title, detail]) => (
                <div key={title} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
                  <p className="mt-1.5 text-xs leading-5 text-slate-600">{detail}</p>
                </div>
              ))}
            </div>
            <p className="mt-6 text-xs leading-5 text-slate-500">
              No coverage percentage is produced. A number would hide which
              scenarios are actually unverified, which is the only part worth acting on.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}

function EvidenceUpload({ label, detail, onChoose, children }: { label: string; detail?: string; onChoose: () => void; children: React.ReactNode }) {
  return <div><p className="text-sm font-semibold text-slate-800">{label}</p><button type="button" onClick={onChoose} className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-dashed border-cyan-300 bg-cyan-50 px-3 text-sm font-semibold text-cyan-800 hover:bg-cyan-100">{detail || "Choose file"}</button>{children}</div>;
}

function SignalCard({ title, items, tone }: { title: string; items: string[]; tone: "emerald" | "amber" | "slate" }) {
  const tones = { emerald: "border-emerald-200 bg-emerald-50", amber: "border-amber-200 bg-amber-50", slate: "border-slate-200 bg-slate-50" };
  return <div className={`rounded-2xl border p-4 ${tones[tone]}`}><h3 className="text-sm font-semibold text-slate-950">{title}</h3>{items.length ? <ul className="mt-3 space-y-2 text-xs leading-5 text-slate-600">{items.map((item, index) => <li key={`${item}-${index}`} className="flex gap-2"><span>•</span><span>{item}</span></li>)}</ul> : <p className="mt-2 text-xs text-slate-500">None identified.</p>}</div>;
}

/**
 * The real page next to the pasted tests.
 *
 * Every control listed here comes from the page's accessibility tree, and
 * whether a test mentions it is a plain text match computed on the server --
 * not a model's opinion. It is a mention check, so the panel says so.
 */
function LiveCoveragePanel({ livePage }: { livePage: LiveCoveragePage }) {
  if (livePage.status === "not_read") {
    return (
      <p className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-900">
        <span className="font-semibold">We could not open the page, so this review uses your text only.</span>{" "}
        {LIVE_REASONS[livePage.reason] ?? LIVE_REASONS.unreachable}
      </p>
    );
  }
  const surface = livePage.surface;
  return (
    <div className="rounded-[2rem] border border-emerald-200 bg-emerald-50/60 p-6 sm:p-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-800">Read from the live page</p>
          <h2 className="mt-1 truncate text-xl font-semibold text-slate-950">{livePage.title || livePage.url}</h2>
          <p className="mt-1 text-xs text-slate-500">
            {livePage.controls} named controls: {livePage.counts.buttons} buttons, {livePage.counts.fields} fields,{" "}
            {livePage.counts.links} links &middot; seen signed out
          </p>
        </div>
        {surface && surface.total > 0 ? (
          <span
            className={`w-fit shrink-0 rounded-full border bg-white px-3 py-1 text-xs font-bold ${
              surface.unmentioned.length === 0 ? "border-emerald-300 text-emerald-800" : "border-amber-300 text-amber-800"
            }`}
          >
            Your tests target {surface.mentioned.length} of {surface.total} controls by name
          </span>
        ) : null}
      </div>
      {surface && surface.unmentioned.length ? (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-white p-4">
          <p className="text-sm font-semibold text-amber-900">Controls on this page your tests never target by name</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {surface.unmentioned.map((control) => (
              <li key={`${control.role}-${control.name}`} className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs text-amber-900">
                <span className="text-amber-700">{control.role}</span> &ldquo;{control.name}&rdquo;
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-5 text-slate-500">
            Counted from getByRole, getByLabel, getByText and getByPlaceholder in your tests. A control reached only
            by a CSS id or test id is listed here too &mdash; switching it to a role-based locator makes the test
            follow what users see.
          </p>
        </div>
      ) : surface ? (
        <p className="mt-5 text-sm text-emerald-900">Your tests target every named control on this page by name.</p>
      ) : (
        <p className="mt-5 text-sm text-slate-600">Paste your existing tests to see which of these controls they never touch.</p>
      )}
    </div>
  );
}
