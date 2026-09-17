import "server-only";

/**
 * Release Review: what a described change will affect, and what is uncertain.
 *
 * The analysis lived inside the API route, which made it impossible to measure:
 * an eval would have had to go through HTTP and spend a visitor's daily
 * allowance to see whether the report had got worse. It is the same engine,
 * moved: one model call, a strict content check, and one repair attempt when
 * that check fails, then a normalised report. The route above it now only reads
 * the request, reserves the allowance and answers.
 *
 * The checks are deliberately about substance rather than shape -- evidence
 * markers, no invented systems, findings that differ from each other -- because
 * a confident, well-formed report that invented half its findings is the
 * failure that matters here.
 */

import OpenAI from "openai";

import { validateOpenAiEnvironment } from "@/lib/env";

export const MAX_SOURCE_LENGTH = 360_000;
const MAX_FINDINGS_PER_SECTION = 4;

const severityValues = ["Critical", "High", "Medium", "Low"] as const;
const evidencePrefixPattern = /^\[(CONFIRMED|LIKELY|POSSIBLE|UNKNOWN)\](?:\s|$)/;
const findingArrayKeys = [
    "criticalFindings",
    "architectureIntelligence",
    "testIntelligence",
    "securityIntelligence",
    "performanceIntelligence",
    "maintainabilityIntelligence",
    "recommendedActions",
] as const;
const requiredFindingKeys = [
    "criticalFindings",
    "testIntelligence",
    "maintainabilityIntelligence",
    "recommendedActions",
] as const;

type Severity = (typeof severityValues)[number];

export type Finding = {
    title: string;
    severity: Severity;
    impact: string;
    evidence: string;
    recommendation: string;
};

