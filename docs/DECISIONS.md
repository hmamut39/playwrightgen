# Architecture Decisions

## 001 — Evolve the brownfield application

**Decision:** Use strangler-style evolution rather than replacing the existing
application.

**Reason:** Existing generator and intelligence features are working assets.
Project-aware replacements can reuse them while reducing migration risk.

## 002 — Split identity proof from domain authority

**Decision:** Clerk proves user and external organization identity; PostgreSQL
owns domain roles, access, projects, records, archive state, and audit history.

**Reason:** Server-side domain authorization needs durable, queryable,
tenant-scoped state. Email and client-controlled organization identifiers are
not authorization authority.

## 003 — Treat Clerk webhooks as eventually consistent input

**Decision:** Verify signatures before processing, normalize an allowlisted
payload, process serializable transactions, track provider update time and last
event ID, soft-delete, and support scoped reconciliation.

**Reason:** Webhook delivery is retryable and eventually consistent. Duplicate
and out-of-order events must not duplicate Activity or overwrite newer state.

## 004 — Restrict reconciliation scope

**Decision:** Reconciliation requires exactly one organization ID or slug, is
dry-run by default, and writes only with `--apply`.

**Reason:** A bounded repair tool is safer to inspect and operate than an
implicit all-tenant sweep.

## 005 — Use provider IDs as synchronization keys

**Decision:** `clerkUserId`, `clerkOrganizationId`, and `clerkMembershipId`
identify synchronized records. Email is descriptive data only.

**Reason:** Emails change and are not a secure or stable identity boundary.

## 006 — Use Clerk's first-party relay for local webhook proof

**Decision:** Prefer the official Clerk CLI relay for development webhook
testing. Keep the relay URL and endpoint signing secret out of source control.

**Reason:** It avoids publishing the entire local application through a generic
tunnel and limits external-account work to endpoint configuration and test
delivery.

## 007 — Derive domain authority from synchronized server state

**Decision:** `requireWorkspaceContext` starts from Clerk's authenticated user
and active organization, then resolves local User, Organization, Membership,
optional Project, and optional ProjectMembership. Caller IDs and slugs can only
narrow that authenticated context.

**Reason:** This prevents caller-controlled tenant selection, email-based
authorization, and unscoped project lookup while providing consistent
401/403/404 semantics for future APIs and Server Actions.

## 008 — Keep project mutations and Activity atomic

**Decision:** Project state transitions and their Activity records execute in
the same Prisma transaction. Project and ProjectMembership lookups include the
organization boundary; archive and removal update status rather than delete.

**Reason:** Audit history must describe committed state exactly, and composite
tenant scoping prevents guessed or foreign identifiers from crossing tenants.

## 009 — Put the first workspace UI directly over domain services

**Decision:** Server components read through tenant-safe project services and
Server Actions mutate through the same services. Route parameters constrain
the authenticated tenant but never establish authority.

**Reason:** One authorization and transaction boundary keeps the initial UI
thin, prevents browser-provided organization or project IDs from bypassing
domain rules, and avoids duplicating an internal HTTP API before it is needed.

## 010 — Separate current Requirement state from immutable snapshots

**Decision:** `Requirement` is the current workflow record and every material
draft edit creates a new `RequirementVersion` snapshot. Draft updates require
the expected current version. Approved content cannot use the draft-update
path.

**Reason:** Queries remain practical while historical content is preserved for
traceability. Optimistic version checks prevent a stale form from overwriting a
newer draft.

## 011 — Make Requirement workflow transitions conditional and explicit

**Decision:** Draft, review, approval, change-request, and archive operations
are named domain transitions. State changes use conditional updates and write
Activity in the same transaction. Project Leads may draft/submit; Owner/Admin
alone may approve/archive.

**Reason:** Explicit transitions make approval authority auditable and prevent
concurrent requests from recording duplicate effective state changes.

## 012 — Persist AI advice separately from authoritative domain content

**Decision:** Requirement review writes generic `AiRun` and `AiSuggestion`
records tied to one immutable RequirementVersion. Accept/Dismiss changes only
suggestion state. Requirement content changes remain explicit versioned user
actions.

**Reason:** AI remains assistive and auditable. Model output cannot silently
rewrite or approve the authoritative requirement.

## 013 — Require structured output and locally verifiable evidence

**Decision:** The provider uses OpenAI Structured Outputs with a Zod schema,
handles refusals, and validates quoted evidence against the selected immutable
version before persistence. Model, prompt/schema versions, and token usage are
recorded.

