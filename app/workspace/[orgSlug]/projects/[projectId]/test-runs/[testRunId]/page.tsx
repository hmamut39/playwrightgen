import { revalidatePath } from "next/cache";
import Link from "next/link";

import {
  listFailureAnalyses,
  resolveFailureFinding,
  runFailureAnalysis,
} from "@/lib/services/failure-intelligence";
import { RunSignalExplanation } from "@/components/workspace/run-signal-badge";
import { getProjectRunSignals } from "@/lib/services/run-signals";
import { readTestCaseList } from "@/lib/services/test-cases";
import {
  cancelTestRun,
  getTestRunDetail,
  readEvidence,
  readStepResults,
  recordTestRunAttempt,
} from "@/lib/services/test-runs";

const resultStyle = {
  NOT_STARTED: "bg-slate-100 text-slate-700", PASSED: "bg-emerald-50 text-emerald-700",
  FAILED: "bg-red-50 text-red-700", BLOCKED: "bg-amber-50 text-amber-800",
  CANCELED: "bg-slate-100 text-slate-500",
} as const;

/**
 * Evidence chips are styled by kind because a trace, a screenshot and a link to
 * a workflow are used for different things. Rendered identically, a reviewer has
 * to click each one to discover what it is, which is the opposite of what
 * evidence attached to a failure is for.
 */
const evidenceStyle: Record<string, { chip: string; glyph: string }> = {
  TRACE: { chip: "border-violet-300 bg-violet-50 text-violet-800", glyph: "◴" },
  SCREENSHOT: { chip: "border-sky-300 bg-sky-50 text-sky-800", glyph: "▣" },
  VIDEO: { chip: "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-800", glyph: "▶" },
  LOG: { chip: "border-slate-300 bg-slate-50 text-slate-700", glyph: "≡" },
  LINK: { chip: "border-slate-300 bg-white text-cyan-700", glyph: "↗" },
};

