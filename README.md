# PlaywrightGen

Playwright tests written from your real page, run until they pass, and kept as
evidence a person approved.

Live at [playwrightgen.com](https://playwrightgen.com).

Writing a Playwright test is no longer the hard part — every editor has an
assistant that will do it. What none of them keep is the thing an audit, a
release decision or a customer actually asks for: which behaviour was agreed,
by whom, at which version, and what the last run proved. That record is what
this product is.

## How it works

Two ways in, one chain.

**The free tools** need no account. Say what to test, paste a public URL, and
PlaywrightGen reads the page, writes a test from its real accessibility tree,
runs it in a remote browser, and fixes the failing step until it passes. You
get working code and the run that proves it, signed so the evidence survives
if you later bring it into a workspace. Nothing durable is claimed until you
do.

**The workspace** turns that into a record:

1. A **Requirement** is drafted, reviewed and approved. Approving writes an
   immutable version.
2. **Test Cases** carry objective, steps and expected results, are approved
   the same way, and link to the Requirements they verify.
3. **Automation** is generated from an approved Test Case version, validated
   against deterministic rules, proven on the live page, and then approved by
   a person — never by the generator and never by an agent.
4. **Run evidence** arrives from your own CI. Your tests run on your runners,
   against your environment, with your secrets; only a bounded summary of
   results is sent. A `[pwg:...]` marker in the test title is what ties a
   result to the approved version it is evidence for.
5. **A proof link** shares the result outside the team: a signed URL anybody
   can open, with an acceptance signature and a downloadable file they can
   keep.

Every claim on that chain names its source. A requirement with no passing test
says so; a run that was skipped says it proved nothing; a report that was
bounded says how much it did not cover.

## What holds it honest

- **A prompt is a request; a validator is a rule.** Every promise a prompt
  makes has a deterministic check behind it: no focused tests, no fixed
  sleeps, no credentials in the file, no request to an address that is not the
  application under test, no Node capability a browser test has no business
  reaching for.
- **A repair may not weaken a test.** The quickest way to make a failing
  assertion pass is to delete it, so a fix that checks less than the test it
  was given is refused.
- **Separation of duties.** The person who proposed something cannot be the
  one who approves it; the MCP server can propose and send code and has no
  capability to approve, accept, share or delete, which a test enforces by
  reading the import graph.
- **Every AI surface is measured.** `npm run evals` grades each prompt
  deterministically against structured output and compares the run with a
  hand-blessed baseline.

## For agents (MCP)

PlaywrightGen is an MCP server, so Claude Code, Cursor or Copilot can read the
approved intent instead of guessing: sixteen tools covering requirements, test
cases, approved automation, recent failures, writing and proving a test on a
live page, and proposing drafts for review. An agent gets exactly the rights
of the person whose token it used.

## Running it locally

```bash
npm install
npm run dev
```

Then `npm run test:run` for the suite, `npm run typecheck`, `npm run lint`,
and `npm run build`. Integration tests need `TEST_DATABASE_URL` pointing at a
database used for nothing else; they refuse anything that looks like
production.

Built with Next.js, TypeScript, PostgreSQL (Prisma), Clerk, Tailwind,
Playwright, OpenAI and Stripe.

## Environment

Runtime:

- `DATABASE_URL` — PostgreSQL for the application.
- `DIRECT_URL` — optional direct connection preferred by migration commands.
- `TEST_DATABASE_URL` — a separate database for integration tests. It never
  falls back to either of the above.
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
  `CLERK_WEBHOOK_SIGNING_SECRET`
- `OPENAI_API_KEY` — server-only. Per-surface model overrides exist, for
  example `OPENAI_REQUIREMENT_REVIEW_MODEL` and
  `OPENAI_FAILURE_ANALYSIS_MODEL`.
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — the per-minute and
  per-day AI allowances.
- `RUNNER_INGEST_SECRET` — signs live-run receipts, so a receipt proves a run
  of that exact code.
- `BROWSERLESS_API_KEY` — the remote browser the free tools and proving use.
- `EXAMPLE_EVIDENCE_PROJECT_ID` — optional: the one project whose evidence is
  published publicly at `/proof/example`.

GitHub integration (separate values per environment):

- `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SLUG`,
  `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET`
- `GITHUB_SETUP_STATE_SECRET` — at least 32 characters, distinct from every
  other secret.
- `NEXT_PUBLIC_APP_URL` — the exact origin the GitHub callback returns to.

The App is held to a permission ceiling, checked on every installation and
refused if exceeded: `metadata: read`, `contents: read` and `write`,
`pull_requests: read` and `write`, `issues: read`. Contents write is what
opens a pull request with approved test code; pull-requests write is what
leaves the evidence note on it; issues read is what drafts a requirement from
a ticket. User and installation tokens are transient and are never logged or
stored.

Clerk webhooks go to `/api/webhooks/clerk` with
`CLERK_WEBHOOK_SIGNING_SECRET` set locally and in the deployment, subscribed
to:

- `user.created`, `user.updated`, `user.deleted`
- `organization.created`, `organization.updated`, `organization.deleted`
- `organizationMembership.created`, `organizationMembership.updated`,
  `organizationMembership.deleted`

Local webhook delivery needs a secure tunnel to the local application. Never
put a webhook secret in documentation or source control.

## Operations

Reconcile one Clerk organization, dry-run by default:

```bash
npm run clerk:reconcile -- --organization-id org_example
# or
npm run clerk:reconcile -- --slug workspace-slug
```

Add `--apply` after reading the dry-run counts. It never sweeps every
organization.

Database:

```bash
npm run prisma:format
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate:dev
npm run test:database
```

Never commit credentials, secrets, `.env` or `.env.local`. Never point a
development migration or reset command at production.

## Where the work is written down

- `docs/ROADMAP.md` — what shipped, what is next, and what was deliberately
  not done.
- `docs/DECISIONS.md` — architecture decisions, each with its reason.
- `docs/ARCHITECTURE.md`, `docs/PRODUCTION_READINESS.md` — the shape of the
  system and the gates before a production deploy.
- `examples/ci-proof` — a disposable repository that proves the CI loop end to
  end.
