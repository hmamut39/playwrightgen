# Checkpoint Status

This is the authoritative roadmap ledger. Update it whenever a milestone is
completed, materially changed, or blocked.

The durable next-session handoff is maintained in
[`docs/NEXT_SESSION_ROADMAP.md`](./NEXT_SESSION_ROADMAP.md). Read it before
starting the next checkpoint and update it at the end of every work session.

| Checkpoint | Status | Evidence |
| --- | --- | --- |
| 1. Dependencies/environment | Complete | Commit `3691461`; dependency and environment baseline established. |
| 2. PostgreSQL/Prisma tenant foundation | Complete | Commit `92da6dc`; tenant schema, migration, and database constraint tests. |
| 3. Clerk workspace/authentication | Complete | Commit `f8916f7`; Clerk-protected `/workspace`, onboarding, organization switching, and workspace shell. First-party `/sign-in` and `/sign-up` routes now preserve the workspace return URL and avoid reliance on the hosted Account Portal for the complete interactive flow. |
| 4. Clerk -> PostgreSQL synchronization | Complete | Signed Clerk `user.deleted` delivery reached the local route through Clerk's relay and returned `200`; PostgreSQL stored a soft-deleted record; identical message replay returned `duplicate`. The real development organization, user, and membership were reconciled, followed by a zero-drift dry run. Unit, integration, typecheck, lint, and build validation are recorded in the checkpoint commit. |
| 5. Tenant-safe authorization | Complete | Server-only `requireWorkspaceContext` resolves Clerk identity through synchronized User/Organization/Membership, scopes projects by organization, enforces roles/permissions and archived-resource allowances, and passes cross-tenant 401/403/404 integration tests. |
| 6. Project domain services + Activity | Complete | Tenant-scoped project list/create/read/update/archive/restore and member assignment/removal/role change services; active-member checks and mutation Activity share transactions; role and cross-tenant integration tests pass. |
| 7. Real workspace Projects experience | Complete | `/workspace/[orgSlug]`, project creation, and project overview render synchronized PostgreSQL state through tenant-safe project services; archive/restore controls are permission-aware; 78 tests, typecheck, changed-file lint, and production build pass. |
| V1.1 Requirements + immutable versions | Complete | Tenant/project-scoped Requirement and RequirementVersion schema, migration, draft/review/approve/archive services, optimistic concurrency, transactional Activity, permission-aware real UI, and development/test migration evidence. |
| V1.2 AI Requirement Review | Complete | Structured OpenAI output, exact-version evidence validation, persistent model/prompt/schema/usage metadata, safe failure records, reviewable suggestions, non-mutating accept/dismiss actions, tenant/role tests, and real Requirement UI. |
| V1.3 Test Cases + traceability | Complete | Tenant/project-scoped TestCase and immutable TestCaseVersion schema; review workflow; optimistic concurrency; composite RequirementTestCase traceability; transactional Activity; real UI; 102 tests and development/test migration evidence. |
| V1.4 Test Runs + execution evidence | Complete | Runs pin an approved immutable TestCaseVersion; append-only attempts capture result, mode, environment, browser, duration, per-step outcomes, failure details, and evidence links; aggregate concurrency, roles, Activity, tenant constraints, real UI, 110 tests, and development/test migrations pass. |
| V1.5 Failure Intelligence | Complete | OpenAI Responses API Structured Outputs classify failed/blocked immutable attempts; local exact-quote evidence validation, model/prompt/schema/token metadata, safe failure records, human confirm/dismiss, tenant/role enforcement, real Test Run UI, 118 tests, and development/test migrations pass. |
| V1.6 Automation artifacts + engines | Complete | Separate Playwright Browser/API engines create append-only artifacts pinned to approved immutable Test Case versions; OpenAI Responses Structured Outputs, deterministic safety/quality validation, safe failed generations, preserved approved revisions, human review/approval, tenant/role enforcement, real Automation Studio UI, 128 tests, and development/test migrations pass. |
| V1.6.1 Product surface unification | Complete | Evidence-workflow homepage and unified navigation; focused Quick Generate/Coverage Review/Release Review surfaces; Debug relocated conceptually to failed Test Runs; Figma removed from the product surface; Responses API Structured Outputs for new public generation/review flows; no invented coverage score; real tenant-scoped Continue in Workspace transitions that create human-reviewable AI-suggested Requirement or Test Case drafts without importing unapproved code. |
| V1.7 Project quality intelligence | Complete | Tenant-scoped Quality Command Center derives approved Requirement-to-Test Case coverage, current-version automation coverage, superseded automation, recent run health, unresolved findings, and evidence freshness from PostgreSQL records; every actionable gap links to its source, missing evidence remains explicit, no synthetic readiness score is produced, 136 tests pass, and public/workspace navigation and pricing use the refined shared visual system. |
| V1.8 Repository, CI, and isolated execution | In progress | Least-privilege GitHub App and isolated-runner decisions recorded; composite-tenant installation/connection/import schema; immutable repository inventory; signed idempotent lifecycle handling; and an Owner/Admin setup flow with expiring state, PKCE, GitHub user-installation verification, strict App permission verification, live repository discovery, and provider-verified project connection. The flow handles both new and existing installations without reinstalling: an existing numeric installation ID is signed into the tenant/project state but remains untrusted until the same GitHub user-access and App checks pass. Preview verified and bound installation `157602553`, then connected the cross-owner public repository `hasan-gen/playwrightgen`. The first immutable import pinned `main@e65879da`, found three support files, and correctly reported incomplete evidence because that branch has no Playwright config or specs. The exact-ref import then pinned `hasan_genai@58814e3a` and succeeded with one Playwright config, 24 spec files, 190 test declarations, and three support files. Neon Preview branch `br-hidden-mode-ax99b5h6` was created schema-only, matched all nine migrations, and remains isolated; Clerk reconciliation reports zero drift. Commit `58814e3` deployed as immutable Preview `dpl_514c7AdqXsyeB65odPBjnhGD1Rug`, and hosted CI run `33337224482` passed for full SHA `58814e3aba30dbc345eb85b00014c1c904a0dc4a`. A Clerk-supported authenticated Preview harness now covers every Workspace surface, exact-ref evidence, and fail-closed tenant boundaries while keeping browser state ignored and Vercel bypass support secret-only. Live authenticated execution awaits a dedicated test principal and explicitly approved automation bypass. Isolated webhooks, repository-owner recovery or deliberate transfer, runner implementation, artifact storage, and PR reporting remain. |
| Production billing foundation | In progress | Commit `92c68bf` models Stripe state per PostgreSQL Organization rather than email: one customer binding per organization, organization-scoped subscriptions, materialized entitlements, signed and digest-idempotent lifecycle deliveries, stale-event rejection, cross-tenant conflict checks, a checkout launch kill switch, test/live isolation, customer portal access, and an authenticated Billing surface. Hosted CI run `33447222445` applied all migrations to fresh PostgreSQL and passed the complete validation job. Vercel built Ready Preview `dpl_Hxb1NgtN4aWvPaDNwZEXJCFncyK5`; this is build evidence only because the isolated Preview database migration and Stripe test-mode lifecycle E2E remain. Checkout stays disabled until those, reconciliation, and support/legal gates pass. |
| Production AI safety foundation | In progress | Active public AI routes now reserve atomic burst/daily Redis quota before provider work, HMAC client addresses instead of storing raw IPs, propagate request IDs, emit allowlisted structured telemetry, and impose finite output-token ceilings. Authenticated Workspace AI also reserves one Organization-scoped budget before provider work. Superseded public AI routes remain present but are quarantined with `410` by default, preventing their legacy unbounded provider and URL-fetch paths from executing; a temporary server-only override now retains a generic, content-free failure boundary. Commit `ee4569a` passed hosted CI run `33567562584`; dependency-remediated checkpoint `3b838ef` passed enforced audit, fresh migrations, all 191 tests, Chromium, and build in run `33569718657`, and Vercel Preview `dpl_52T11stgWRKdhYAhirwsj33dZ2r4` is Ready. Protected live route behavior, monitoring alert delivery, evals, and plan-specific entitlement limits remain. |
| V1.9 Execution loop (customer CI) | In progress | Generated Playwright specs now carry a deterministic `[pwg:<testCaseVersionId>]` marker, and `POST /api/runs/ingest` accepts results from the customer's own GitHub Actions, verifying an HMAC over the exact raw body against a per-project token derived from `RUNNER_INGEST_SECRET`. Results map to the pinned immutable `TestCaseVersion` and append `TestRunAttempt` evidence attributed to the human who created the active `RepositoryConnection`; ingest fails closed when no connection is active. Deliveries are idempotent per CI run, and reporting never fails a customer's suite. This deliberately supersedes the isolated-runner prerequisite in `docs/GITHUB_AND_RUNNER_ARCHITECTURE.md` for the first slice: PlaywrightGen executes no repository code, so the sandbox, egress, and escape-test gates do not apply. Rationale and limits in `docs/EXECUTION_LOOP.md`. 223 tests, typecheck, lint, and production build pass locally. Workspace UI for the token, automatic stamping at artifact approval, artifact upload, ingest quotas, and Preview end-to-end proof remain; token rotation is still global. |
| Figma-to-code removal | Complete | The design-to-code surface was removed rather than revived: `app/api/generate/route.ts` dropped from 821 to 608 lines and no Figma reference remains in `app/`, `components/`, or `lib/`. Visual regression testing remains a future on-strategy capability; design-to-code does not. |
| V1.10 Run signals: flaky vs regression | In progress | `TestRunAttempt` now stores `commitSha` and `sourceRef` structurally (migration `20260904230000_v1_attempt_source_identity`, additive and nullable, with a 40-hex check), so a failure can be compared against earlier evidence instead of parsed out of summary text. `classifyRuns` is a pure function over attempt facts returning `STABLE`, `FLAKY`, `REGRESSION`, `INTENT_CHANGED`, `NEW_FAILURE`, or `INSUFFICIENT`: the same approved version failing and passing on one commit is unreliable; passing on an earlier commit and failing on a later one is an application regression; passing evidence only on a different approved version is reported as changed intent rather than a regression, because calling deliberate change a regression would be a false accusation. Attempts without a recorded revision yield no verdict rather than a guess. Surfaced as a badge on Test Runs and an explained verdict on the run detail. 11 unit tests cover the rules exhaustively and 2 integration tests prove the chain from CI ingest through classification. Not built: surfacing signals in Quality, failure-analysis integration, and flake-rate trends over time. |
| V1.11 Release readiness and project risk | In progress | `getReleaseReadiness` composes approved coverage, current automation, run signals, and unreviewed findings into explicit blockers and cautions rather than a score. A percentage would compress away the detail a reviewer needs and let missing evidence average into something acceptable, so none is produced and a test asserts the response carries no `score`, `percentage`, or `grade`. A project with no execution evidence is reported as blocked, not ready, because absence of evidence is not a pass. Reachable from a Release tab and printable. `getOrganizationProjectRisk` surfaces regressions, flaky tests, unreviewed findings, and last evidence on the Projects list so a lead can see which project needs attention without opening each one; it is organization-scoped because the authorization guard rejects project permissions when no project is in scope. 10 integration tests. Not built: exporting the report, per-requirement drill-down inside it, and trend history. |
| V1.12 Failure Intelligence grounded in history | In progress | Failure analysis previously received a single immutable attempt while still being asked to distinguish flaky timing from a product defect, which is not decidable from one execution; the model was guessing. It now receives an `EXECUTION_HISTORY` evidence field computed deterministically by `classifyRuns` over prior attempts of the same approved version, carrying the verdict, its supporting revisions, and attempt counts. The system prompt names this field as the one authoritative input among otherwise untrusted evidence and directs the classification accordingly: reproducible on one revision favours `FLAKY_TIMING`, passing on an earlier revision and failing on a later one favours `PRODUCT_DEFECT` and forbids attributing the failure to flakiness, changed intent forbids calling it a regression, and absent history forbids inferring either. Prompt and schema versions moved to `failure-analysis-v2`, so stored analyses remain interpretable against the prompt that produced them. Integration tests assert the verdict reaches the analyzer for a regression and that a single attempt with no recorded revision yields neither a regression nor a flakiness hint. Not built: showing the history alongside stored findings in the UI, and evals measuring whether the grounded prompt changes classification accuracy. |

