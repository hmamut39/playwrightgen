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

/**
 * How long a new workspace gets the Team allowance for nothing.
 *
 * Here, rather than in the service that applies it, because the pricing page
 * advertises it and a number that is advertised in one file and enforced in
 * another drifts. It did: the page said "7 days free" while
 * `lib/services/entitlements.ts` granted fourteen, and a third constant --
 * also called TRIAL_DAYS, also 7 -- was Stripe's subscription trial in the
 * checkout route. Three lengths, two of them sharing a name.
 *
 * A visitor cannot know those are different trials. They read 7, pressed
 * "Start the 7 days free", and got a workspace with fourteen days of Team.
 * Advertising less than is given is the safer direction and still wrong: a
 * team plans an evaluation around the number on the page.
 *
 * Found on 2026-11-21 inside a report a visitor left on 2026-11-07 -- "the
 * pricing page says checkout is disabled but the button still looks
 * clickable" -- which had been sitting unread in the store because the
 * notification mail was failing.
 */
export const OPENING_TRIAL_DAYS = 14;

export const PRO_PLAN = {
  name: "Team",
  priceLabel: "$19",
  intervalLabel: "per workspace, per month",
  trialLabel: `${OPENING_TRIAL_DAYS} days free`,
  features: [
    "60 AI operations per day, shared across the workspace",
    "CI result ingestion with traces, screenshots and video",
    "Automatic failure analysis on every failed run",
    "Release evidence reports you can print or attach to a ticket",
    "Immutable requirement, test case and run history",
    "Team roles: members write, leads approve, nobody approves their own work",
    "Use approved tests from VS Code, Cursor and Claude Code (MCP)",
    "Unlimited projects and workspace members",
    "Free tools without the 5-a-day limit, using your workspace allowance",
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
