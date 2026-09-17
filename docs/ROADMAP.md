# PlaywrightGen roadmap

The working plan, kept in the repository so any session can pick up where the
last one stopped. Update the "Shipped" and "Next" sections at the end of every
work session.

Last updated: 2026-09-16.

## Where the product is

Live at https://playwrightgen.com (Vercel, Clerk production, Stripe live,
Neon Postgres). Every item below was verified in a real browser, and the full
test suite (460+ tests) passes.

## Shipped (most recent first)

### Free tools
- **Pages behind a login (first version)** (`lib/free-tools/sign-in.ts`):
  Quick Generate has "Page behind a login? Add a test account" and a "Try a
  page behind a login" demo (saucedemo). The page reader signs in first, the
  AI writes sign-in steps with `process.env.E2E_USERNAME` / `E2E_PASSWORD`,
  and the live run asks for those values ("Values for this run"). Values are
  used for one request, never stored or sent to the AI, and blanked out of run
  results. Verified locally: signed-in read, then passed after two AI fixes
  (14 checks). Also fixed three runner bugs found on the way: setup that began
  with an `if` was dropped, constants inside `test.describe` were not read,
  and lines after a `test.step` ran before it.
- **Send a passing test to a project** (`lib/free-tools/preview-run/receipt.ts`,
  `lib/services/imported-drafts.ts`): every live run returns a signed receipt
  (HMAC over the outcome and a hash of the exact code). "Continue in Workspace"
  now carries the code, its steps and the receipt; the Test Case keeps the code
  with "Passed on the live page · N checks" only when the receipt matches the
  code. After approval, "Use this code as the automation" makes it automation
  version 1 with no AI call. Verified: pass, import, lead approves, version 1.
- **Saved drafts for signed-in people** (`FreeToolDraft`, `/api/free-tool-drafts`):
  Quick Generate keeps the last 20 drafts with the code as it last ran and the
  run result; "Your saved drafts" reopens one with its evidence. Deleted with
  the account.
- **Fixed: the import page crashed** ("Continue in Workspace" looped until React
  gave up) because the handoff was re-parsed on every render. Now cached.
- **Loops in tests run in the preview**: `for (const item of LIST)` over inline
  data, `LIST[0]` and `user.name` are replayed, so setup written in a loop is
  no longer silently skipped. The AI fix is told which earlier lines did not run.
- **Run your own tests in Coverage Review** with the same safe runner and AI fix.
- **Fix the failing step with AI** (`/api/repair-draft`, `lib/ai/draft-repair.ts`):
  after a live run fails, the model repairs only the failing locator using the
  page's accessibility tree at the failure. Verified on the TodoMVC demo: fail,
  fix, fail further, fix, then "Passed on the live page: 17 checks in 7s".
- **Run on the live page** (`/api/preview-run`, `lib/free-tools/preview-run/`):
  a draft is parsed with the TypeScript compiler into a closed set of Playwright
  operations and replayed in the remote browser (Browserless). The code is never
  executed. Ten runs per day per address.
- **Upgrade instead of an error after 5 free runs** (`lib/operations/free-tool-access.ts`):
  visitors get 5 runs/day per tool, then a Team-plan card ($19/month, 7-day
  trial). Signed-in Team workspaces use their workspace AI allowance instead.
- **Quick Generate reads the real page**: the URL opens in Browserless, the
  accessibility tree drives locators, the code's locators are checked against
  the page ("2 of 4 locators match"), plus "Try it on a live demo page" and
  "Run it in 3 steps".
- **Coverage Review reads the real page** and computes which controls the
  pasted tests target by name ("Your tests target 1 of 3 controls by name").
- **Release Review** moved from gpt-4o to a configurable reasoning model
  (`OPENAI_RELEASE_REVIEW_MODEL`, default gpt-5-mini), with Given/When/Then
  tests and named failure modes.

### Public site
- Per-page titles and descriptions, a generated share card (`app/opengraph-image.tsx`),
  `robots.txt` and `sitemap.xml`; the old `/login` placeholder redirects to `/sign-in`.
- Measured: server ~20ms, largest paint under 0.6s, no layout shift, no console
  errors, nothing wider than a phone.