**Reason:** Schema adherence alone cannot prove factual grounding. Local
evidence checks and version references make suggestions inspectable and safer.

## 014 — Version test intent independently from workflow state

**Decision:** `TestCase` holds current workflow state and every material draft
edit creates an immutable `TestCaseVersion`. Requirement traceability is a
composite organization/project relationship with database enforcement.

**Reason:** Approved intent, historical edits, and coverage links must remain
auditable without mutable history or application-only tenant checks.

## 015 — Keep automation engines separate from Test Case intent

**Decision:** Playwright browser, API, and future integration engines consume
an approved TestCaseVersion and produce separate reviewable artifacts.
`automationStatus` tracks lifecycle but stores no generated code.

**Reason:** Different engines need different inputs, validation, and artifacts.
Separation supports distinct functionality/versioning without mutating test
intent.

## 016 — Pin Test Runs to immutable approved intent

**Decision:** A Test Run references both a Test Case and one exact immutable
TestCaseVersion. Creation is allowed only while that Test Case is approved.

**Reason:** Later edits or archival must not change what an historical run was
intended to verify, and mismatched versions must be rejected by the database.

## 017 — Append execution attempts instead of editing evidence

**Decision:** Overall Run status is a query-friendly aggregate, while each
manual, Playwright Browser, or API attempt is append-only. A conditional
attempt counter serializes concurrent writes; retries create new evidence.

**Reason:** Failed and passing results are operational evidence. Preserving
every attempt enables trustworthy failure analysis, audit, and trend history.

## 018 — Require evidence-bound, reviewable failure classification

**Decision:** Failure Intelligence analyzes exactly one immutable failed or
blocked attempt through Structured Outputs. Every finding must cite an exact
stored evidence quote; local validation runs before persistence. Findings are
advisory until a Lead or Owner/Admin confirms or dismisses them.

**Reason:** A valid JSON schema cannot prevent invented root causes. Evidence
validation, provider metadata, safe failures, and human resolution make AI
analysis inspectable without corrupting execution history.

## 019 — Version generated automation independently from approved test intent

**Decision:** One engine-specific `AutomationArtifact` pins an approved
`TestCaseVersion`. Every generation appends an immutable artifact version with
structured plan/code/configuration, provider metadata, and local validation.
The current draft and last approved version are tracked independently.

**Reason:** Generated code changes more frequently than approved test intent.
Separate Browser/API engines, deterministic blocking rules, preserved approval
history, and explicit human transitions prevent AI output from silently
becoming trusted or executable automation.

## 020 — Keep interactive authentication on first-party application routes

**Decision:** PlaywrightGen mounts Clerk's supported SignIn and SignUp
components at `/sign-in` and `/sign-up`. Protected workspace requests preserve
their return URL but redirect to the local sign-in route instead of depending
on the hosted Account Portal for the complete interactive flow.

**Reason:** A first-party route keeps the user inside the product, provides a
recoverable branded experience, and avoids making workspace access depend on
browser-specific behavior at a cross-site hosted sign-in page. Clerk still
proves identity; PostgreSQL authorization and organization scoping are
unchanged.

## 021 — Keep public AI output preliminary and import only reviewed draft intent

**Decision:** Quick Generate and Coverage Review use the OpenAI Responses API
with Structured Outputs and local deterministic checks. Public results display
their evidence limits and never claim execution, measured coverage, approval,
or release readiness. Continue in Workspace stores a short-lived browser-tab
handoff, requires authentication and project selection, validates the payload
again on the server, and creates only an `AI_SUGGESTED` Requirement or Test Case
draft through tenant-scoped domain services. Generated code is not imported as
trusted automation.

**Reason:** A free prompt result has no durable project authority or approved
test intent. Converting it directly into approved automation would bypass
versioning, RBAC, review, and evidence requirements. A reviewed draft preserves
useful momentum while keeping PostgreSQL and the existing approval workflows
authoritative.

## 022 — Derive project quality intelligence from source-linked records

**Decision:** The project Quality Command Center computes its signals only from
tenant-scoped PostgreSQL records: approved Requirements, approved Test Cases and
their traceability links, approved Automation artifacts pinned to immutable Test
Case versions, immutable Test Run attempts, and reviewed Failure findings. It
shows numerator-and-denominator counts, explicit missing evidence, deterministic
freshness bands, and source links. It does not collapse those records into an AI
readiness or release-confidence score.

