# Execution Loop

This document describes how generated Playwright tests actually run and become
immutable evidence. It replaces the isolated-runner approach in
`docs/GITHUB_AND_RUNNER_ARCHITECTURE.md` for the first execution slice.

## Decision: run in the customer's CI, not in our sandbox

The isolated runner contract requires a sandbox with non-root execution,
default-deny egress, DNS rebinding defenses, a malicious fixture corpus, and
sandbox-escape tests before any repository code may run. That is a large,
security-critical subsystem, and until it exists the product cannot close its
core loop: generate a test, run it, capture evidence, analyze the failure.

The customer's own GitHub Actions runners remove that entire problem. Their code
executes on their infrastructure, against their environment, with their secrets.
PlaywrightGen receives only a bounded result summary. There is no
PlaywrightGen-operated sandbox, so none of the sandbox gates apply.

The isolated runner remains the right answer later, for customers who want
PlaywrightGen to execute tests on their behalf. It is no longer a prerequisite
for evidence.

## Flow

1. An automation artifact is generated for an approved Test Case version. During
   generation, `applyTestCaseVersionMarker` stamps `[pwg:<testCaseVersionId>]`
   into the first `test(` title, before validation runs. The marker is inserted
   deterministically rather than requested from the model, because a language
   model transcribing a UUID incorrectly would silently detach a result from its
   evidence.
2. A reviewer approves the artifact. The marker is already present in the code
   they reviewed, so approval changes nothing about it.
3. The customer commits the spec and two workflow files from
   `templates/github-actions/`.
4. On push, GitHub Actions runs Playwright with the JSON reporter.
5. `playwrightgen-report.mjs` flattens the report, keeps only recorded fields,
   signs the exact request body with the project ingest token, and posts it to
   `POST /api/runs/ingest`.
6. The route verifies the signature, then `ingestPlaywrightResults` maps each
   marked result to its pinned `TestCaseVersion` and appends a `TestRunAttempt`.

## Authorization

Ingest tokens are derived, never stored:

```
token = base64url(HMAC-SHA256(
  RUNNER_INGEST_SECRET,
  "pwg:runner:v2:<orgId>:<projectId>:<Project.runnerTokenVersion>"
))
```

The tenant identity in the request body is untrusted until the HMAC over the
exact raw bytes verifies against the token derived for that same tenant. A
payload naming another organization cannot be signed without that
organization's token, and the body is never treated as authority before
verification.

Attempts are attributed to the human who created the project's active
`RepositoryConnection`, so `executedByUserId` remains a real, auditable user
rather than a synthetic account. Ingest fails closed with `403` when no active
connection exists.

**Rotation is per project.** Folding `Project.runnerTokenVersion` into the
derivation makes revocation local: incrementing it invalidates that project's
token immediately and touches no other project. Rotating is exposed on the
Repositories panel and recorded as `PROJECT_UPDATED` Activity with
`change: runner_token_rotated`; the token itself is never written to Activity or
logs.

The route reads the project's current version before deriving, so a rotated token
stops verifying at once. A payload naming a project that does not exist is
answered with `invalid_signature` rather than `404`, so an unauthenticated caller
cannot enumerate organization and project pairs by watching the status code.

## Quotas

`reserveRunIngest` reserves capacity for the organization after the signature
verifies and before any evidence is written. Reserving earlier would let an
unauthenticated caller exhaust a tenant's allowance by posting garbage.

Two windows, bounding different risks. The per-minute window bounds request rate
and protects the endpoint. The daily window counts **results**, not requests,
because one accepted post can carry hundreds and that is what writes rows and
costs storage; limiting requests alone would let a misconfigured workflow insert
a very large number of attempts while appearing well inside its quota.

Defaults are deliberately generous — 60 requests per minute and 20,000 results
per day, overridable with `RUN_INGEST_MINUTE_LIMIT` and
`RUN_INGEST_DAILY_RESULT_LIMIT`. A limit that trips during ordinary work trains
people to ignore it.

A batch that would cross the daily limit is refused whole rather than partially
recorded, because half a run's evidence is worse than none: it looks complete.

