export const FREE_PLAN = {
  name: "Free",
  priceLabel: "$0",
  intervalLabel: "",
  features: [
    "5 generations per day",
    "User flow to Playwright draft",
    "HTML or JSX evidence input",
    "API contract test generation",
    "Component behavior test generation",
    "Copy and download output",
    "Continue as a reviewed Workspace draft",
  ],
};

export const PRO_PLAN = {
  name: "Team",
  priceLabel: "$19",
  intervalLabel: "per workspace, per month",
  trialLabel: "7 days free",
  features: [
    "150 AI operations per day, shared across the workspace",
    "CI result ingestion with traces, screenshots and video",
    "Automatic failure analysis on every failed run",
    "Release evidence reports you can print or attach to a ticket",
    "Immutable requirement, test case and run history",
    "Unlimited projects and workspace members",
  ],
};

export const APP_LIMITS = {
  freeDailyGenerations: 5,
};

export const PRO_WAITLIST_COPY = {
  title: "Join the Team + CI waitlist",
  description:
    "Get launch updates when GitHub, isolated execution, entitlements, and team support are ready.",
  buttonText: "Join waitlist",
};