### Workspace (new-user and team experience)
- **Free tools over MCP** (2026-09-16): `generate_playwright_test` (reads the
  real page, writes a draft) and `run_playwright_test` (replays it in the
  remote browser, returns the failing step with the page tree, and a signed
  runReceipt when it passes). Both use the workspace's daily AI allowance.
  `propose_test_case` and `submit_playwright_code` accept the runReceipt, so
  an agent's passing run is kept as evidence. Verified over HTTP locally:
  generate, run (passed, 14 checks), propose with evidence. The page reader
  now retries once when the remote browser drops a connection.
- **Editor agents can propose, people approve** (`lib/mcp/playwrightgen-mcp.ts`, 2026-09-16):
  two MCP write tools. `propose_test_case` creates a draft test case (tagged
  from-editor, optionally with Playwright code and submitted for review);
  `submit_playwright_code` sends code for an existing test case. The code waits
  on the test case as "Code from an editor AI assistant" until a person uses it
  as automation. Nothing can be approved over MCP; viewers cannot write.
- Friendly `/onboarding` step replacing Clerk's "Setup your organization".
- Workspace and membership recovery when Clerk's webhook is late (new
  workspaces and people who just accepted an invitation no longer see errors).
- "Start here" guide, a "Next step" banner on every record, actionable empty
  states, readable labels, project tabs that wrap, a friendly error page.
- Phone layout: compact header, automation page fits the screen.
- Team roles (members write, leads approve, nobody approves their own work),
  Team page with invitations that carry a project role, Reviews queue,
  review history on each record, and the approver named when someone waits.
- Background automation generation (no lost results on long AI calls).
- Manual test runs can no longer record a pass by accident; the run page leads
  with the failure and "Find out why it failed".
- AI failure analysis keeps correctly quoted findings instead of failing whole.
- Editor connection over MCP (VS Code, Cursor, Claude Code) with personal tokens.
- Billing page states the plan, the daily AI allowance and the trial date.

## Next

In priority order. Each item should end verified in a browser and shipped.

1. **A public MCP page, then directory listings.** A public /mcp page that
   explains the connection and its tools; then list the server in MCP
   directories (the official registry needs the owner's GitHub or DNS
   verification, so that step is theirs).
2. **Saved Coverage Reviews.** The same saved history for Coverage Review
   (Quick Generate has it now).
3. **Evals for Coverage Review and Release Review.** Only Quick Generate has
   an eval today (`evals/quick-generation.eval.ts`).
4. **Release Review structured output.** Move its route to zod structured
   output like the other tools and split the 1,500-line page into components.
5. **Open a pull request from approved automation.** Needs the owner's
   decision on giving the GitHub App write permission (currently read-only).
6. **Verify the paid path end to end.** Stripe payment, then webhook, then
   entitlement, then the Team allowance in the free tools. Needs the owner's
   account and a real card.

## Things to know when resuming

- Local development: `npx next dev -p 3000`. The dev database may need
  `db:migrate:verified` with `EXPECTED_NEON_BRANCH_ID=br-restless-dawn-axyqbc68`
  and `EXPECTED_NEON_PROJECT_ID=restless-frost-04247280` (dev branch, not
  production).
- Browser checks use Playwright scripts; a brand-new user is created with the
  Clerk dev API (sign-in token), because Clerk's bot protection blocks
  automated sign-up forms.
- The local free-tool allowance is shared by every local request (no client
  address), so heavy local testing hits the 5/day limit; test scripts send an
  `x-forwarded-for` header to use a fresh allowance.
- Browserless usage comes from the owner's Browserless plan; if it runs out,
  the tools say they could not open the page and keep working.
- Live-run receipts are signed with `RUNNER_INGEST_SECRET` (set in Vercel).
  Locally, `.env.local` has its own random value; without one, runs still work
  but carry no evidence.
- jsdelivr sometimes fails to resolve the unpinned `@clerk/ui@1` for the Clerk
  dev instance, which breaks local sign-in; browser scripts route it to the
  pinned version. Production loads Clerk from clerk.playwrightgen.com.
- Production migrations: `scripts/migrate-verified.mjs` with
  `EXPECTED_NEON_PROJECT_ID=restless-frost-04247280` and
  `EXPECTED_NEON_BRANCH_ID=br-flat-boat-axjnmd13`, run before pushing code
  that needs the new schema.
