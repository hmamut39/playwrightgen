export type ApiRouteSecurityPolicy = {
  boundary:
    | "authenticated-tenant"
    | "bounded-public"
    // Unauthenticated by design and safe only while it stays bounded and
    // opaque: component states with no hostnames, error text, or versions, and
    // a cache so repeated calls cannot load the dependencies it reports on.
    | "public-status"
    | "legacy-quarantined"
    | "signed-webhook";
  requiredMarker: string;
};

export const API_ROUTE_SECURITY_POLICY = {
  "analyze/route.ts": {
    boundary: "legacy-quarantined",
    requiredMarker: "legacyAiRouteQuarantine",
  },
  "billing-portal/route.ts": {
    boundary: "authenticated-tenant",
    requiredMarker: "requireWorkspaceContext",
  },
  "check-pro/route.ts": {
    boundary: "authenticated-tenant",
    requiredMarker: "requireWorkspaceContext",
  },
  "checkout/route.ts": {
    boundary: "authenticated-tenant",
    requiredMarker: "requireWorkspaceContext",
  },
  "checkout-session/route.ts": {
    boundary: "authenticated-tenant",
    requiredMarker: "requireWorkspaceContext",
  },
  "health/route.ts": {
    boundary: "public-status",
    requiredMarker: "HEALTH_CACHE_MS",
  },
  "coverage-review/route.ts": {
    boundary: "bounded-public",
    requiredMarker: "reservePublicAiRequest",
  },
  "debug/route.ts": {
    boundary: "legacy-quarantined",
    requiredMarker: "legacyAiRouteQuarantine",
  },
  "engineering-review/route.ts": {
    boundary: "bounded-public",
    requiredMarker: "reservePublicAiRequest",
  },
  "explain/route.ts": {
    boundary: "legacy-quarantined",
    requiredMarker: "legacyAiRouteQuarantine",
  },
  "generate/route.ts": {
    boundary: "legacy-quarantined",
    requiredMarker: "legacyAiRouteQuarantine",
  },
  "github/setup/callback/route.ts": {
    boundary: "authenticated-tenant",
    requiredMarker: "requireWorkspaceContext",
  },
  "github/setup/installed/route.ts": {
    boundary: "authenticated-tenant",
    requiredMarker: "requireWorkspaceContext",
  },
  "github/setup/start/route.ts": {
    boundary: "authenticated-tenant",
    requiredMarker: "requireWorkspaceContext",
  },
  "intelligence/route.ts": {
    boundary: "legacy-quarantined",
    requiredMarker: "legacyAiRouteQuarantine",
  },
  "quick-generate/route.ts": {
    boundary: "bounded-public",
    requiredMarker: "reservePublicAiRequest",
  },
  "runs/ingest/route.ts": {
    boundary: "signed-webhook",
    requiredMarker: "verifyRunnerSignature",
  },
  "stripe/webhook/route.ts": {
    boundary: "signed-webhook",
    requiredMarker: "constructEvent",
  },
  "waitlist/route.ts": {
    boundary: "bounded-public",
    requiredMarker: "playwrightgen:waitlist:limit",
  },
  "webhooks/clerk/route.ts": {
    boundary: "signed-webhook",
    requiredMarker: "verifyWebhook",
  },
  "webhooks/github/route.ts": {
    boundary: "signed-webhook",
    requiredMarker: "verifyGitHubWebhookSignature",
  },
} as const satisfies Record<string, ApiRouteSecurityPolicy>;