### 2026-09-04 Preview database resolution

The drift is resolved, and the earlier diagnosis was wrong in a way worth
recording. The ledger attributed it to branch-scoped Vercel variables; a direct
read of the project environment showed **no branch-scoped variables exist at
all**. The single Preview `DATABASE_URL` had simply been overwritten.

The accepted branch was never lost. Connecting to it directly reports
`neon.project_id restless-frost-04247280` and `neon.branch_id
br-hidden-mode-ax99b5h6` — the ledgered target — still holding the prior
evidence: one organization, one project, and two repository imports.

The one missing migration, `20260831190000_v1_organization_billing`, was applied
through `scripts/migrate-verified.mjs` with `EXPECTED_NEON_PROJECT_ID` and
`EXPECTED_NEON_BRANCH_ID` set, so the fail-closed target check passed before
Prisma started. All ten migrations are now applied and the existing records are
intact. Preview `DATABASE_URL` and `DIRECT_URL` were then set to that branch's
pooled and direct endpoints respectively, and `RUNNER_INGEST_SECRET` was added,
both marked Sensitive. Preview was redeployed and is Ready.

Data-flow evidence recorded before 2026-09-04 still predates this correction and
should not be treated as proven against the current target.

### 2026-09-01 release-audit correction

The schema-only Preview branch `br-hidden-mode-ax99b5h6` was valid at the
recorded import checkpoint, but a new read-only audit proves current
branch-scoped Vercel Preview variables resolve to Neon project/branch
`restless-frost-04247280/br-restless-dawn-axyqbc68`. That target lacks both the
pending billing migration and the earlier repository-import row. No migration
was run. Restore the accepted target or independently validate the replacement
before accepting new Preview data-flow evidence.

## Checkpoint 4 delivered behavior

- Verifies Clerk webhook signatures before parsing provider data.
- Synchronizes users, organizations, and organization memberships by Clerk ID.
- Soft-deletes users, archives organizations, and removes memberships.
- Rejects stale state changes and treats repeated event IDs as duplicates.
- Bootstraps Owner only from verified organization creator evidence.
- Writes append-only, PII-safe Activity for effective organization/membership
  changes without raw provider payloads.
- Provides a safe, scoped, dry-run-first reconciliation command.

## Next acceptance target

Validate the new AI safety foundation in hosted CI while preserving the green
billing baseline. Then deploy the additive billing migration only to the
isolated Preview database and exercise Stripe test-mode lifecycle events with
checkout still locked. In parallel, provision the dedicated Clerk test
principal and request explicit approval before creating a Vercel automation
bypass for authenticated Preview E2E. Keep remote execution and paid Production
disabled.