type AnalysisResult = {
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

export type AnalysisContext = {
    projectName: string;
    changeSummary: string;
    expectedBehavior: string;
    beforeBehavior: string;
    acceptanceCriteria: string;
    sourceBundle: string;
    uploadedFileNames: string[];
    changeCategories: string[];
    affectedApplications: string[];
    userRoles: string[];
    featureFlagStatus: string;
    featureFlagName: string;
    rolloutStrategy: string;
    rolloutContext: string;
    downstreamConsumers: string[];
    repositoryUrl: string;
    selectedFocus: string[];
    reviewMode: string;
    depth: string;
};

function cleanJson(raw: string) {
    return raw.replace(/```json/gi, "").replace(/```/g, "").trim();
}

function cleanText(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function firstNonEmptyText(...values: unknown[]) {
    for (const value of values) {
        const cleaned = cleanText(value);

        if (cleaned) return cleaned;
    }

    return "";
}

function toStringList(value: unknown) {
    const values = Array.isArray(value)
        ? value
        : typeof value === "string"
          ? value.split(",")
          : [];

    const unique = new Map<string, string>();

    for (const item of values) {
        const cleaned = cleanText(item);

        if (cleaned && !unique.has(cleaned.toLowerCase())) {
            unique.set(cleaned.toLowerCase(), cleaned);
        }
    }

    return [...unique.values()];
}

function firstNonEmptyList(...values: unknown[]) {
    for (const value of values) {
        const list = toStringList(value);

        if (list.length > 0) return list;
    }

    return [];
}

function getReviewMode(value: unknown) {
    const mode = cleanText(value);

    return ["release", "change", "test", "project"].includes(mode)
        ? mode
        : "change";
}

function getReviewDepth(value: unknown) {
    const depth = cleanText(value);

    return ["quick", "deep", "staff", "standard", "architect"].includes(
        depth
    )
        ? depth
        : "deep";
}

function formatValue(value: string | string[]) {
    if (Array.isArray(value)) {
        return value.length > 0 ? value.join(", ") : "Not provided";
    }

    return value || "Not provided";
}

function buildSubmittedEvidence(context: AnalysisContext) {
    return `CHANGE TITLE
${formatValue(context.projectName)}

CHANGE SUMMARY
${formatValue(context.changeSummary)}

EXPECTED BEHAVIOR
${formatValue(context.expectedBehavior)}

BEFORE BEHAVIOR
${formatValue(context.beforeBehavior)}

ACCEPTANCE CRITERIA
${formatValue(context.acceptanceCriteria)}

CHANGE CATEGORIES
${formatValue(context.changeCategories)}

AFFECTED APPLICATIONS OR SERVICES
${formatValue(context.affectedApplications)}

USER ROLES
${formatValue(context.userRoles)}

FEATURE FLAG STATUS
${formatValue(context.featureFlagStatus)}

FEATURE FLAG NAME
${formatValue(context.featureFlagName)}

ROLLOUT STRATEGY
${formatValue(context.rolloutStrategy)}

ROLLOUT AND ROLLBACK CONTEXT
${formatValue(context.rolloutContext)}

KNOWN DOWNSTREAM CONSUMERS
${formatValue(context.downstreamConsumers)}

UPLOADED FILE NAMES
${formatValue(context.uploadedFileNames)}

SOURCE EVIDENCE
${formatValue(context.sourceBundle)}

REPOSITORY CONTEXT
${formatValue(context.repositoryUrl)}

SELECTED ANALYSIS FOCUS
${formatValue(context.selectedFocus)}

REQUESTED DEPTH
${formatValue(context.depth)}

REQUEST MODE
${formatValue(context.reviewMode)}`;
}

const systemPrompt = `You are AI Change Intelligence, a senior software-change impact analyst. Answer: "What will this software change affect, what is uncertain, and what should the engineering team do next?"

Analyze changes for Senior Developers, Lead SDETs, QA Leads, Tech Leads, and Engineering Managers. Minimal input must still produce a useful, cautious analysis. More behavioral, dependency, rollout, and implementation evidence must increase specificity only when it supports the conclusion.

REASONING SCOPE

Reason across user behavior, business flows, components, APIs, services, data, permissions, authentication, integrations, downstream consumers, validation scope, feature flags, rollout, rollback, monitoring, operational ownership, privacy, integrity, and performance where relevant. Do not deeply inspect Playwright test implementation quality; only identify affected behaviors and validation areas. Do not make release decisions or use approval language.

EVIDENCE DISCIPLINE

Every evidence field must begin with exactly one marker:
- [CONFIRMED]: explicitly submitted behavior, system context, or observed implementation evidence supports the conclusion.
- [LIKELY]: a strong inference supported by the submitted change and context.
- [POSSIBLE]: a plausible effect without enough evidence for a strong inference.
- [UNKNOWN]: submitted evidence cannot determine the conclusion.

Never fabricate files, components, endpoints, services, dependencies, owners, schemas, tests, or implementation. Uploaded file names alone are not implementation proof. Acceptance criteria are user intent, not proof of implementation. When source evidence is supplied, distinguish what that evidence shows from intended behavior and cite submitted file names where relevant. Severity is impact magnitude, never confidence.

SECTION MAPPING

- executiveSummary: Impact Summary. State the primary direct impact, the most important downstream implication, and the highest-impact uncertainty in no more than 120 words. Do not state an evidence-confidence level or percentage here; the page computes and shows that separately.
- criticalFindings: Directly Affected Areas.
- architectureIntelligence: Downstream and Indirect Effects.
- testIntelligence: Affected Validation Areas.
- securityIntelligence: Security, Data, and Permission Effects.
- performanceIntelligence: Operational and Rollout Effects.
- maintainabilityIntelligence: Unknowns and Evidence Gaps, never generic maintainability advice.
- recommendedActions: Required Follow-up, ordered by priority.

Always return at least one meaningful finding in criticalFindings, testIntelligence, maintainabilityIntelligence, and recommendedActions. With minimal evidence, use careful LIKELY, POSSIBLE, and UNKNOWN findings. Optional sections may be empty only when genuinely irrelevant. Return no more than four findings per array.

Each recommendation must identify the concrete action, affected area, and why it is needed. Never give generic advice such as "add tests," "review code," "ensure it is robust," "verify it works," "monitor production," or "check security."

In testIntelligence, every recommendation must be one concrete test scenario written as "Given ... When ... Then ...", naming the specific data, boundary or actor from the submission (for example an amount just above and just below a stated threshold, a second agent acting on the same record, a retry after a partial failure) and the exact observable outcome to assert.

In recommendedActions and securityIntelligence, name the specific failure mode the action prevents (for example duplicate processing on retry, out-of-order events reaching a downstream consumer, a status that never leaves Pending when the worker is down, a rollback that leaves queued items unprocessed) rather than a category. In performanceIntelligence, name the concrete signal to watch after release and the value that should trigger a rollback when rollout or monitoring context was supplied. Required Follow-up titles must begin exactly with P0 —, P1 —, or P2 —. Use P0 only for a serious unresolved risk created by the submitted change.

Do not duplicate substantially identical findings within a section. The same feature may appear across different sections when it represents a distinct impact dimension.

JSON CONTRACT

Return JSON only, without markdown or additional keys:
{
  "overallScore": 0,
  "executiveSummary": "Impact summary.",
  "scores": [],
  "productionReadiness": {
    "status": "Partially Ready",
    "reason": "Evidence quality only, without a release decision."
  },
  "criticalFindings": [],
  "architectureIntelligence": [],
  "testIntelligence": [],
  "securityIntelligence": [],
  "performanceIntelligence": [],
  "maintainabilityIntelligence": [],
  "recommendedActions": []
}

Every finding must have exactly this structure:
{
  "title": "Specific finding",
  "severity": "Critical | High | Medium | Low",
  "impact": "What changes, who or what is affected, and the consequence.",
  "evidence": "[MARKER] Submitted evidence or bounded inference.",
  "recommendation": "Concrete action, affected area, and reason."
}

overallScore is Evidence Confidence only, not safety or readiness. It measures how much of this review rests on submitted evidence rather than inference from a description, and nothing else. Use these bands so the same input scores the same way every time:
- 85-100: source files covering the changed area were supplied, and most findings cite them.
- 65-84: source files were supplied but cover only part of the change, or written context is detailed enough that findings are strong inferences.
- 40-64: no source files, but before and after behavior, acceptance criteria and affected areas were described.
- 15-39: a change summary and expected behavior only, so most findings are [POSSIBLE] inference.
- 0-14: too little was submitted to review the change.
Never raise the band because the change looks safe or lower it because the change looks risky; that is severity, not confidence. scores is always []. productionReadiness.status is exactly "Partially Ready" for compatibility only. productionReadiness.reason describes Evidence Quality and must not describe readiness, approval, blocking, or a release decision.`;

/**
 * The model behind Release Review, configurable like the other free tools.
 *
 * It was hard-coded to gpt-4o while Quick Generate and Coverage Review moved to
 * a reasoning model, and its reviews read generic by comparison ("ensure the
 * worker is robust"). Reasoning models reject a custom temperature and spend
 * part of the completion budget thinking, so both are set accordingly.
 */
const RELEASE_REVIEW_MODEL = process.env.OPENAI_RELEASE_REVIEW_MODEL?.trim() || "gpt-5-mini";
const usesReasoningModel = /^(gpt-5|o\d)/.test(RELEASE_REVIEW_MODEL);

function modelSettings(temperature: number) {
    return usesReasoningModel
        ? { model: RELEASE_REVIEW_MODEL, max_completion_tokens: 16_000, reasoning_effort: "low" as const }
        : { model: RELEASE_REVIEW_MODEL, temperature, max_completion_tokens: 5_000 };
}

async function requestInitialAnalysis(
    client: OpenAI,
    context: AnalysisContext,
    requestId: string
) {
    return client.chat.completions.create(
        {
            ...modelSettings(0.15),
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content: `Analyze the submitted software change. Treat every "Not provided" value as unavailable evidence. Use explicit application, role, downstream-consumer, feature-flag, and rollout names in relevant findings so the analysis remains traceable to the submission. Return only the required JSON contract.\n\n${buildSubmittedEvidence(
                        context
                    )}`,
                },
            ],
        },
        { headers: { "X-Client-Request-Id": requestId } }
    );
}

