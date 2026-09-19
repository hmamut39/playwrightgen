"use client";

import type { RefObject } from "react";

import { ResultActions } from "@/components/free-tools/result-actions";
import { WorkspaceHandoffButton } from "@/components/free-tools/workspace-handoff-button";
import type { FreeToolHandoff } from "@/lib/free-tools/handoff";

import type { EngineeringReviewResult, Finding, Severity } from "./review-model";

/** The analysis once it has come back: every section, the report download, and the handoff. */
export function ReviewResult({
    result,
    workspaceHandoff,
    sectionRef,
    onAnalyzeAnother,
    onBackToInput,
}: {
    result: EngineeringReviewResult;
    workspaceHandoff: FreeToolHandoff | null;
    sectionRef: RefObject<HTMLElement | null>;
    onAnalyzeAnother: () => void;
    onBackToInput: () => void;
}) {
    return (
                <section
                    ref={sectionRef}
                    aria-labelledby="impact-analysis-heading"
                    className="mx-auto mt-10 max-w-5xl scroll-mt-6 rounded-[2rem] border border-sky-200 bg-slate-100/80 p-4 shadow-sm sm:p-7"
                >
                    <header className="rounded-2xl border border-sky-200 bg-white p-5 sm:p-6">
                        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
                                    AI Impact Analysis
                                </p>
                                <h2
                                    id="impact-analysis-heading"
                                    className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl"
                                >
                                    Change impact results
                                </h2>
                                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 sm:text-base">
                                    Direct effects, downstream consequences, affected validation,
                                    uncertainty, and concrete engineering follow-up.
                                </p>
                            </div>
                            <ResultActions
                                content={JSON.stringify(result, null, 2)}
                                filename="playwrightgen-release-review.json"
                                copyLabel="Copy report"
                                downloadLabel="Download report"
                            />
                        </div>
                    </header>

                    <div className="mt-6 space-y-5">
                        <ImpactSummary result={result} />
                        <FindingCard
                            title="Directly Affected Areas"
                            description="Systems, workflows, or behaviors directly connected to the change."
                            items={result.criticalFindings}
                        />
                        {result.architectureIntelligence.length > 0 && (
                            <FindingCard
                                title="Downstream and Indirect Effects"
                                description="Dependencies and second-order effects beyond the changed area."
                                items={result.architectureIntelligence}
                            />
                        )}
                        <FindingCard
                            title="Affected Validation Areas"
                            description="Behaviors and flows requiring validation because they intersect with the change."
                            items={result.testIntelligence}
                        />
                        {result.securityIntelligence.length > 0 && (
                            <FindingCard
                                title="Security, Data, and Permission Effects"
                                description="Effects on access, sensitive data, authorization, and data integrity."
                                items={result.securityIntelligence}
                            />
                        )}
                        {result.performanceIntelligence.length > 0 && (
                            <FindingCard
                                title="Operational and Rollout Effects"
                                description="Runtime, deployment, monitoring, rollback, and rollout considerations."
                                items={result.performanceIntelligence}
                            />
                        )}
                        <FindingCard
                            title="Unknowns and Evidence Gaps"
                            description="Missing context that limits the confidence or reach of the analysis."
                            items={result.maintainabilityIntelligence}
                        />
                        <FindingCard
                            title="Required Follow-up"
                            description="Prioritized validation, coordination, or investigation prompted by the impact."
                            items={result.recommendedActions}
                        />

                        {workspaceHandoff && (
                            <section className="rounded-2xl border border-cyan-200 bg-cyan-50 p-5 sm:p-6">
                                <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
                                    <div>
                                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-800">
                                            Turn analysis into owned work
                                        </p>
                                        <h3 className="mt-2 text-xl font-semibold text-slate-950">
                                            Continue as a draft Requirement
                                        </h3>
                                        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                                            Choose a project and edit the proposed intent before
                                            creating an AI-suggested draft. The review does not
                                            approve the change or declare it release-ready.
                                        </p>
                                    </div>
                                    <WorkspaceHandoffButton
                                        handoff={workspaceHandoff}
                                        className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-bold text-white hover:bg-cyan-700 lg:w-auto"
                                    >
                                        Continue in Workspace →
                                    </WorkspaceHandoffButton>
                                </div>
                            </section>
                        )}

                        <div className="flex flex-col gap-3 border-t border-slate-300 pt-5 sm:flex-row">
                            <button
                                type="button"
                                onClick={onAnalyzeAnother}
                                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-2 text-sm font-semibold text-slate-800 transition hover:border-sky-300 hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                            >
                                Analyze Another Change
                            </button>
                            <button
                                type="button"
                                onClick={onBackToInput}
                                className="inline-flex min-h-11 items-center justify-center rounded-xl px-5 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                            >
                                Back to Change Input
                            </button>
                        </div>
                    </div>
                </section>
    );
}