**Reason:** A scalar score would hide whether confidence comes from approved
intent, current automation, execution evidence, or assumptions. Source-linked
counts let a project lead inspect and act on the exact gap while preserving
uncertainty. The service first resolves project access through
`requireWorkspaceContext`, then scopes every query by both `organizationId` and
`projectId`; cross-tenant and Viewer-read behavior are covered by integration
tests.

## 023 — Use a least-privilege GitHub App and immutable repository imports

**Decision:** PlaywrightGen will integrate through a GitHub App rather than a
user-owned personal access token. The initial app requests only repository
metadata and read-only Contents access, and subscribes only to installation and
installation-repository lifecycle events. Each verified GitHub installation is
bound to exactly one PlaywrightGen Organization. Each selected repository is
then connected to an explicit project through composite organization/project
keys. Installation access tokens are minted server-side for one installation,
restricted to the selected repository and `contents:read`, allowed to expire,
and never stored in PostgreSQL, browser state, Activity, logs, or AI prompts.

Repository imports are immutable snapshots identified by repository, commit
SHA, and parser version. They preserve source ref, file paths, blob SHAs,
timestamps, and derived inventory only; the first slice does not persist source
file bodies. Imported configuration and tests are preliminary evidence. They
do not create approved Test Cases, approved Automation, passing Test Runs, or
release-readiness claims. GitHub Checks write access, pull-request events,
workflow modification, and repository writes are deferred until their separate
CI-reporting milestone is reviewed.

**Reason:** A GitHub App supports repository selection, narrow permissions,
short-lived installation credentials, and auditable installation lifecycle.
Separating Organization installation ownership from project repository use,
and enforcing both at the database boundary, prevents guessed identifiers or a
shared installation from crossing tenants. Immutable, source-linked imports
make later parsing improvements reviewable without treating repository content
as trusted execution input.

## 024 — Keep repository discovery separate from isolated execution

**Decision:** The Next.js application may authenticate, inventory repository
trees, parse bounded text files, and enqueue execution requests, but it must
never install dependencies or execute repository commands. A future runner
accepts one immutable repository import and an allowlisted Playwright command,
runs in an ephemeral sandbox with explicit CPU, memory, wall-clock, process,
filesystem, output, and network limits, exposes no application or GitHub App
credentials, uploads content-addressed artifacts through single-job scoped
credentials, and is destroyed after completion. Result ingestion is
idempotent and binds every artifact to the Organization, project, repository
import, execution job, and attempt.

**Reason:** Repository contents, package lifecycle scripts, test code, browser
targets, and downloaded dependencies are untrusted. A container alone does not
establish the required boundary. Separating the control plane from disposable
workers prevents a malicious test suite from reaching tenant data or durable
credentials and makes cancellation, quotas, evidence retention, and incident
response enforceable.

## 025 — Preserve Debug and Figma capabilities but align them to quality evidence

**Decision:** The legacy Debug and Figma implementation remains available in
source and will return to the product surface through clearer QA jobs. Quick
Debug may provide explicitly preliminary help for pasted failures, while the
authoritative diagnosis remains attached to an immutable failed Test Run with
logs, steps, and artifacts. Figma/screenshot input will become Visual Testing:
derive reviewable scenarios, visual assertions, accessibility expectations,
and versioned baseline evidence. Generic UI-code generation remains a
secondary legacy utility rather than PlaywrightGen's main promise.

**Reason:** Both capabilities are useful acquisition and workflow inputs, but
top-level generic tools can fragment the product. Connecting them to durable
test intent and evidence preserves user value while strengthening the product's
identity as an AI quality platform.

## 026 — Treat GitHub webhooks as signed, idempotent access revocation input

**Decision:** Verify the exact raw body with the separately stored GitHub
webhook secret and `X-Hub-Signature-256` before parsing. Record each
`X-GitHub-Delivery` once with a SHA-256 payload digest and normalized event
metadata, never the raw payload. Process only installation and
installation-repository lifecycle actions. Suspension or removal blocks new
imports immediately; removal and explicit repository removal transition
connections to access-removed state without deleting historical imports. An
ambiguous all-to-selected transition fails closed until repository access is
reverified.

**Reason:** GitHub deliveries can be replayed, redelivered, delayed, or arrive
after repository access changes. Signature verification proves integrity,
delivery identity prevents duplicate side effects, digest comparison detects
conflicting replay, and conservative revocation prevents stale access from
being treated as current authorization evidence.

## 027 — Verify the installing GitHub user before binding tenant authority