export default async function TestRunDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectId: string; testRunId: string }>;
}) {
  const { orgSlug, projectId, testRunId } = await params;
  const [detail, analyses, signals] = await Promise.all([
    getTestRunDetail({ orgSlug, projectId, testRunId }),
    listFailureAnalyses({ orgSlug, projectId, testRunId }),
    getProjectRunSignals({ orgSlug, projectId }),
  ]);
  const { testRun } = detail;
  const runSignal = signals.get(testRun.id);
  const path = `/workspace/${orgSlug}/projects/${projectId}/test-runs/${testRunId}`;
  const listPath = `/workspace/${orgSlug}/projects/${projectId}/test-runs`;
  const steps = readTestCaseList(testRun.testCaseVersion.steps);
  const expectedResults = readTestCaseList(testRun.testCaseVersion.expectedResults);

  async function recordAction(formData: FormData) {
    "use server";
    const evidence = String(formData.get("evidence") ?? "").split(/\r?\n/).map((url) => url.trim()).filter(Boolean).map((url, index) => ({ kind: "LINK" as const, label: `Evidence ${index + 1}`, url }));
    const stepResults = steps.map((_, index) => ({
      stepIndex: index,
      result: String(formData.get(`step-${index}-result`) ?? "SKIPPED") as "PASSED" | "FAILED" | "BLOCKED" | "SKIPPED",
      notes: String(formData.get(`step-${index}-notes`) ?? ""),
    }));
    const durationSeconds = Number(formData.get("durationSeconds"));
    await recordTestRunAttempt({
      orgSlug, projectId, testRunId,
      expectedAttemptNumber: Number(formData.get("expectedAttemptNumber")),
      result: String(formData.get("result")) as "PASSED" | "FAILED" | "BLOCKED",
      durationMs: Number.isFinite(durationSeconds) && durationSeconds >= 0 ? Math.round(durationSeconds * 1000) : null,
      summary: String(formData.get("summary") ?? ""),
      failureDetails: String(formData.get("failureDetails") ?? ""),
      stepResults,
      evidence,
    });
    revalidatePath(path); revalidatePath(listPath);
  }
  async function cancelAction() {
    "use server";
    await cancelTestRun({ orgSlug, projectId, testRunId });
    revalidatePath(path); revalidatePath(listPath);
  }
  async function analyzeFailureAction(formData: FormData) {
    "use server";
    await runFailureAnalysis({
      orgSlug,
      projectId,
      testRunId,
      testRunAttemptId: String(formData.get("testRunAttemptId") ?? ""),
    });
    revalidatePath(path);
  }
  async function resolveFindingAction(formData: FormData) {
    "use server";
    const resolution = formData.get("resolution");
    if (resolution !== "CONFIRMED" && resolution !== "DISMISSED") {
      throw new Error("Invalid failure finding resolution");
    }
    await resolveFailureFinding({
      orgSlug,
      projectId,
      testRunId,
      findingId: String(formData.get("findingId") ?? ""),
      resolution,
    });
    revalidatePath(path);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Link href={listPath} className="text-sm font-medium text-cyan-700 hover:text-cyan-900">← Test Runs</Link>
      <header className="mt-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${resultStyle[testRun.status]}`}>{testRun.status.replace("_", " ")}</span><span className="text-xs text-slate-400">{testRun.latestAttemptNumber} attempts</span></div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">{testRun.name}</h1>
          {runSignal ? <RunSignalExplanation signal={runSignal.signal} detail={runSignal.detail} /> : null}
          <p className="mt-3 text-sm text-slate-500">{testRun.mode.replaceAll("_", " ")} · {testRun.environment} · {testRun.browser}</p>
        </div>
        {testRun.status !== "CANCELED" && detail.canCancel ? <form action={cancelAction}><button className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold">Cancel run</button></form> : null}
      </header>

      <section className="mt-8 rounded-2xl border border-cyan-200 bg-cyan-50/30 p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Pinned test intent</p>
        <div className="mt-2 flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><Link href={`/workspace/${orgSlug}/projects/${projectId}/test-cases/${testRun.testCase.id}`} className="text-lg font-semibold hover:text-cyan-700">{testRun.testCaseVersion.title}</Link><p className="mt-1 text-xs text-slate-400">Immutable Test Case version {testRun.testCaseVersion.versionNumber}</p></div><span className="text-xs font-semibold text-slate-500">{testRun.testCaseVersion.type.replaceAll("_", " ")} · {testRun.testCaseVersion.priority}</span></div>
        <p className="mt-5 text-sm leading-6 text-slate-700">{testRun.testCaseVersion.objective}</p>
        <div className="mt-5 grid gap-6 border-t border-cyan-100 pt-5 sm:grid-cols-2"><div><h2 className="text-xs font-semibold uppercase text-slate-400">Steps</h2><ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">{steps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ol></div><div><h2 className="text-xs font-semibold uppercase text-slate-400">Expected results</h2><ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-700">{expectedResults.map((result, index) => <li key={`${index}-${result}`}>{result}</li>)}</ul></div></div>
      </section>

      {testRun.status !== "CANCELED" && detail.canRecord ? (
        <form action={recordAction} className="mt-8 space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Attempt {testRun.latestAttemptNumber + 1}</p><h2 className="mt-2 text-lg font-semibold">Record execution evidence</h2><p className="mt-1 text-sm text-slate-500">Submitting creates an immutable attempt. Corrections are recorded as another attempt.</p></div>
          <input type="hidden" name="expectedAttemptNumber" value={testRun.latestAttemptNumber} />
          <div className="grid gap-5 sm:grid-cols-2"><label className="block text-sm font-medium">Overall result<select name="result" defaultValue="PASSED" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-500/60"><option>PASSED</option><option>FAILED</option><option>BLOCKED</option></select></label><label className="block text-sm font-medium">Duration in seconds<input name="durationSeconds" type="number" min="0" step="0.001" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-500/60" /></label></div>
          <label className="block text-sm font-medium">Summary<textarea name="summary" rows={3} placeholder="What happened in this execution?" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-500/60" /></label>
          <div><h3 className="text-sm font-semibold">Step results</h3><div className="mt-3 space-y-3">{steps.map((step, index) => <div key={`${index}-${step}`} className="grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-[1fr_150px]"><div><p className="text-sm font-medium">{index + 1}. {step}</p><input name={`step-${index}-notes`} placeholder="Optional evidence or observation" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div><select name={`step-${index}-result`} defaultValue="PASSED" className="h-fit rounded-lg border border-slate-300 px-3 py-2 text-sm"><option>PASSED</option><option>FAILED</option><option>BLOCKED</option><option>SKIPPED</option></select></div>)}</div></div>
          <label className="block text-sm font-medium">Failure or blocker details<textarea name="failureDetails" rows={4} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-500/60" /></label>
          <label className="block text-sm font-medium">Evidence URLs — one per line<textarea name="evidence" rows={3} placeholder={"https://example.com/screenshot\nhttps://example.com/trace"} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-500/60" /></label>
          <button className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">Record immutable attempt</button>
        </form>
      ) : null}

      <section className="mt-8 rounded-2xl border border-fuchsia-200 bg-fuchsia-50/30 p-6 shadow-sm sm:p-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-700">Advisory analysis</p>
          <h2 className="mt-2 text-lg font-semibold">AI Failure Intelligence</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Classifies failed or blocked attempts using only their immutable evidence. Every finding cites an exact stored quote. Analysis never edits the attempt or decides the final root cause.
          </p>
        </div>
        {detail.canAnalyzeFailure ? <div className="mt-5 flex flex-wrap gap-2">{testRun.attempts.filter((attempt) => attempt.result !== "PASSED").map((attempt) => <form key={attempt.id} action={analyzeFailureAction}><input type="hidden" name="testRunAttemptId" value={attempt.id} /><button className="rounded-lg bg-fuchsia-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-900">Analyze attempt {attempt.attemptNumber}</button></form>)}</div> : null}
        {testRun.attempts.every((attempt) => attempt.result === "PASSED") ? <p className="mt-5 rounded-xl border border-dashed border-fuchsia-200 bg-white p-4 text-sm text-slate-500">Record a failed or blocked attempt to enable evidence-based analysis.</p> : null}
        {analyses.length ? <div className="mt-6 space-y-5">{analyses.map((analysis) => <article key={analysis.id} className="rounded-xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold">Attempt {analysis.attempt.attemptNumber} · {analysis.attempt.result}</p><p className="mt-1 text-xs text-slate-400">{analysis.model} · {analysis.promptVersion} · {analysis.createdBy.displayName || "Workspace member"} · {analysis.startedAt.toLocaleString()}</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{analysis.status}</span></div>{analysis.summary ? <p className="mt-4 text-sm leading-6 text-slate-700">{analysis.summary}</p> : null}{analysis.status === "FAILED" ? <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">Analysis failed safely: {analysis.failureCode || "provider failure"}. The Test Run evidence was not changed.</p> : null}<div className="mt-4 space-y-3">{analysis.findings.map((finding) => <div key={finding.id} className="rounded-lg border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-fuchsia-700">{finding.category.replaceAll("_", " ")} · {finding.confidence}% confidence</p><h3 className="mt-1 text-sm font-semibold">{finding.title}</h3></div><span className="text-xs font-semibold text-slate-400">{finding.status}</span></div><p className="mt-3 text-sm leading-6 text-slate-700">{finding.explanation}</p><div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600"><span className="font-semibold">Evidence · {finding.evidenceField.replaceAll("_", " ")}: </span>“{finding.evidenceQuote}”</div><p className="mt-3 text-sm leading-6 text-slate-700"><span className="font-semibold">Recommended next check: </span>{finding.recommendation}</p>{finding.status === "OPEN" && detail.canResolveFailure ? <div className="mt-4 flex gap-2">{(["CONFIRMED", "DISMISSED"] as const).map((resolution) => <form key={resolution} action={resolveFindingAction}><input type="hidden" name="findingId" value={finding.id} /><input type="hidden" name="resolution" value={resolution} /><button className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold hover:bg-slate-50">{resolution === "CONFIRMED" ? "Confirm finding" : "Dismiss"}</button></form>)}</div> : null}</div>)}</div></article>)}</div> : null}
      </section>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold">Attempt history</h2><p className="mt-1 text-sm text-slate-500">Newest first. Stored evidence cannot be edited or deleted.</p>
        {testRun.attempts.length === 0 ? <p className="mt-5 rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">No attempts recorded.</p> : <div className="mt-6 space-y-4">{testRun.attempts.map((attempt) => { const evidence = readEvidence(attempt.evidence); const stepResults = readStepResults(attempt.stepResults); return <details key={attempt.id} className="rounded-xl border border-slate-200 p-4"><summary className="flex cursor-pointer list-none items-center justify-between gap-4"><div className="flex items-center gap-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${resultStyle[attempt.result]}`}>{attempt.result}</span><span className="text-sm font-semibold">Attempt {attempt.attemptNumber}</span></div><span className="text-xs text-slate-400">{attempt.executedBy.displayName || "Workspace member"} · {attempt.executedAt.toLocaleString()}</span></summary><div className="mt-4 border-t border-slate-200 pt-4 text-sm text-slate-700"><p>{attempt.summary || "No summary."}</p>{attempt.durationMs !== null ? <p className="mt-2 text-xs text-slate-400">Duration {(attempt.durationMs / 1000).toFixed(3)} seconds</p> : null}{attempt.failureDetails ? <div className="mt-4 rounded-lg bg-red-50 p-3 text-red-900"><span className="font-semibold">Failure/blocker: </span>{attempt.failureDetails}</div> : null}{stepResults.length ? <ul className="mt-4 space-y-2">{stepResults.map((step) => <li key={step.stepIndex} className="rounded-lg bg-slate-50 p-3"><span className="font-semibold">Step {step.stepIndex + 1}: {step.result}</span>{step.notes ? ` · ${step.notes}` : ""}</li>)}</ul> : null}{evidence.length ? <div className="mt-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Captured evidence</p><div className="mt-2 flex flex-wrap gap-2">{evidence.map((item) => { const style = evidenceStyle[item.kind] ?? evidenceStyle.LINK; return <a key={`${item.label}-${item.url}`} href={item.url} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${style.chip}`}><span aria-hidden="true">{style.glyph}</span>{item.label}</a>; })}</div>{evidence.some((item) => item.kind === "TRACE") ? <p className="mt-3 text-xs leading-5 text-slate-500">A Playwright trace is a downloadable archive, not a page. Download it, then open it with <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px]">npx playwright show-trace &lt;file&gt;</code> to step through what the browser actually did.</p> : null}</div> : null}</div></details>; })}</div>}
      </section>
    </div>
  );
}