function ImpactSummary({ result }: { result: EngineeringReviewResult }) {
    return (
        <section className="rounded-2xl border border-sky-300 bg-sky-50 p-5 shadow-sm sm:p-6">
            <h3 className="text-xl font-bold text-slate-950">Impact Summary</h3>
            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto]">
                <div className="rounded-xl border border-sky-100 bg-white p-5">
                    <p className="text-base leading-7 text-slate-700">
                        {result.executiveSummary}
                    </p>
                </div>
                {/* A bare percentage invites the reading it least deserves.
                    This number says how much of the review rests on evidence
                    that was submitted rather than inferred from a description,
                    and says nothing about whether the change is safe. Stating
                    that next to it, along with the one action that raises it,
                    keeps it from being read as a quality score. */}
                <div className="rounded-xl bg-slate-950 p-5 text-white lg:min-w-56">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-200">
                        Evidence Confidence
                    </p>
                    <p className="mt-2 text-3xl font-bold">{result.overallScore}%</p>
                    <p className="mt-3 text-xs leading-5 text-slate-300">
                        How much of this review rests on evidence you submitted
                        rather than inference. It is not a safety or quality
                        score.
                    </p>
                    {result.overallScore < 85 ? (
                        <p className="mt-2 text-xs leading-5 text-sky-200">
                            Attach the source files the change touches to raise it.
                        </p>
                    ) : null}
                </div>
            </div>
            <div className="mt-4 rounded-xl border border-sky-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Evidence quality
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                    {result.productionReadiness.reason}
                </p>
            </div>
        </section>
    );
}

function FindingCard({
    title,
    description,
    items,
}: {
    title: string;
    description: string;
    items: Finding[];
}) {
    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-950">{title}</h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
            <div className="mt-4 space-y-4">
                {items.map((item, index) => (
                    <article
                        key={`${item.title}-${index}`}
                        className="rounded-xl border border-slate-200 bg-slate-50/60 p-4"
                    >
                        <div className="mb-3 flex items-start justify-between gap-3">
                            <h4 className="text-sm font-semibold text-slate-950">
                                {index + 1}. {item.title}
                            </h4>
                            <SeverityBadge severity={item.severity} />
                        </div>
                        <div className="grid gap-3 text-sm leading-6 text-slate-700 md:grid-cols-3">
                            <InfoBlock label="Impact" value={item.impact} />
                            <EvidenceBlock value={item.evidence} />
                            <InfoBlock
                                label="Recommended validation / follow-up"
                                value={item.recommendation}
                            />
                        </div>
                    </article>
                ))}
            </div>
        </section>
    );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {label}
            </p>
            <p>{value}</p>
        </div>
    );
}

function EvidenceBlock({ value }: { value: string }) {
    const marker = value.match(/^\[(CONFIRMED|LIKELY|POSSIBLE|UNKNOWN)\]/)?.[0];
    const markerClassName =
        marker === "[CONFIRMED]"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : marker === "[LIKELY]"
              ? "border-sky-200 bg-sky-50 text-sky-700"
              : marker === "[POSSIBLE]"
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-slate-300 bg-slate-100 text-slate-700";

    return (
        <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sky-800">
                Evidence
            </p>
            <p className="text-slate-700">
                {marker && (
                    <span className={`mr-2 inline-flex rounded-full border px-2 py-0.5 text-[0.7rem] font-bold tracking-wide ${markerClassName}`}>
                        {marker}
                    </span>
                )}
                {marker ? value.slice(marker.length).trimStart() : value}
            </p>
        </div>
    );
}

function SeverityBadge({ severity }: { severity: Severity }) {
    const className =
        severity === "Critical"
            ? "border-red-200 bg-red-50 text-red-700"
            : severity === "High"
              ? "border-orange-200 bg-orange-50 text-orange-700"
              : severity === "Medium"
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700";

    return (
        <span
            aria-label={`Severity: ${severity}`}
            className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}
        >
            {severity}
        </span>
    );
}
