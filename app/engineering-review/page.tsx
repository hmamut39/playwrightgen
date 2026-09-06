"use client";

import { KeyboardEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { ResultActions } from "@/components/free-tools/result-actions";
import { WorkspaceHandoffButton } from "@/components/free-tools/workspace-handoff-button";
import type { FreeToolHandoff } from "@/lib/free-tools/handoff";

type Severity = "Critical" | "High" | "Medium" | "Low";

type Finding = {
    title: string;
    severity: Severity;
    impact: string;
    evidence: string;
    recommendation: string;
};

type EngineeringReviewResult = {
    overallScore: number;
    executiveSummary: string;
    scores: [];
    productionReadiness: {
        status: "Partially Ready";
        reason: string;
    };
    criticalFindings: Finding[];
    architectureIntelligence: Finding[];
    testIntelligence: Finding[];
    securityIntelligence: Finding[];
    performanceIntelligence: Finding[];
    maintainabilityIntelligence: Finding[];
    recommendedActions: Finding[];
};

type EvidenceFile = {
    id: string;
    name: string;
    size: number;
    content: string;
};

type FeatureFlagStatus = "Yes" | "No" | "Unknown";

const allowedExtensions = [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".json",
    ".md",
    ".txt",
    ".yml",
    ".yaml",
    ".config",
];

const changeCategories = [
    "UI / User Flow",
    "Authentication",
    "Authorization / Permissions",
    "API / Contract",
    "Database / Schema",
    "Data Integrity",
    "Configuration",
    "Integration",
    "Infrastructure",
    "Performance",
    "Security / Privacy",
    "Feature Flag / Rollout",
    "Other",
];

const suggestedRoles = [
    "Customer",
    "Administrator",
    "Support Agent",
    "Internal Employee",
    "Partner",
    "Anonymous User",
    "Service Account",
    "Other",
];

const rolloutStrategies = [
    "Not decided",
    "Immediate rollout",
    "Internal users first",
    "Percentage rollout",
    "Role-based rollout",
    "Region-based rollout",
    "Feature-flag rollout",
    "Custom",
];

const rolloutNeedsContext = new Set([
    "Internal users first",
    "Percentage rollout",
    "Role-based rollout",
    "Region-based rollout",
    "Feature-flag rollout",
    "Custom",
]);

const changeImpactFocus = [
    "architecture",
    "testing",
    "security",
    "performance",
    "production",
];

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
                setError(data.error || "Failed to analyze change impact.");
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
                        <p className="mt-3 text-sm font-medium text-slate-700">
                            <span className="text-red-600" aria-hidden="true">*</span>{" "}
                            Required
                        </p>
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
                    <section
                        ref={resultSectionRef}
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
                                    onClick={handleAnalyzeAnother}
                                    className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-2 text-sm font-semibold text-slate-800 transition hover:border-sky-300 hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                                >
                                    Analyze Another Change
                                </button>
                                <button
                                    type="button"
                                    onClick={scrollToInput}
                                    className="inline-flex min-h-11 items-center justify-center rounded-xl px-5 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                                >
                                    Back to Change Input
                                </button>
                            </div>
                        </div>
                    </section>
                )}
            </div>
        </main>
    );
}

function FieldLabel({
    htmlFor,
    label,
    required = false,
    optional = false,
}: {
    htmlFor: string;
    label: string;
    required?: boolean;
    optional?: boolean;
}) {
    return (
        <label htmlFor={htmlFor} className="mb-2 block text-sm font-medium text-slate-700">
            {label}{" "}
            {required && (
                <span className="text-red-600" aria-label="required">*</span>
            )}
            {optional && (
                <span className="font-normal text-slate-500">(Optional)</span>
            )}
        </label>
    );
}

function CompactInput({
    id,
    label,
    value,
    onChange,
    placeholder,
    optional = false,
}: {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    optional?: boolean;
}) {
    return (
        <div>
            <FieldLabel htmlFor={id} label={label} optional={optional} />
            <input
                id={id}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
            />
        </div>
    );
}

function MultiSelectChips({
    label,
    options,
    selected,
    onChange,
}: {
    label: string;
    options: string[];
    selected: string[];
    onChange: (selected: string[]) => void;
}) {
    const toggle = (option: string) => {
        onChange(
            selected.includes(option)
                ? selected.filter((item) => item !== option)
                : [...selected, option]
        );
    };

    return (
        <fieldset>
            <legend className="text-sm font-semibold text-slate-800">{label}</legend>
            {selected.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2" aria-label={`Selected ${label}`}>
                    {selected.map((item) => (
                        <button
                            key={item}
                            type="button"
                            onClick={() => toggle(item)}
                            aria-label={`Remove ${item}`}
                            className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                        >
                            {item} <span aria-hidden="true">×</span>
                        </button>
                    ))}
                </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
                {options
                    .filter((option) => !selected.includes(option))
                    .map((option) => (
                        <button
                            key={option}
                            type="button"
                            onClick={() => toggle(option)}
                            className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                        >
                            + {option}
                        </button>
                    ))}
            </div>
        </fieldset>
    );
}

function TagInput({
    id,
    label,
    tags,
    draft,
    onDraftChange,
    onChange,
    placeholder,
}: {
    id: string;
    label: string;
    tags: string[];
    draft: string;
    onDraftChange: (value: string) => void;
    onChange: (tags: string[]) => void;
    placeholder: string;
}) {
    const commitDraft = () => {
        const additions = draft
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);

        if (additions.length === 0) return;

        const next = [...tags];
        for (const addition of additions) {
            if (!next.some((item) => item.toLowerCase() === addition.toLowerCase())) {
                next.push(addition);
            }
        }
        onChange(next);
        onDraftChange("");
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            commitDraft();
        }
        if (event.key === "Backspace" && !draft && tags.length > 0) {
            onChange(tags.slice(0, -1));
        }
    };

    return (
        <div>
            <FieldLabel htmlFor={id} label={label} />
            <div className="rounded-xl border border-slate-300 bg-white p-2 focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-100">
                {tags.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2">
                        {tags.map((tag) => (
                            <button
                                key={tag}
                                type="button"
                                onClick={() => onChange(tags.filter((item) => item !== tag))}
                                aria-label={`Remove ${tag}`}
                                className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                            >
                                {tag} <span aria-hidden="true">×</span>
                            </button>
                        ))}
                    </div>
                )}
                <input
                    id={id}
                    value={draft}
                    onChange={(event) => {
                        onDraftChange(event.target.value);
                        if (event.target.value.endsWith(",")) {
                            const additions = event.target.value
                                .split(",")
                                .map((item) => item.trim())
                                .filter(Boolean);
                            if (additions.length > 0) {
                                onChange([...tags, ...additions.filter((item) => !tags.includes(item))]);
                                onDraftChange("");
                            }
                        }
                    }}
                    onKeyDown={handleKeyDown}
                    onBlur={commitDraft}
                    placeholder={placeholder}
                    className="w-full border-0 px-2 py-1.5 text-sm outline-none"
                />
            </div>
        </div>
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
                <div className="rounded-xl bg-slate-950 p-5 text-white lg:min-w-52">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-200">
                        Evidence Confidence
                    </p>
                    <p className="mt-2 text-3xl font-bold">{result.overallScore}%</p>
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