The guard fails closed. If the limiter is unreachable the request is answered
`503` rather than admitted unmetered, and because the reporter exits zero on
error the customer's suite stays green and the next push retries.

## Idempotency

GitHub retries and re-runs must not inflate evidence. Each attempt records a
`LINK` evidence entry labelled `CI run <run_id>-<run_attempt>`. Before inserting,
the transaction checks for an existing attempt carrying that exact label and URL.
The conditional `updateMany` on `latestAttemptNumber` serializes concurrent
deliveries for the same Test Run, so a duplicate either matches the check or
loses that update.

## Failure posture

Reporting is observability, not a gate. If ingest is unreachable or returns an
error, the reporter logs and exits `0`; a PlaywrightGen outage never turns a
customer's green suite red. The workflow's own pass/fail is decided solely by
Playwright.

## Configuration

Server: `RUNNER_INGEST_SECRET`, at least 32 characters, server-only.

Customer repository secret: `PLAYWRIGHTGEN_TOKEN`.
Customer repository variables: `PLAYWRIGHTGEN_ORG_ID`, `PLAYWRIGHTGEN_PROJECT_ID`,
`PLAYWRIGHTGEN_URL`, and optionally `PLAYWRIGHTGEN_ENVIRONMENT` and
`PLAYWRIGHTGEN_BASE_URL`.

### Deployment Protection

Preview deployments run behind Vercel Deployment Protection, which rejects
unauthenticated requests at the edge: an unsigned `POST /api/runs/ingest`
returns `401` from Vercel before the route executes. CI therefore cannot report
into a protected deployment without the project's automation bypass, supplied as
the optional `VERCEL_PROTECTION_BYPASS` repository secret.

The distinction that makes this acceptable: the bypass grants **reachability,
not authority**. A request that gets past the edge is still rejected unless its
HMAC signature verifies against the token derived for the tenant it names. A
leaked bypass secret lets someone reach the endpoint and receive `401`s; it does
not let them write evidence into any project.

Production behind a custom domain is not protected this way, so the bypass is a
Preview concern rather than a permanent requirement.

## Workspace surface

The project Repositories page shows the ingest token and the three variables a
repository needs, gated on `repository:connect` because the token authorizes
writing evidence into the project. It stays hidden until an active
`RepositoryConnection` exists, since attempts are attributed to that connection's
creator. When `RUNNER_INGEST_SECRET` is absent the panel says so rather than
failing.

Generated code is stamped automatically during
`generateAutomationArtifact`, before validation, so the reviewed code and the
stored code are byte-identical.

## What the evidence makes possible

Because every attempt records both the immutable Test Case version it exercised
and the exact revision it ran against, `lib/services/run-signals.ts` can separate
three failures that most tools collapse into "a test failed":

| Version | Commit | Prior evidence | Verdict |
| --- | --- | --- | --- |
| same | same | also passed | the test is unreliable |
| same | newer | passed on an earlier commit | the application regressed |
| newer | any | only an older version passed | the intent changed |

The third row is the one worth protecting. A team that deliberately changes what
a test should assert has not caused a regression, and reporting one would erode
trust in every other verdict. Attempts recorded without a revision produce no
verdict at all rather than a guess.

## Bounded history

Verdicts consider attempts from the last `SIGNAL_WINDOW_DAYS` (90), capped at
`SIGNAL_ATTEMPT_CAP` (20,000), through the single loader in
`lib/services/run-signals.ts`.

This is not an optimisation, it is a correctness requirement. Attempts are the
fastest-growing table once CI reports on every push, and the Projects list, the
Test Runs list, the Release report, and failure analysis all classify runs. Read
unbounded, each of those pages would get measurably slower every day a customer
used the product.

A time window rather than a bare row cap: a cap alone drops arbitrary rows, so a
verdict would depend on which ones happened to survive. Ninety days keeps the
comparison meaningful, since evidence older than that usually describes an
application that has moved on, and the count cap exists only as a ceiling for
pathological volumes.

Anything comparing runs must use `loadAttemptFacts` rather than querying
attempts directly.

## Not yet built

- Trace, screenshot, and video artifact upload and retention.
- Preview end-to-end proof against a real repository.

No claim of proven execution should be made until the Preview proof exists.
