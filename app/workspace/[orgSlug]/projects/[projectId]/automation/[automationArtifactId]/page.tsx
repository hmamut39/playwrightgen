import { revalidatePath } from "next/cache";
import Link from "next/link";

import {
  approveAutomationArtifact,
  generateAutomationArtifact,
  getAutomationArtifactDetail,
  readAutomationPlan,
  readAutomationValidationFindings,
  requestAutomationChanges,
  submitAutomationArtifact,
} from "@/lib/services/automation-artifacts";

const statusStyle = {
  DRAFT: "bg-slate-100 text-slate-700",
  IN_REVIEW: "bg-amber-50 text-amber-800",
  APPROVED: "bg-emerald-50 text-emerald-700",
  ARCHIVED: "bg-slate-100 text-slate-500",
} as const;

export default async function AutomationArtifactPage({
  params,
}: {
  params: Promise<{
    orgSlug: string;
    projectId: string;
    automationArtifactId: string;
  }>;
}) {
  const { orgSlug, projectId, automationArtifactId } = await params;
  const detail = await getAutomationArtifactDetail({
    orgSlug,
    projectId,
    automationArtifactId,
    allowArchived: true,
  });
  const { artifact } = detail;
  const base = `/workspace/${orgSlug}/projects/${projectId}`;
  const artifactPath = `${base}/automation/${automationArtifactId}`;
  const currentVersion = artifact.versions.find(
    (version) => version.versionNumber === artifact.currentVersionNumber,
  );
  const plan = currentVersion ? readAutomationPlan(currentVersion.plan) : [];
  const findings = currentVersion
    ? readAutomationValidationFindings(currentVersion.validationFindings)
    : [];
  // Superseded intent: the Test Case has advanced past the version this
  // automation was generated for, so anything it produces is evidence about
  // behaviour that is no longer the approved behaviour.
  const intentMovedOn =
    artifact.testCase.currentVersionNumber > artifact.testCaseVersion.versionNumber;

  const canSubmitCurrent = Boolean(
    currentVersion &&
      currentVersion.generationStatus === "SUCCEEDED" &&
      currentVersion.validationStatus !== "BLOCKED",
  );

  async function regenerateAction(formData: FormData) {
    "use server";
    await generateAutomationArtifact({
      orgSlug,
      projectId,
      testCaseId: artifact.testCaseId,
      engine: artifact.engine,
      guidance: String(formData.get("guidance") ?? ""),
    });
    revalidatePath(artifactPath);
    revalidatePath(`${base}/automation`);
    revalidatePath(`${base}/test-cases/${artifact.testCaseId}`);
  }

  async function transitionAction(formData: FormData) {
    "use server";
    const input = { orgSlug, projectId, automationArtifactId };
    const intent = String(formData.get("intent") ?? "");
    if (intent === "submit") await submitAutomationArtifact(input);
    else if (intent === "request-changes") await requestAutomationChanges(input);
    else if (intent === "approve") await approveAutomationArtifact(input);
    else throw new Error("Invalid automation transition intent");
    revalidatePath(artifactPath);
    revalidatePath(`${base}/automation`);
    revalidatePath(`${base}/test-cases/${artifact.testCaseId}`);
  }

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href={`${base}/automation`}
        className="text-sm font-medium text-cyan-700 hover:text-cyan-900"
      >
        ← Automation
      </Link>

      <header className="mt-8 flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyle[artifact.status]}`}>
              {artifact.status.replace("_", " ")}
            </span>
            <span className="rounded-full bg-cyan-50 px-2.5 py-1 text-xs font-semibold text-cyan-800">
              {artifact.engine === "PLAYWRIGHT_BROWSER"
                ? "Playwright Browser"
                : "Playwright API"}
            </span>
            <span className="text-xs text-slate-400">
              Current v{artifact.currentVersionNumber} · Approved v
              {artifact.approvedVersionNumber ?? "—"}
            </span>
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">{artifact.name}</h1>
          <p className="mt-3 text-sm text-slate-500">
            Pinned to{" "}
            <Link
              href={`${base}/test-cases/${artifact.testCaseId}`}
              className="font-semibold text-cyan-700"
            >
              {artifact.testCase.title}
            </Link>{" "}
            version {artifact.testCaseVersion.versionNumber}. Test intent remains immutable.
          </p>
          {/* Pinning is what makes a result traceable, but on its own it says
              nothing about whether the pin is still current. Stated alone on
              superseded automation it reads as reassurance, on the very page
              where someone decides whether to approve or trust this code. */}
          {intentMovedOn ? (
            <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
              <span className="font-semibold">
                The approved intent has moved on since this was generated.
              </span>{" "}
              This artifact exercises version {artifact.testCaseVersion.versionNumber}, and the
              Test Case is now at version {artifact.testCase.currentVersionNumber}. Results
              from it describe the older behaviour and cannot be read as evidence
              for the current version. Regenerate against the current version to
              cover it.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {artifact.status === "DRAFT" && detail.canSubmit && canSubmitCurrent ? (
            <form action={transitionAction}>
              <input type="hidden" name="intent" value="submit" />
              <button className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">
                Submit for review
              </button>
            </form>
          ) : null}
          {artifact.status === "IN_REVIEW" && detail.canApprove ? (
            <>
              <form action={transitionAction}>
                <input type="hidden" name="intent" value="request-changes" />
                <button className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold">
                  Request changes
                </button>
              </form>
              <form action={transitionAction}>
                <input type="hidden" name="intent" value="approve" />
                <button className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white">
                  Approve automation
                </button>
              </form>
            </>
          ) : null}
        </div>
      </header>

      {currentVersion ? (
        <>
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">
                  Current artifact version {currentVersion.versionNumber}
                </p>
                <h2 className="mt-2 text-xl font-semibold">{currentVersion.summary}</h2>
                <p className="mt-2 text-xs text-slate-400">
                  {currentVersion.model} · {currentVersion.promptVersion} ·{" "}
                  {currentVersion.totalTokens ?? "—"} tokens ·{" "}
                  {currentVersion.startedAt.toLocaleString()}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs font-semibold">
                <span className={`rounded-full px-2.5 py-1 ${currentVersion.generationStatus === "SUCCEEDED" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                  Generation {currentVersion.generationStatus.toLowerCase()}
                </span>
                <span className={`rounded-full px-2.5 py-1 ${currentVersion.validationStatus === "PASSED" ? "bg-emerald-50 text-emerald-700" : currentVersion.validationStatus === "WARNINGS" ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700"}`}>
                  Validation {currentVersion.validationStatus.toLowerCase()}
                </span>
              </div>
            </div>

            {currentVersion.generationStatus === "FAILED" ? (
              <p className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                Generation failed safely ({currentVersion.failureCode ?? "provider_failure"}).
                No executable code was approved or run.
              </p>
            ) : null}

            {findings.length ? (
              <div className="mt-6 space-y-2">
                <h3 className="text-sm font-semibold">Local validation findings</h3>
                {findings.map((finding) => (
                  <div
                    key={`${finding.code}-${finding.message}`}
                    className={`rounded-xl border p-3 text-sm ${finding.severity === "BLOCKING" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}
                  >
                    <span className="font-semibold">{finding.severity} · {finding.code}</span>
                    <span className="ml-2">{finding.message}</span>
                  </div>
                ))}
              </div>
            ) : currentVersion.generationStatus === "SUCCEEDED" ? (
              <p className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                Deterministic validation passed with no findings. Human review is still required.
              </p>
            ) : null}
          </section>

          {currentVersion.generationStatus === "SUCCEEDED" ? (
            <>
              <section className="mt-8 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h2 className="text-lg font-semibold">Automation plan</h2>
                  <div className="mt-5 space-y-3">
                    {plan.map((item, index) => (
                      <div key={`${index}-${item.title}`} className="rounded-xl bg-slate-50 p-4">
                        <p className="text-sm font-semibold">{index + 1}. {item.title}</p>
                        <p className="mt-2 text-sm text-slate-600">{item.intent}</p>
                        <p className="mt-2 text-xs font-medium text-cyan-800">
                          Assert: {item.expectedAssertion}
                        </p>
                      </div>
                    ))}
                  </div>
                  <h3 className="mt-6 text-sm font-semibold">Assumptions</h3>
                  <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-600">
                    {currentVersion.assumptions.length ? currentVersion.assumptions.map((assumption) => (
                      <li key={assumption}>{assumption}</li>
                    )) : <li>No assumptions recorded.</li>}
                  </ul>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6 text-slate-100 shadow-sm">
                  <div className="flex items-center justify-between gap-4">
                    <h2 className="text-lg font-semibold">Playwright test</h2>
                    <span className="text-xs text-slate-400">TypeScript · not executed</span>
                  </div>
                  <pre className="mt-5 max-h-[46rem] overflow-auto whitespace-pre text-xs leading-6"><code>{currentVersion.code}</code></pre>
                </div>
              </section>

              <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
                <h2 className="text-lg font-semibold">Configuration and dependencies</h2>
                <p className="mt-2 text-sm text-slate-500">
                  Declared dependencies: {currentVersion.dependencies.join(", ") || "None"}
                </p>
                <pre className="mt-5 max-h-96 overflow-auto rounded-xl bg-slate-950 p-5 text-xs leading-6 text-slate-100"><code>{currentVersion.configuration}</code></pre>
              </section>
            </>
          ) : null}
        </>
      ) : null}

      {detail.canGenerate && artifact.status !== "IN_REVIEW" && artifact.status !== "ARCHIVED" ? (
        <section className="mt-8 rounded-2xl border border-cyan-200 bg-cyan-50/40 p-6 shadow-sm sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">New immutable version</p>
          <h2 className="mt-2 text-lg font-semibold">Regenerate with reviewer guidance</h2>
          <p className="mt-1 text-sm text-slate-600">
            The prior versions and any previously approved version remain preserved.
          </p>
          <form action={regenerateAction} className="mt-5">
            <textarea
              name="guidance"
              rows={4}
              maxLength={10000}
              placeholder="Optional: clarify test data, route names, selectors, API contracts, or fixture conventions."
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm"
            />
            <button className="mt-3 rounded-lg bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white">
              Generate next version
            </button>
          </form>
        </section>
      ) : null}

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold">Version history</h2>
        <p className="mt-1 text-sm text-slate-500">
          Generated content is append-only. Approval points to one exact version.
        </p>
        <div className="mt-5 divide-y divide-slate-200 border-y border-slate-200">
          {artifact.versions.map((version) => (
            <details key={version.id} className="py-4">
              <summary className="flex cursor-pointer list-none flex-col justify-between gap-2 sm:flex-row sm:items-center">
                <span className="text-sm font-semibold">
                  Version {version.versionNumber}
                  {artifact.approvedVersionNumber === version.versionNumber ? " · APPROVED" : ""}
                </span>
                <span className="text-xs text-slate-400">
                  {version.generationStatus} · {version.validationStatus} · {version.createdBy.displayName || "Workspace member"} · {version.startedAt.toLocaleString()}
                </span>
              </summary>
              <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
                <p>{version.summary}</p>
                <p className="mt-2 text-xs text-slate-400">
                  {version.model} · {version.totalTokens ?? "—"} tokens
                </p>
              </div>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
