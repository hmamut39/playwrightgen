"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import type { FreeToolHandoff } from "@/lib/free-tools/handoff";
import { LimitReached, readFreeToolLimit, type FreeToolLimit } from "@/components/free-tools/limit-reached";

import { CompactInput, FieldLabel, MultiSelectChips, TagInput } from "./form-controls";
import {
    allowedExtensions,
    changeCategories,
    changeImpactFocus,
    exampleReview,
    rolloutNeedsContext,
    rolloutStrategies,
    suggestedRoles,
    type EngineeringReviewResult,
    type EvidenceFile,
    type FeatureFlagStatus,
} from "./review-model";
import { ReviewResult } from "./review-result";

export default function EngineeringReviewPage() {
    const [projectName, setProjectName] = useState("");
    const [changeSummary, setChangeSummary] = useState("");
    const [expectedBehavior, setExpectedBehavior] = useState("");
    const [beforeBehavior, setBeforeBehavior] = useState("");
    const [acceptanceCriteria, setAcceptanceCriteria] = useState("");
    const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
    const [customCategory, setCustomCategory] = useState("");
    const [affectedApplications, setAffectedApplications] = useState<string[]>([]);
    const [affectedApplicationDraft, setAffectedApplicationDraft] = useState("");
    const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
    const [customRole, setCustomRole] = useState("");
    const [featureFlagStatus, setFeatureFlagStatus] =
        useState<FeatureFlagStatus>("Unknown");
    const [featureFlagName, setFeatureFlagName] = useState("");
    const [rolloutStrategy, setRolloutStrategy] = useState("Not decided");
    const [rolloutContext, setRolloutContext] = useState("");
    const [downstreamConsumers, setDownstreamConsumers] = useState<string[]>([]);
    const [downstreamConsumerDraft, setDownstreamConsumerDraft] = useState("");
    const [contextExpanded, setContextExpanded] = useState(false);
    const [evidenceFiles, setEvidenceFiles] = useState<EvidenceFile[]>([]);
    const [fieldErrors, setFieldErrors] = useState({
        changeSummary: "",
        expectedBehavior: "",
    });
    const [loading, setLoading] = useState(false);
    const [remaining, setRemaining] = useState<number | null>(null);
    const [error, setError] = useState("");
    const [limit, setLimit] = useState<FreeToolLimit | null>(null);
    const [result, setResult] = useState<EngineeringReviewResult | null>(null);
    const inputWorkspaceRef = useRef<HTMLElement>(null);
    const resultSectionRef = useRef<HTMLElement>(null);
    const firstRequiredInputRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!result) return;

        const prefersReducedMotion = window.matchMedia(
            "(prefers-reduced-motion: reduce)"
        ).matches;

        resultSectionRef.current?.scrollIntoView({
            behavior: prefersReducedMotion ? "auto" : "smooth",
            block: "start",
        });
    }, [result]);

    const applyExample = () => {
        setProjectName(exampleReview.projectName);
        setChangeSummary(exampleReview.changeSummary);
        setExpectedBehavior(exampleReview.expectedBehavior);
        setBeforeBehavior(exampleReview.beforeBehavior);
        setAcceptanceCriteria(exampleReview.acceptanceCriteria);
        setSelectedCategories(exampleReview.categories);
        setCustomCategory("");
        setAffectedApplications(exampleReview.affectedApplications);
        setAffectedApplicationDraft("");
        setSelectedRoles(exampleReview.roles);
        setCustomRole("");
        setFeatureFlagStatus(exampleReview.featureFlagStatus);
        setFeatureFlagName(exampleReview.featureFlagName);
        setRolloutStrategy(exampleReview.rolloutStrategy);
        setRolloutContext(exampleReview.rolloutContext);
        setDownstreamConsumers(exampleReview.downstreamConsumers);
        setDownstreamConsumerDraft("");
        // Expanded so the optional fields it filled are visible. Filling inputs
        // hidden behind a collapsed section would look like the button did less
        // than it did, and would teach nothing about what that section is for.
        setContextExpanded(true);
        setFieldErrors({ changeSummary: "", expectedBehavior: "" });
        setResult(null);
        setError("");
    };

    const invalidateResult = () => {
        setResult(null);
        setError("");
    };

    const sourceBundle = evidenceFiles
        .map((file) => `\n\n===FILE: ${file.name}===\n${file.content}`)
        .join("\n");

    const allCategories = [
        ...selectedCategories.filter((category) => category !== "Other"),
        ...(selectedCategories.includes("Other") && customCategory.trim()
            ? [customCategory.trim()]
            : []),
    ];

    const allRoles = [
        ...selectedRoles.filter((role) => role !== "Other"),
        ...(selectedRoles.includes("Other") && customRole.trim()
            ? [customRole.trim()]
            : []),
    ];

    const projectSummary = [
        changeSummary.trim() && `Change summary:\n${changeSummary.trim()}`,
        expectedBehavior.trim() &&
            `Expected behavior:\n${expectedBehavior.trim()}`,
        beforeBehavior.trim() && `Before behavior:\n${beforeBehavior.trim()}`,
        acceptanceCriteria.trim() &&
            `Acceptance criteria:\n${acceptanceCriteria.trim()}`,
        allCategories.length > 0 &&
            `Change categories:\n${allCategories.join(", ")}`,
        affectedApplications.length > 0 &&
            `Affected application or service:\n${affectedApplications.join(", ")}`,
        allRoles.length > 0 && `User roles:\n${allRoles.join(", ")}`,
        `Feature flag status:\n${featureFlagStatus}`,
        featureFlagName.trim() && `Feature flag name:\n${featureFlagName.trim()}`,
        `Rollout strategy:\n${rolloutStrategy}`,
        rolloutContext.trim() && `Rollout context:\n${rolloutContext.trim()}`,
        downstreamConsumers.length > 0 &&
            `Known downstream consumers:\n${downstreamConsumers.join(", ")}`,
    ]
        .filter(Boolean)
        .join("\n\n");

    const handleFileUpload = async (files: FileList | null) => {
        if (!files || files.length === 0) return;

        const selected = Array.from(files);
        const maxFileSize = 250_000;
        const maxTotalSize = 600_000;
        const readableFiles = selected.filter((file) =>
            allowedExtensions.some((extension) =>
                file.name.toLowerCase().endsWith(extension)
            )
        );

        if (readableFiles.length === 0) {
            setError(
                "Upload readable files such as .ts, .tsx, .js, .json, .md, .yml, or .txt."
            );
            return;
        }

        const currentTotal = evidenceFiles.reduce(
            (sum, file) => sum + file.size,
            0
        );
        const newTotal = readableFiles.reduce(
            (sum, file) => sum + file.size,
            0
        );

        if (currentTotal + newTotal > maxTotalSize) {
            setError(
                "Uploaded files are too large. Keep total uploaded text under 600KB."
            );
            return;
        }

        const nextFiles: EvidenceFile[] = [];

        for (const file of readableFiles) {
            if (file.size > maxFileSize) {
                setError(`"${file.name}" is too large. Keep each file under 250KB.`);
                return;
            }

            nextFiles.push({
                id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
                name: file.name,
                size: file.size,
                content: await file.text(),
            });
        }

        setEvidenceFiles((current) => [...current, ...nextFiles]);
        invalidateResult();
    };

    const removeFile = (id: string) => {
        setEvidenceFiles((current) => current.filter((file) => file.id !== id));
        if (fileInputRef.current) fileInputRef.current.value = "";
        invalidateResult();
    };

    const clearFiles = () => {
        setEvidenceFiles([]);
        if (fileInputRef.current) fileInputRef.current.value = "";
        invalidateResult();
    };

    const scrollToInput = () => {
        const prefersReducedMotion = window.matchMedia(
            "(prefers-reduced-motion: reduce)"
        ).matches;

        inputWorkspaceRef.current?.scrollIntoView({
            behavior: prefersReducedMotion ? "auto" : "smooth",
            block: "start",
        });
    };

    const handleAnalyzeAnother = () => {
        setProjectName("");
        setChangeSummary("");
        setExpectedBehavior("");
        setBeforeBehavior("");
        setAcceptanceCriteria("");
        setSelectedCategories([]);
        setCustomCategory("");
        setAffectedApplications([]);
        setAffectedApplicationDraft("");
        setSelectedRoles([]);
        setCustomRole("");
        setFeatureFlagStatus("Unknown");
        setFeatureFlagName("");
        setRolloutStrategy("Not decided");
        setRolloutContext("");
        setDownstreamConsumers([]);
        setDownstreamConsumerDraft("");
        setContextExpanded(false);
        setEvidenceFiles([]);
        setFieldErrors({ changeSummary: "", expectedBehavior: "" });
        setLoading(false);
        setResult(null);
        setError("");

        if (fileInputRef.current) fileInputRef.current.value = "";

        scrollToInput();
        window.requestAnimationFrame(() =>
            firstRequiredInputRef.current?.focus({ preventScroll: true })
        );
    };

    const handleAnalyze = async () => {
        const nextFieldErrors = {
            changeSummary: changeSummary.trim()
                ? ""
                : "Enter a change summary to continue.",
            expectedBehavior: expectedBehavior.trim()
                ? ""
                : "Describe the expected behavior to continue.",
        };

        setFieldErrors(nextFieldErrors);

        if (nextFieldErrors.changeSummary || nextFieldErrors.expectedBehavior) {
            setError("");
            const firstInvalidId = nextFieldErrors.changeSummary
                ? "change-summary"
                : "expected-behavior";
            document.getElementById(firstInvalidId)?.focus();
            return;
        }

        try {
            setLoading(true);
            setLimit(null);
            setError("");
            setResult(null);

            const response = await fetch("/api/engineering-review", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    projectName,
                    projectSummary,
                    changeSummary,
                    expectedBehavior,
                    beforeBehavior,
                    afterBehavior: expectedBehavior,
                    acceptanceCriteria,
                    sourceBundle,
                    uploadedFileNames: evidenceFiles.map((file) => file.name),
                    changeCategories: allCategories,
                    affectedApplications,
                    affectedApplication: affectedApplications.join(", "),
                    affectedService: affectedApplications.join(", "),
                    userRoles: allRoles,
                    featureFlagStatus,
                    featureFlagName,
                    rolloutStrategy,
                    rolloutContext,
                    featureFlagContext:
                        featureFlagStatus === "Yes"
                            ? [
                                  "Status: Yes",
                                  featureFlagName.trim() &&
                                      `Name: ${featureFlagName.trim()}`,
                              ]
                                  .filter(Boolean)
                                  .join("; ")
                            : "",
                    downstreamConsumers,
                    selectedFocus: changeImpactFocus,
                    depth: "deep",
                    reviewMode: "change",
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                const reached = readFreeToolLimit(response.status, data);
                setLimit(reached);
                setError(reached ? "" : data.error || "Failed to analyze change impact.");
                if (typeof data.remaining === "number") setRemaining(data.remaining);
                return;
            }

            setResult(data.result || null);
            if (typeof data.remaining === "number") setRemaining(data.remaining);
        } catch (requestError) {
            console.error(
                "AI Change Intelligence request failed:",
                requestError instanceof Error ? requestError.message : "Unknown error"
            );
            setError("Failed to analyze change impact. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const workspaceHandoff: FreeToolHandoff | null = result
        ? {
              version: 1,
              source: "release-review",
              target: "REQUIREMENT",
              createdAt: new Date().toISOString(),
              title:
                  projectName.trim() ||
                  `Release follow-up: ${changeSummary.trim().slice(0, 240)}`,
              summary: [
                  `Change summary:\n${changeSummary.trim()}`,
                  `Expected behavior:\n${expectedBehavior.trim()}`,
                  beforeBehavior.trim() && `Before behavior:\n${beforeBehavior.trim()}`,
                  `Preliminary impact summary:\n${result.executiveSummary}`,
                  result.criticalFindings.length > 0 &&
                      `Directly affected areas:\n${result.criticalFindings
                          .map((finding) => `[${finding.severity}] ${finding.title}: ${finding.impact}`)
                          .join("\n")}`,
              ]
                  .filter(Boolean)
                  .join("\n\n"),
              acceptanceCriteria: [
                  acceptanceCriteria.trim(),
                  result.recommendedActions
                      .map((finding) => `${finding.title}: ${finding.recommendation}`)
                      .join("\n"),
              ]
                  .filter(Boolean)
                  .join("\n\n"),
              tags: ["release-review", ...allCategories.slice(0, 8).map((item) => item.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))].filter(Boolean),
              notice:
                  "This creates an AI-suggested Requirement draft from a preliminary change-impact review. The evidence-completeness indicator is not a release-readiness score, and a person must review the proposed intent before approval.",
          }
        : null;

    return (
        <main className="min-h-screen bg-[#F8FAFC] px-4 py-8 sm:px-6 sm:py-10">
            <div className="mx-auto max-w-7xl">
                <section className="rounded-[2rem] border border-sky-100 bg-white p-6 shadow-sm sm:p-8">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-sky-600">
                        Free Tool · Release Review
                    </p>
                    <h1 className="max-w-4xl text-3xl font-bold tracking-tight text-slate-950 sm:text-5xl">
                        Review change risk before calling it release-ready
                    </h1>
                    <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600 sm:text-lg">
                        Identify direct impact, downstream effects, uncertainty, and the
                        engineering follow-up needed for a PR, story, requirement, or code
                        change. Workspace connects this analysis to real tests and run evidence.
                    </p>
                    <Link
                        href="/workspace"
                        className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-sky-600"
                    >
                        Continue with project evidence →
                    </Link>
                </section>

                <section
                    ref={inputWorkspaceRef}
                    aria-labelledby="change-input-heading"
                    className="mx-auto mt-8 max-w-5xl scroll-mt-6 rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm sm:p-7"
                >
                    <header className="border-b border-slate-200 px-2 pb-6 sm:px-1">
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
                            Change Input
                        </p>
                        <h2
                            id="change-input-heading"
                            className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl"
                        >
                            Describe the software change
                        </h2>
                        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 sm:text-base">
                            Start with the required fields. Additional context improves evidence
                            confidence and result specificity.
                        </p>
                        <div className="mt-4 flex flex-wrap items-center gap-3">
                            <p className="text-sm font-medium text-slate-700">
                                <span className="text-red-600" aria-hidden="true">*</span>{" "}
                                Required
                            </p>
                            <button
                                type="button"
                                onClick={applyExample}
                                className="rounded-xl border border-sky-300 bg-sky-50 px-3.5 py-2 text-xs font-semibold text-sky-800 transition hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
                            >
                                Fill in an example
                            </button>
                            <span className="text-xs text-slate-500">
                                A real change with risk in it, so you can see what a
                                review looks like before writing your own.
                            </span>
                        </div>
                    </header>

                    <div className="mt-6 space-y-6">
                        <section className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 sm:p-6">
                            <h3 className="text-xl font-bold text-slate-950">Core change details</h3>
                            <p className="mt-1 text-sm leading-6 text-slate-600">
                                A concise summary and the intended behavior are enough to begin.
                            </p>

                            <div className="mt-5 space-y-5">
                                <FieldLabel htmlFor="change-title" label="Change title" optional />
                                <input
                                    id="change-title"
                                    value={projectName}
                                    onChange={(event) => {
                                        setProjectName(event.target.value);
                                        invalidateResult();
                                    }}
                                    placeholder="Example: Add MFA to Admin Dashboard"
                                    className="-mt-3 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                                />

                                <div>
                                    <FieldLabel
                                        htmlFor="change-summary"
                                        label="Change summary"
                                        required
                                    />
                                    <textarea
                                        ref={firstRequiredInputRef}
                                        id="change-summary"
                                        rows={4}
                                        value={changeSummary}
                                        aria-invalid={Boolean(fieldErrors.changeSummary)}
                                        aria-describedby={
                                            fieldErrors.changeSummary
                                                ? "change-summary-error"
                                                : undefined
                                        }
                                        onChange={(event) => {
                                            setChangeSummary(event.target.value);
                                            setFieldErrors((current) => ({
                                                ...current,
                                                changeSummary: "",
                                            }));
                                            invalidateResult();
                                        }}
                                        placeholder="What is changing, and why?"
                                        className={`w-full rounded-xl border px-4 py-3 text-sm outline-none transition focus:ring-2 ${
                                            fieldErrors.changeSummary
                                                ? "border-red-400 focus:border-red-500 focus:ring-red-100"
                                                : "border-slate-300 focus:border-sky-500 focus:ring-sky-100"
                                        }`}
                                    />
                                    {fieldErrors.changeSummary && (
                                        <p
                                            id="change-summary-error"
                                            className="mt-2 text-sm font-medium text-red-700"
                                        >
                                            {fieldErrors.changeSummary}
                                        </p>
                                    )}
                                </div>

                                <div>
                                    <FieldLabel
                                        htmlFor="expected-behavior"
                                        label="Expected behavior"
                                        required
                                    />
                                    <textarea
                                        id="expected-behavior"
                                        rows={4}
                                        value={expectedBehavior}
                                        aria-invalid={Boolean(fieldErrors.expectedBehavior)}
                                        aria-describedby={
                                            fieldErrors.expectedBehavior
                                                ? "expected-behavior-error"
                                                : undefined
                                        }
                                        onChange={(event) => {
                                            setExpectedBehavior(event.target.value);
                                            setFieldErrors((current) => ({
                                                ...current,
                                                expectedBehavior: "",
                                            }));
                                            invalidateResult();
                                        }}
                                        placeholder="What should users or systems experience after the change?"
                                        className={`w-full rounded-xl border px-4 py-3 text-sm outline-none transition focus:ring-2 ${
                                            fieldErrors.expectedBehavior
                                                ? "border-red-400 focus:border-red-500 focus:ring-red-100"
                                                : "border-slate-300 focus:border-sky-500 focus:ring-sky-100"
                                        }`}
                                    />
                                    {fieldErrors.expectedBehavior && (
                                        <p
                                            id="expected-behavior-error"
                                            className="mt-2 text-sm font-medium text-red-700"
                                        >
                                            {fieldErrors.expectedBehavior}
                                        </p>
                                    )}
                                </div>

                                <div className="grid gap-5 md:grid-cols-2">
                                    <div>
                                        <FieldLabel
                                            htmlFor="before-behavior"
                                            label="Before behavior"
                                            optional
                                        />
                                        <textarea
                                            id="before-behavior"
                                            rows={4}
                                            value={beforeBehavior}
                                            onChange={(event) => {
                                                setBeforeBehavior(event.target.value);
                                                invalidateResult();
                                            }}
                                            placeholder="How does the system behave today?"
                                            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                                        />
                                    </div>
                                    <div>
                                        <FieldLabel
                                            htmlFor="acceptance-criteria"
                                            label="Acceptance criteria"
                                            optional
                                        />
                                        <textarea
                                            id="acceptance-criteria"
                                            rows={4}
                                            value={acceptanceCriteria}
                                            onChange={(event) => {
                                                setAcceptanceCriteria(event.target.value);
                                                invalidateResult();
                                            }}
                                            placeholder="Add numbered or free-form success criteria."
                                            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                                        />
                                    </div>
                                </div>
                            </div>
                        </section>

                        <section className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 sm:p-6">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                    <h3 className="text-xl font-bold text-slate-950">
                                        Evidence files <span className="text-sm font-normal text-slate-500">(Optional)</span>
                                    </h3>
                                    <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
                                        Add changed files, diffs, contracts, schemas, configuration,
                                        requirements, or dependency notes when available.
                                    </p>
                                </div>
                                {evidenceFiles.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={clearFiles}
                                        className="w-fit text-sm font-semibold text-sky-700 hover:text-sky-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                                    >
                                        Clear all
                                    </button>
                                )}
                            </div>

                            <div className="mt-5 rounded-2xl border border-dashed border-sky-200 bg-sky-50/60 p-5">
                                <input
                                    ref={fileInputRef}
                                    aria-label="Upload evidence files (optional)"
                                    type="file"
                                    multiple
                                    accept=".ts,.tsx,.js,.jsx,.json,.md,.txt,.yml,.yaml,.config"
                                    onChange={(event) => handleFileUpload(event.target.files)}
                                    className="block w-full rounded-xl text-sm text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 file:mr-4 file:rounded-xl file:border-0 file:bg-slate-950 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-800"
                                />
                                <p className="mt-3 text-xs leading-5 text-slate-500">
                                    Relevant text files only. Maximum 250KB per file and 600KB total.
                                </p>
                            </div>

                            {evidenceFiles.length > 0 && (
                                <ul className="mt-4 space-y-2" aria-label="Uploaded evidence files">
                                    {evidenceFiles.map((file) => (
                                        <li
                                            key={file.id}
                                            className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
                                        >
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-medium text-slate-800">
                                                    {file.name}
                                                </p>
                                                <p className="text-xs text-slate-500">
                                                    {(file.size / 1000).toFixed(1)}KB
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => removeFile(file.id)}
                                                aria-label={`Remove ${file.name}`}
                                                className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                                            >
                                                Remove
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>

                        <section className="overflow-hidden rounded-2xl border border-sky-200 bg-sky-50/40">
                            <button
                                type="button"
                                aria-expanded={contextExpanded}
                                aria-controls="structured-change-context"
                                onClick={() => setContextExpanded((current) => !current)}
                                className="flex w-full items-center justify-between gap-4 p-5 text-left transition hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 sm:p-6"
                            >
                                <span>
                                    <span className="block text-lg font-bold text-slate-950">
                                        Add context for a deeper analysis
                                    </span>
                                    <span className="mt-1 block text-sm text-slate-600">Optional</span>
                                </span>
                                <span className="shrink-0 rounded-full border border-sky-200 bg-white px-3 py-1.5 text-sm font-semibold text-sky-700">
                                    {contextExpanded ? "Hide context" : "Add more context"}
                                </span>
                            </button>

                            {contextExpanded && (
                                <div
                                    id="structured-change-context"
                                    className="space-y-7 border-t border-sky-200 bg-white p-5 sm:p-6"
                                >
                                    <MultiSelectChips
                                        label="Change categories"
                                        options={changeCategories}
                                        selected={selectedCategories}
                                        onChange={(next) => {
                                            setSelectedCategories(next);
                                            invalidateResult();
                                        }}
                                    />
                                    {selectedCategories.includes("Other") && (
                                        <CompactInput
                                            id="custom-category"
                                            label="Custom change category"
                                            value={customCategory}
                                            onChange={(value) => {
                                                setCustomCategory(value);
                                                invalidateResult();
                                            }}
                                            placeholder="Example: Billing workflow"
                                        />
                                    )}

                                    <TagInput
                                        id="affected-applications"
                                        label="Affected application or service"
                                        tags={affectedApplications}
                                        draft={affectedApplicationDraft}
                                        onDraftChange={setAffectedApplicationDraft}
                                        onChange={(next) => {
                                            setAffectedApplications(next);
                                            invalidateResult();
                                        }}
                                        placeholder="Type a name, then press Enter or comma"
                                    />

                                    <MultiSelectChips
                                        label="User roles"
                                        options={suggestedRoles}
                                        selected={selectedRoles}
                                        onChange={(next) => {
                                            setSelectedRoles(next);
                                            invalidateResult();
                                        }}
                                    />
                                    {selectedRoles.includes("Other") && (
                                        <CompactInput
                                            id="custom-role"
                                            label="Custom user role"
                                            value={customRole}
                                            onChange={(value) => {
                                                setCustomRole(value);
                                                invalidateResult();
                                            }}
                                            placeholder="Example: Billing Analyst"
                                        />
                                    )}

                                    <fieldset>
                                        <legend className="text-sm font-semibold text-slate-800">
                                            Feature flag
                                        </legend>
                                        <div className="mt-2 inline-flex rounded-xl border border-slate-300 bg-slate-50 p-1">
                                            {(["Yes", "No", "Unknown"] as const).map((status) => (
                                                <button
                                                    key={status}
                                                    type="button"
                                                    aria-pressed={featureFlagStatus === status}
                                                    onClick={() => {
                                                        setFeatureFlagStatus(status);
                                                        if (status !== "Yes") setFeatureFlagName("");
                                                        invalidateResult();
                                                    }}
                                                    className={`rounded-lg px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                                                        featureFlagStatus === status
                                                            ? "bg-slate-950 text-white shadow-sm"
                                                            : "text-slate-600 hover:bg-white"
                                                    }`}
                                                >
                                                    {status}
                                                </button>
                                            ))}
                                        </div>
                                    </fieldset>

                                    {featureFlagStatus === "Yes" && (
                                        <CompactInput
                                            id="feature-flag-name"
                                            label="Feature flag name"
                                            optional
                                            value={featureFlagName}
                                            onChange={(value) => {
                                                setFeatureFlagName(value);
                                                invalidateResult();
                                            }}
                                            placeholder="Example: enable_admin_mfa"
                                        />
                                    )}

                                    <div>
                                        <FieldLabel
                                            htmlFor="rollout-strategy"
                                            label="Rollout strategy"
                                        />
                                        <select
                                            id="rollout-strategy"
                                            value={rolloutStrategy}
                                            onChange={(event) => {
                                                setRolloutStrategy(event.target.value);
                                                if (!rolloutNeedsContext.has(event.target.value)) {
                                                    setRolloutContext("");
                                                }
                                                invalidateResult();
                                            }}
                                            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                                        >
                                            {rolloutStrategies.map((strategy) => (
                                                <option key={strategy}>{strategy}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {rolloutNeedsContext.has(rolloutStrategy) && (
                                        <CompactInput
                                            id="rollout-context"
                                            label="Rollout context"
                                            optional
                                            value={rolloutContext}
                                            onChange={(value) => {
                                                setRolloutContext(value);
                                                invalidateResult();
                                            }}
                                            placeholder="Add stages, roles, regions, or rollback conditions"
                                        />
                                    )}

                                    <TagInput
                                        id="downstream-consumers"
                                        label="Known downstream consumers"
                                        tags={downstreamConsumers}
                                        draft={downstreamConsumerDraft}
                                        onDraftChange={setDownstreamConsumerDraft}
                                        onChange={(next) => {
                                            setDownstreamConsumers(next);
                                            invalidateResult();
                                        }}
                                        placeholder="Example: reporting service, partner API"
                                    />
                                </div>
                            )}
                        </section>

                        <section className="rounded-2xl border border-sky-200 bg-sky-50 p-5 sm:p-6">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <p className="text-sm font-semibold text-slate-950">
                                        Ready to trace the impact?
                                    </p>
                                    <p className="mt-1 text-sm leading-6 text-slate-600">
                                        Start with the required fields. Additional context improves
                                        evidence confidence and result specificity.
                                    </p>
                                    {remaining !== null && (
                                        <p className="mt-2 text-xs font-semibold text-sky-800">
                                            {remaining} free analyses remaining today
                                        </p>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={handleAnalyze}
                                    disabled={loading}
                                    className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-xl bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {loading ? "Analyzing change..." : "Analyze Change Impact"}
                                </button>
                            </div>

                            {limit ? <LimitReached limit={limit} returnTo="/engineering-review" /> : null}
                            {error && (
                                <div
                                    role="alert"
                                    className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                                >
                                    {error}
                                </div>
                            )}

                            {loading && (
                                <div role="status" aria-live="polite" className="mt-5 border-t border-sky-200 pt-4">
                                    <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-sky-100">
                                        <div className="h-full w-2/3 animate-pulse rounded-full bg-sky-600 motion-reduce:animate-none" />
                                    </div>
                                    <p className="text-sm font-medium leading-6 text-slate-700">
                                        Reviewing evidence, tracing dependencies, and identifying
                                        affected areas...
                                    </p>
                                </div>
                            )}
                        </section>
                    </div>
                </section>

                {!result && !loading && (
                    /* This page is the best guided of the three, but it still
                       ended in blank space before a review existed. Saying what
                       comes back, and what deliberately does not, is what makes
                       the output trustworthy when it arrives. */
                    <section className="mx-auto mt-10 max-w-5xl rounded-[2rem] border border-dashed border-slate-300 bg-white p-6 sm:p-8">
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                            What this review returns
                        </p>
                        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-950">
                            Where a change lands, and what to verify
                        </h2>
                        <div className="mt-6 grid gap-4 sm:grid-cols-2">
                            {[
                                ["Affected areas", "The surfaces a change is likely to touch, derived from what you describe rather than assumed."],
                                ["Risks worth checking", "Specific things that could break, each tied to the part of the change that causes it."],
                                ["Verification steps", "What to test before release, in the order that finds problems soonest."],
                                ["Open questions", "Detail the review needed and did not have, stated plainly instead of filled in."],
                            ].map(([title, detail]) => (
                                <div key={title} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                    <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
                                    <p className="mt-1.5 text-xs leading-5 text-slate-600">{detail}</p>
                                </div>
                            ))}
                        </div>
                        <p className="mt-6 text-xs leading-5 text-slate-500">
                            This is advisory. It does not approve a release, and it
                            cannot see your code — only what you describe here.
                        </p>
                    </section>
                )}

                {result && (
                    <ReviewResult
                        result={result}
                        workspaceHandoff={workspaceHandoff}
                        sectionRef={resultSectionRef}
                        onAnalyzeAnother={handleAnalyzeAnother}
                        onBackToInput={scrollToInput}
                    />
                )}
            </div>
        </main>
    );
}