**Decision:** A GitHub setup redirect never trusts the installation ID by
itself. The initiating PlaywrightGen Owner/Admin and exact organization/project
are bound into a signed ten-minute state. After installation, a second signed
state and PKCE-protected GitHub user authorization prove that the current
GitHub user can access the installation. PlaywrightGen then authenticates as
the App, requires an active installation with metadata/contents read only, and
only then binds it to PostgreSQL. User and installation tokens are transient.

**Reason:** GitHub documents that setup URLs can be called with spoofed
installation IDs. App authentication proves that an installation belongs to
the App but does not prove that the current user controls it. Combining local
authorization, signed state, PKCE, user-installation access, and App
verification closes both boundaries without making GitHub identity a
PlaywrightGen authorization authority.

An Owner/Admin may also continue an already-installed App by supplying its
numeric installation ID through the authenticated project setup page. The ID
is treated only as an untrusted locator: PlaywrightGen signs it into the same
tenant/project/user state, then requires the identical PKCE GitHub user-access
check and App-authenticated installation verification before binding it. This
avoids destructive reinstall instructions without granting authority from the
installation ID itself.

## 028 — Permit verified public evidence without repository ownership

**Decision:** A tenant-bound active GitHub App installation may verify and
import a canonical public GitHub repository URL even when that repository is
owned by a different GitHub account. PlaywrightGen resolves the repository
through GitHub using the short-lived installation token, requires GitHub to
report `PUBLIC` visibility, confirms the returned owner and repository name
match the requested locator, and only then creates the project-scoped
connection. Public snapshot tokens omit repository-selection narrowing because
the repository is not owned by the installation account; they retain only
`contents:read`. Private and internal repositories continue to require live
membership in the installation's selected repository list and a
repository-restricted token.

**Reason:** Public source evidence is intentionally readable without repository
ownership, and requiring ownership would prevent legitimate analysis of open
source projects, dependencies, examples, and repositories administered through
another identity. The active installation still supplies an accountable,
tenant-bound GitHub integration and higher provider limits. Strict URL parsing,
live visibility verification, composite organization/project boundaries,
bounded parsing, no retained source bodies, and disabled execution prevent the
public path from weakening private repository authorization or evidence trust.

## 029 — Use a schema-only database branch for deployment Preview

**Decision:** Vercel Preview uses a dedicated Neon branch created with parent
schema only, never a data clone of Production. Before accepting the branch, an
exact Prisma migrations-to-database diff must report no schema drift. Existing
migrations may be baselined only after that proof, and future migrations use
the direct connection with an isolated shadow database when development drift
checks require one. Runtime traffic uses the pooled connection. Clerk identity
and organization records are reconciled explicitly into Preview; domain rows
are created through Preview workflows.

**Reason:** A realistic Preview needs production-shaped constraints without
copying customer or operational data into a less trusted environment. Schema
comparison plus migration baselining preserves Prisma's migration history,
while an isolated branch, shadow database, and explicit identity reconciliation
prevent accidental writes to Production and make empty-state behavior honest.

## 030 â€” Make organization-scoped PostgreSQL entitlements billing authority

**Decision:** One PlaywrightGen Organization owns at most one Stripe Customer.
Stripe subscriptions and materialized feature entitlements are stored under the
same `organizationId`; email is never a billing or authorization key. Checkout
requires an authenticated Owner/Admin and an explicit environment kill switch.
The customer portal remains available when new sales are paused. Signed Stripe
lifecycle deliveries are recorded once by event ID and payload digest, reject
cross-organization customer/subscription reuse, ignore unrecognized prices, and
cannot overwrite a newer provider state with an older event. Test and live
events are separated explicitly by environment configuration.

**Reason:** Payment identity, workspace authorization, and feature access must
share one durable tenant boundary. Stripe retries events and does not guarantee
delivery order, while email can change or be supplied by an attacker. A signed,
idempotent organization projection in PostgreSQL keeps access auditable and
revocable without making Stripe or Redis the application's authorization store.

## 031 — Reserve bounded AI capacity before provider work

**Decision:** Every active public AI surface atomically reserves both burst and
daily Redis capacity before converting attachments or calling OpenAI. The
public key contains an HMAC fingerprint rather than a raw client address.
Authenticated Workspace AI shares an Organization-scoped capacity boundary,
while PostgreSQL remains the future authority for plan-specific entitlement
selection. Provider requests use bounded output-token settings and request IDs;
public operational events use a strict allowlist and never include prompts,
uploads, raw exceptions, or PII. Legacy AI endpoints remain addressable during
migration but return `410 Gone` unless a deliberate server-only override is
configured.

