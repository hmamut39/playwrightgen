/** Types and fixed option lists for the Release Review page. */

export type Severity = "Critical" | "High" | "Medium" | "Low";

export type Finding = {
    title: string;
    severity: Severity;
    impact: string;
    evidence: string;
    recommendation: string;
};

export type EngineeringReviewResult = {
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

export type EvidenceFile = {
    id: string;
    name: string;
    size: number;
    content: string;
};

export type FeatureFlagStatus = "Yes" | "No" | "Unknown";

export const allowedExtensions = [
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

export const changeCategories = [
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

export const suggestedRoles = [
    "Customer",
    "Administrator",
    "Support Agent",
    "Internal Employee",
    "Partner",
    "Anonymous User",
    "Service Account",
    "Other",
];

export const rolloutStrategies = [
    "Not decided",
    "Immediate rollout",
    "Internal users first",
    "Percentage rollout",
    "Role-based rollout",
    "Region-based rollout",
    "Feature-flag rollout",
    "Custom",
];

export const rolloutNeedsContext = new Set([
    "Internal users first",
    "Percentage rollout",
    "Role-based rollout",
    "Region-based rollout",
    "Feature-flag rollout",
    "Custom",
]);

export const changeImpactFocus = [
    "architecture",
    "testing",
    "security",
    "performance",
    "production",
];

/**
 * A worked example, filled in by one click.
 *
 * This form asks for more than a dozen fields, and someone arriving for the
 * first time has no way to tell whether "change summary" wants a sentence or a
 * design document. Guessing wrong produces a shallow review, which reads as the
 * tool being weak rather than the input being thin.
 *
 * The example is deliberately a change with real risk surface -- it moves work
 * off the request path, alters who can act, and has downstream consumers -- so
 * the review it produces demonstrates what the tool actually looks for instead
 * of returning generic advice about a trivial change.
 */
export const exampleReview = {
    projectName: "Move refund approval to an async queue",
    changeSummary:
        "Refunds over $500 currently block the support agent's request while a synchronous call to the payment provider completes, which times out under load. This change writes the refund to a durable queue and returns immediately; a worker calls the provider and settles the refund within a few minutes. Support agents keep the same button, but the confirmation now says the refund is pending rather than complete.",
    expectedBehavior:
        "Submitting a refund over $500 returns within 300ms with a Pending status. The refund settles to Completed once the worker succeeds, or to Failed with a reason the agent can read. Refunds are never applied twice, even if the worker retries.",
    beforeBehavior:
        "The agent waits for the payment provider inline. Under load the call exceeds the 30s gateway timeout, the agent sees a generic error, and it is not possible to tell from the UI whether the refund was actually issued. Agents retry, which has caused duplicate refunds.",
    acceptanceCriteria:
        `1. A refund over $500 returns Pending in under 300ms.
2. A settled refund moves to Completed and appears in the customer's ledger exactly once.
3. A provider failure moves the refund to Failed with an agent-readable reason, and does not silently disappear.
4. Submitting the same refund twice creates one refund, not two.
5. Refunds under $500 keep their existing synchronous behavior.`,
    categories: ["API / Contract", "Data Integrity", "Integration", "Feature Flag / Rollout"],
    affectedApplications: ["Support Console", "Payments Service", "Ledger"],
    roles: ["Support Agent", "Administrator", "Customer"],
    featureFlagStatus: "Yes" as FeatureFlagStatus,
    featureFlagName: "async_refund_queue",
    rolloutStrategy: "Internal users first",
    rolloutContext:
        "Enabled for the internal support team for one week, then 10% of agents, then all. Rollback is flipping the flag off, which returns to the synchronous path; refunds already queued still settle.",
    downstreamConsumers: ["Finance reconciliation export", "Customer ledger", "Partner refund webhook"],
};