async function requestControlledRepair(
    client: OpenAI,
    context: AnalysisContext,
    currentResponse: string,
    failures: string[],
    requestId: string
) {
    return client.chat.completions.create(
        {
            ...modelSettings(0),
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content: `Repair the current response once. Correct only the listed validation failures while preserving grounded, distinct findings. Return only the corrected JSON contract. Do not explain the repair.

ORIGINAL SUBMITTED EVIDENCE
${buildSubmittedEvidence(context)}

CURRENT PARSED RESPONSE
${currentResponse}

EXACT VALIDATION FAILURES
${failures.map((failure, index) => `${index + 1}. ${failure}`).join("\n")}`,
                },
            ],
        },
        { headers: { "X-Client-Request-Id": requestId } }
    );
}

function parseModelResponse(raw: string) {
    try {
        return {
            parsed: JSON.parse(cleanJson(raw)) as unknown,
            failure: "",
        };
    } catch {
        return {
            parsed: null,
            failure: "The model response is not valid JSON.",
        };
    }
}

function normalizeComparable(value: string) {
    return value
        .toLowerCase()
        .replace(/^p[012]\s*[—:-]\s*/, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function tokenSimilarity(left: string, right: string) {
    const leftTokens = new Set(normalizeComparable(left).split(" ").filter(Boolean));
    const rightTokens = new Set(normalizeComparable(right).split(" ").filter(Boolean));

    if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

    let intersection = 0;
    for (const token of leftTokens) {
        if (rightTokens.has(token)) intersection += 1;
    }

    return intersection / new Set([...leftTokens, ...rightTokens]).size;
}

function isSubstantiallyIdentical(
    left: Record<string, unknown>,
    right: Record<string, unknown>
) {
    const leftTitle = cleanText(left.title);
    const rightTitle = cleanText(right.title);
    const leftImpact = cleanText(left.impact);
    const rightImpact = cleanText(right.impact);

    return (
        normalizeComparable(`${leftTitle} ${leftImpact}`) ===
            normalizeComparable(`${rightTitle} ${rightImpact}`) ||
        (tokenSimilarity(leftTitle, rightTitle) >= 0.85 &&
            tokenSimilarity(leftImpact, rightImpact) >= 0.85)
    );
}

function allNarrativeText(result: Record<string, unknown>) {
    const values = [cleanText(result.executiveSummary)];
    const readiness = result.productionReadiness;

    if (typeof readiness === "object" && readiness !== null) {
        values.push(cleanText((readiness as Record<string, unknown>).reason));
    }

    for (const key of findingArrayKeys) {
        const items = result[key];

        if (!Array.isArray(items)) continue;

        for (const item of items) {
            if (typeof item !== "object" || item === null) continue;
            const finding = item as Record<string, unknown>;
            values.push(
                cleanText(finding.title),
                cleanText(finding.impact),
                cleanText(finding.evidence),
                cleanText(finding.recommendation)
            );
        }
    }

    return values.join("\n");
}

function textMentionsAny(text: string, values: string[]) {
    const normalizedText = text.toLowerCase();

    return values.some((value) => normalizedText.includes(value.toLowerCase()));
}

function validateModelResult(value: unknown, context: AnalysisContext) {
    const failures: string[] = [];

    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return ["The response must be a JSON object with the required top-level structure."];
    }

    const result = value as Record<string, unknown>;
    const requiredTopLevelKeys = [
        "overallScore",
        "executiveSummary",
        "scores",
        "productionReadiness",
        ...findingArrayKeys,
    ];
    const allowedTopLevelKeys = new Set(requiredTopLevelKeys);

    for (const key of requiredTopLevelKeys) {
        if (!(key in result)) failures.push(`Missing top-level key: ${key}.`);
    }
    for (const key of Object.keys(result)) {
        if (!allowedTopLevelKeys.has(key)) {
            failures.push(`Unexpected top-level key: ${key}.`);
        }
    }

    if (typeof result.overallScore !== "number") {
        failures.push("overallScore must be a number.");
    }
    if (!cleanText(result.executiveSummary)) {
        failures.push("Impact Summary must be meaningful and non-empty.");
    }
    if (!Array.isArray(result.scores) || result.scores.length !== 0) {
        failures.push("scores must be an empty array.");
    }

    if (
        typeof result.productionReadiness !== "object" ||
        result.productionReadiness === null ||
        Array.isArray(result.productionReadiness)
    ) {
        failures.push("productionReadiness must contain status and reason.");
    } else {
        const readiness = result.productionReadiness as Record<string, unknown>;
        const readinessKeys = Object.keys(readiness);
        if (
            readinessKeys.some((key) => !["status", "reason"].includes(key)) ||
            readinessKeys.length !== 2
        ) {
            failures.push(
                "productionReadiness must contain only status and reason."
            );
        }
        if (readiness.status !== "Partially Ready") {
            failures.push(
                'productionReadiness.status must be exactly "Partially Ready" for compatibility.'
            );
        }
        if (!cleanText(readiness.reason)) {
            failures.push("productionReadiness.reason must describe Evidence Quality.");
        }
    }

    for (const key of findingArrayKeys) {
        const items = result[key];

        if (!Array.isArray(items)) {
            failures.push(`${key} must be an array.`);
            continue;
        }
        if (items.length > MAX_FINDINGS_PER_SECTION) {
            failures.push(`${key} contains more than four findings.`);
        }

        const validItems: Record<string, unknown>[] = [];

        items.forEach((item, index) => {
            if (typeof item !== "object" || item === null || Array.isArray(item)) {
                failures.push(`${key}[${index}] is not a valid finding object.`);
                return;
            }

            const finding = item as Record<string, unknown>;
            validItems.push(finding);
            const findingKeys = Object.keys(finding);
            if (
                findingKeys.some(
                    (field) =>
                        ![
                            "title",
                            "severity",
                            "impact",
                            "evidence",
                            "recommendation",
                        ].includes(field)
                ) ||
                findingKeys.length !== 5
            ) {
                failures.push(
                    `${key}[${index}] must contain only title, severity, impact, evidence, and recommendation.`
                );
            }

            for (const field of ["title", "impact", "evidence", "recommendation"]) {
                if (cleanText(finding[field]).length < 8) {
                    failures.push(`${key}[${index}].${field} must be meaningful and non-empty.`);
                }
            }
            if (!severityValues.includes(finding.severity as Severity)) {
                failures.push(`${key}[${index}].severity is invalid.`);
            }
            if (!evidencePrefixPattern.test(cleanText(finding.evidence))) {
                failures.push(`${key}[${index}].evidence needs a valid evidence prefix.`);
            }
            if (
                key === "recommendedActions" &&
                !/^P[012] — \S/.test(cleanText(finding.title))
            ) {
                failures.push(
                    `${key}[${index}].title must begin with P0 —, P1 —, or P2 —.`
                );
            }
        });

        for (let left = 0; left < validItems.length; left += 1) {
            for (let right = left + 1; right < validItems.length; right += 1) {
                if (isSubstantiallyIdentical(validItems[left], validItems[right])) {
                    failures.push(
                        `${key} contains substantially identical findings at positions ${left + 1} and ${right + 1}.`
                    );
                }
            }
        }
    }

    for (const key of requiredFindingKeys) {
        if (!Array.isArray(result[key]) || result[key].length === 0) {
            failures.push(`${key} must contain at least one meaningful finding.`);
        }
    }

    const narrative = allNarrativeText(result);
    const narrativeLower = narrative.toLowerCase();
    const releaseDecisionPattern =
        /\b(?:ready for (?:production|release)|not ready|go[- ]?\/[- ]?no[- ]?go|release approval|approved for (?:production|release)|safe to (?:deploy|release)|do not (?:ship|deploy|release)|block(?:ed|s|ing)? (?:the )?(?:release|deployment))\b/i;

    if (releaseDecisionPattern.test(narrative)) {
        failures.push("Narrative text contains prohibited release-decision language.");
    }

    if (
        !context.sourceBundle &&
        /\b(?:we |i )?(?:inspected|examined|reviewed) (?:the )?(?:code|source|files)|\b(?:source code|implementation|file [^\n.]+) (?:shows|confirms|demonstrates|proves)\b/i.test(
            narrative
        )
    ) {
        failures.push(
            "The response claims file or implementation inspection without submitted source evidence."
        );
    }

    if (
        context.affectedApplications.length > 0 &&
        !textMentionsAny(narrative, context.affectedApplications)
    ) {
        failures.push("Explicit affected application or service context was ignored.");
    }
    if (context.userRoles.length > 0 && !textMentionsAny(narrative, context.userRoles)) {
        failures.push("Explicit user-role context was ignored.");
    }
    if (
        context.downstreamConsumers.length > 0 &&
        !textMentionsAny(narrative, context.downstreamConsumers)
    ) {
        failures.push("Explicit downstream-consumer context was ignored.");
    }
    if (
        context.sourceBundle &&
        context.uploadedFileNames.length > 0 &&
        !textMentionsAny(narrative, context.uploadedFileNames)
    ) {
        failures.push("Submitted source evidence file names were not referenced.");
    }

    const rolloutIsExplicit =
        Boolean(context.rolloutContext || context.featureFlagName) ||
        context.featureFlagStatus === "Yes" ||
        (context.rolloutStrategy && context.rolloutStrategy !== "Not decided");

    if (rolloutIsExplicit) {
        if (
            !Array.isArray(result.performanceIntelligence) ||
            result.performanceIntelligence.length === 0
        ) {
            failures.push(
                "Operational and Rollout Effects cannot be empty when rollout or feature-flag context is explicit."
            );
        }

        const rolloutTerms = [
            context.featureFlagName,
            context.rolloutStrategy,
            context.featureFlagStatus === "Yes" ? "feature flag" : "",
        ].filter(Boolean);

        if (rolloutTerms.length > 0 && !textMentionsAny(narrative, rolloutTerms)) {
            failures.push("Explicit feature-flag or rollout context was ignored.");
        }
    }

    if (
        context.downstreamConsumers.length > 0 &&
        (!Array.isArray(result.architectureIntelligence) ||
            result.architectureIntelligence.length === 0)
    ) {
        failures.push(
            "Downstream and Indirect Effects cannot be empty when downstream consumers are explicit."
        );
    }

    const securityInput = [
        context.changeSummary,
        context.expectedBehavior,
        ...context.changeCategories,
    ].join(" ");
    const securityIsRelevant =
        /\b(?:authentication|authorization|permission|security|privacy|database|schema|data integrity|mfa|login|access control)\b/i.test(
            securityInput
        );

    if (
        securityIsRelevant &&
        (!Array.isArray(result.securityIntelligence) ||
            result.securityIntelligence.length === 0)
    ) {
        failures.push(
            "Security, Data, and Permission Effects cannot be empty for the submitted security, access, data, or schema context."
        );
    }

    const downstreamIsRelevant = /\b(?:api|contract|integration|webhook|event|consumer)\b/i.test(
        [context.changeSummary, context.expectedBehavior, ...context.changeCategories].join(
            " "
        )
    );

    if (
        downstreamIsRelevant &&
        (!Array.isArray(result.architectureIntelligence) ||
            result.architectureIntelligence.length === 0)
    ) {
        failures.push(
            "Downstream and Indirect Effects cannot be empty for the submitted API, contract, or integration context."
        );
    }

    if (
        context.rolloutContext &&
        !narrativeLower.includes(context.rolloutContext.toLowerCase()) &&
        !context.rolloutContext
            .toLowerCase()
            .split(/\W+/)
            .filter((token) => token.length >= 5)
            .some((token) => narrativeLower.includes(token))
    ) {
        failures.push("Explicit rollout or rollback details were not used.");
    }

    return [...new Set(failures)];
}

function truncateWords(value: string, maximum: number) {
    const words = value.split(/\s+/).filter(Boolean);

    return words.length <= maximum
        ? value
        : `${words.slice(0, maximum).join(" ")}…`;
}

function calculateEvidenceConfidence(context: AnalysisContext) {
    let score = 0;
    score += context.changeSummary.length >= 30 ? 12 : 8;
    score += context.expectedBehavior.length >= 30 ? 14 : 10;
    score += context.beforeBehavior ? 8 : 0;
    score += context.acceptanceCriteria ? 8 : 0;
    score += context.sourceBundle ? 22 : 0;
    score += context.uploadedFileNames.length >= 2 ? 4 : context.uploadedFileNames.length;
    score += context.changeCategories.length > 0 ? 4 : 0;
    score += context.affectedApplications.length > 0 ? 7 : 0;
    score += context.userRoles.length > 0 ? 6 : 0;
    score += context.downstreamConsumers.length > 0 ? 7 : 0;
    score +=
        context.rolloutContext || context.rolloutStrategy !== "Not decided" ? 6 : 0;
    score += context.featureFlagName ? 2 : 0;

    const hasOnlyRequired =
        !context.beforeBehavior &&
        !context.acceptanceCriteria &&
        !context.sourceBundle &&
        context.changeCategories.length === 0 &&
        context.affectedApplications.length === 0 &&
        context.userRoles.length === 0 &&
        context.downstreamConsumers.length === 0 &&
        !context.rolloutContext &&
        context.rolloutStrategy === "Not decided" &&
        !context.featureFlagName;

    if (hasOnlyRequired) score = Math.min(score, 39);
    if (!context.sourceBundle) score = Math.min(score, 79);

    return Math.max(0, Math.min(100, score));
}

function buildEvidenceQualityReason(context: AnalysisContext) {
    const supplied: string[] = ["change summary", "expected behavior"];
    const missing: string[] = [];

    if (context.beforeBehavior) supplied.push("before behavior");
    else missing.push("before behavior");
    if (context.acceptanceCriteria) supplied.push("acceptance criteria");
    if (context.sourceBundle) supplied.push("implementation evidence");
    else missing.push("implementation evidence");
    if (context.affectedApplications.length > 0) supplied.push("system context");
    else missing.push("system context");
    if (context.downstreamConsumers.length > 0) supplied.push("dependency context");
    else missing.push("dependency context");
    if (
        context.rolloutContext ||
        context.rolloutStrategy !== "Not decided" ||
        context.featureFlagName
    ) {
        supplied.push("rollout context");
    } else {
        missing.push("rollout context");
    }

    return `Confidence is based on ${supplied.join(", ")}. Specificity is limited by missing ${missing.join(", ") || "no major evidence category"}.`;
}

function toValidatedFinding(item: unknown): Finding {
    const finding = item as Record<string, unknown>;

    return {
        title: cleanText(finding.title),
        severity: finding.severity as Severity,
        impact: cleanText(finding.impact),
        evidence: cleanText(finding.evidence),
        recommendation: cleanText(finding.recommendation),
    };
}

function normalizeValidatedResult(value: unknown, context: AnalysisContext) {
    const result = value as Record<string, unknown>;

    const normalized: AnalysisResult = {
        overallScore: calculateEvidenceConfidence(context),
        executiveSummary: truncateWords(cleanText(result.executiveSummary), 120),
        scores: [],
        productionReadiness: {
            status: "Partially Ready",
            reason: buildEvidenceQualityReason(context),
        },
        criticalFindings: [],
        architectureIntelligence: [],
        testIntelligence: [],
        securityIntelligence: [],
        performanceIntelligence: [],
        maintainabilityIntelligence: [],
        recommendedActions: [],
    };

    for (const key of findingArrayKeys) {
        normalized[key] = (result[key] as unknown[])
            .slice(0, MAX_FINDINGS_PER_SECTION)
            .map(toValidatedFinding);
    }

    return normalized;
}

export function buildReleaseReviewContext(body: Record<string, unknown>): AnalysisContext {
    const changeSummary = firstNonEmptyText(body.changeSummary, body.projectSummary);
    const expectedBehavior = firstNonEmptyText(
        body.expectedBehavior,
        body.afterBehavior
    );
    const affectedApplications = firstNonEmptyList(
        body.affectedApplications,
        body.affectedApplication,
        body.affectedService
    );

    const legacyFeatureFlagContext = firstNonEmptyText(body.featureFlagContext);
    const usefulFeatureFlagContext = /^(?:status:\s*)?(?:unknown|no)$/i.test(
        legacyFeatureFlagContext
    )
        ? ""
        : legacyFeatureFlagContext;

    return {
        projectName: firstNonEmptyText(body.projectName, body.changeTitle),
        changeSummary,
        expectedBehavior,
        beforeBehavior: firstNonEmptyText(body.beforeBehavior),
        acceptanceCriteria: firstNonEmptyText(body.acceptanceCriteria),
        sourceBundle: firstNonEmptyText(body.sourceBundle),
        uploadedFileNames: firstNonEmptyList(body.uploadedFileNames),
        changeCategories: firstNonEmptyList(body.changeCategories),
        affectedApplications,
        userRoles: firstNonEmptyList(body.userRoles),
        featureFlagStatus: firstNonEmptyText(body.featureFlagStatus) || "Unknown",
        featureFlagName: firstNonEmptyText(body.featureFlagName),
        rolloutStrategy:
            firstNonEmptyText(body.rolloutStrategy) || "Not decided",
        rolloutContext: firstNonEmptyText(
            body.rolloutContext,
            usefulFeatureFlagContext
        ),
        downstreamConsumers: firstNonEmptyList(body.downstreamConsumers),
        repositoryUrl: firstNonEmptyText(body.repositoryUrl),
        selectedFocus: firstNonEmptyList(body.selectedFocus),
        reviewMode: getReviewMode(body.reviewMode),
        depth: getReviewDepth(body.depth),
    };
}

export class ReleaseReviewProviderError extends Error {
    constructor(readonly code: "configuration_missing" | "invalid_output", readonly failures: string[] = []) {
        super(code);
        this.name = "ReleaseReviewProviderError";
    }
}

export type ReleaseReviewResult = ReturnType<typeof normalizeValidatedResult> & {
    model: string;
    provider: {
        requestId: string | null;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        repaired: boolean;
    };
};

/**
 * One review: the model's report, checked, repaired once if the check failed,
 * and normalised. Throws when no attempt produced a report worth showing.
 */
export async function reviewRelease(
    context: AnalysisContext,
    options: { requestId?: string } = {},
): Promise<ReleaseReviewResult> {
    let apiKey: string;
    try {
        apiKey = validateOpenAiEnvironment().OPENAI_API_KEY;
    } catch {
        throw new ReleaseReviewProviderError("configuration_missing");
    }
    const client = new OpenAI({ apiKey });
    const requestId = options.requestId ?? "";

    const initialCompletion = await requestInitialAnalysis(client, context, requestId);
    const completions = [initialCompletion];
    const initialRaw = initialCompletion.choices[0]?.message?.content ?? "";
    let candidate = parseModelResponse(initialRaw);
    let failures = candidate.failure ? [candidate.failure] : validateModelResult(candidate.parsed, context);

    if (failures.length > 0) {
        const repairCompletion = await requestControlledRepair(
            client,
            context,
            candidate.parsed ? JSON.stringify(candidate.parsed) : initialRaw || "No parseable response was returned.",
            failures,
            requestId,
        );
        completions.push(repairCompletion);
        const repairRaw = repairCompletion.choices[0]?.message?.content ?? "";
        candidate = parseModelResponse(repairRaw);
        failures = candidate.failure ? [candidate.failure] : validateModelResult(candidate.parsed, context);
    }

    if (failures.length > 0 || !candidate.parsed) {
        throw new ReleaseReviewProviderError("invalid_output", failures);
    }

    const usage = completions.reduce(
        (total, completion) => ({
            inputTokens: total.inputTokens + (completion.usage?.prompt_tokens ?? 0),
            outputTokens: total.outputTokens + (completion.usage?.completion_tokens ?? 0),
            totalTokens: total.totalTokens + (completion.usage?.total_tokens ?? 0),
        }),
        { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    );

    return {
        ...normalizeValidatedResult(candidate.parsed, context),
        model: RELEASE_REVIEW_MODEL,
        provider: {
            requestId: completions.at(-1)?._request_id ?? null,
            ...usage,
            repaired: completions.length > 1,
        },
    };
}