**Reason:** A read-then-increment limiter can be bypassed by concurrent requests
and counts only successful calls after the cost is incurred. Atomic preflight
reservation bounds both abuse and spend. Tenant-scoped budgets prevent one
Workspace from consuming another's capacity, request IDs enable provider
support without exposing content, and quarantining unused legacy endpoints
closes unbounded generation and server-side URL-fetch paths without deleting
their migration history.

## 032 — Verify database identity before deployment migrations

**Decision:** Preview and Production migrations require explicit
`EXPECTED_NEON_PROJECT_ID` and `EXPECTED_NEON_BRANCH_ID` values. The migration
wrapper connects through the configured direct URL, reads Neon identity from
PostgreSQL itself, and exits before Prisma when either identity differs. The
redacted inspection command may report host, database, Neon identity, latest
migration, and aggregate record counts, but never credentials or row content.

**Reason:** Environment labels and connection-variable names do not prove which
database will be changed. Branch-scoped Vercel configuration can drift, and a
valid Neon URL can still target the wrong branch. Provider-reported identity
turns a documented intention into a fail-closed technical boundary and keeps
backup, migration, and rollback evidence tied to the exact database target.

## 033 — Treat dependency advisories as a release gate

**Decision:** Production and development dependency audits must be reviewed
before a release candidate. Security upgrades are applied deliberately, with
framework, ORM, and webhook-library versions pinned together where required;
`npm audit fix --force` is prohibited as an unattended release action. Any
transitive override must be explicit and must pass Prisma validation, unit and
integration tests, typecheck, lint, browser checks, production build, and
hosted fresh-database CI.

**Reason:** A successful application test suite does not make a framework
advisory safe, while an automatic forced fix can silently introduce a breaking
major downgrade. Explicit remediation plus the complete validation matrix
closes known vulnerabilities without trading them for unreviewed runtime or
schema risk.

## 034 — Keep webhook telemetry content-free and correlatable

**Decision:** Signed Clerk, GitHub, and Stripe endpoints emit only an allowlisted
operational event containing a generated request ID, provider surface, safe
outcome/code, and duration. The same request ID is returned in the response.
Raw bodies, signatures, delivery identifiers, provider errors, and domain/PII
fields are never copied into logs; durable idempotency evidence remains in
tenant-scoped PostgreSQL records.

**Reason:** Webhook failures must be diagnosable without turning the log system
into an unbounded copy of identity, repository, or billing payloads. A local
request ID connects provider response evidence to deployment logs, while the
database delivery record supplies the authorized provider identity and replay
state.

## 035 — Bound preview waitlist data and notification abuse

**Decision:** The public team waitlist accepts a small validated JSON body,
reserves one HMAC-client request per minute before storage or email work,
deduplicates addresses in a versioned Redis sorted set, and removes entries
older than 180 days during writes. Only a newly added address can trigger one
plain-text notification. Logs contain a request ID and safe code but no email,
provider error, raw address, or reversible client address.

**Reason:** A public email form otherwise becomes an unbounded PII store and an
email-spend/notification abuse path. A declared preview retention boundary,
deduplication, pre-work throttling, and content-free logs minimize data and cost
while the final consent, deletion, and launch communications policy is reviewed.

## 036 — Make API security boundaries an exhaustive checked inventory

**Decision:** Every App Router API route is classified as tenant-authenticated,
signed webhook, bounded public, or legacy-quarantined. A unit gate discovers
route files from the repository, requires the inventory to be exhaustive, and
requires each route to retain a boundary-specific implementation marker. New
routes fail CI until their boundary and behavior tests are explicit.

**Reason:** Authorization review becomes stale when it is only a document or a
one-time grep. Exhaustive discovery prevents a newly added endpoint from being
silently omitted, while boundary markers and existing negative behavior tests
make accidental removal of tenant auth, signature verification, pre-work
limits, or quarantine visible before deployment.

## 037 — Keep temporary legacy-route failures content-free

**Decision:** A server-only migration override may temporarily re-enable a
quarantined legacy AI route, but its unexpected failure path must use one
shared responder. The responder returns only a fixed user-safe message and
code, attaches a request ID and `no-store`, and emits allowlisted operational
telemetry without accepting the caught exception as input. Nested URL-context
failures also fall back silently without logging provider or target details.

**Reason:** Quarantine is the primary production control, but a migration flag
must not reactivate historical raw-exception logging or provider-message
leakage. A helper that cannot receive the exception makes the safe boundary
structural and keeps temporary diagnostics correlatable without copying
secrets, response bodies, URLs, or user content into logs.
