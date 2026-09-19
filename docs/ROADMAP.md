# PlaywrightGen roadmap

The working plan, kept in the repository so any session can pick up where the
last one stopped. Update the "Shipped" and "Next" sections at the end of every
work session.

Last updated: 2026-09-19.

## Where the product is

Live at https://playwrightgen.com (Vercel, Clerk production, Stripe live,
Neon Postgres). Every item below was verified in a real browser, and the full
test suite (460+ tests) passes.

## Shipped (most recent first)

### Free tools
- **Proving, wherever the work starts** (2026-09-17): `prove_playwright_test`
  gives an editor agent the whole loop in one MCP call (write, run, fix, run)
  with a runReceipt when it passes, which `propose_test_case` keeps as
  evidence. Coverage Review's suggested tests each have "Write & prove this
  test", which opens Quick Generate ready and starts the loop. Verified: one
  MCP call returned a passing test (2 runs, 1 fix, 11 checks) and proposed it
  with its evidence; the suggested-test handoff passed with 17 checks.
- **One button that makes a test pass** (`lib/free-tools/prove-loop.ts`,
  2026-09-17): "Generate & prove on the live page" generates the draft, runs it
  in the remote browser, fixes the failing step from the page as it was, and
  runs again, up to two fixes, showing every round including the failures. The
  verifier is the real run, not a model, and the passing run's signed receipt
  travels with the code. Verified: the login demo passes in about 90 seconds
  (sign-in, draft, one fix, 14 checks). The loop itself is unit-tested with
  fake steps, so its budget and stop conditions are proven without a browser.
- **Quality checks for Coverage Review and Release Review** (2026-09-17):
  `evals/coverage-review.eval.ts` and `evals/release-review.eval.ts`, graded
  deterministically rather than by a judge model: evidence rated honestly with
  missing signals named, no findings about systems nobody submitted, the
  brittle patterns each lens exists to catch, findings that differ from each
  other, and whether a Release Review report needed its repair attempt. Run
  with `npm run evals`; they call the real model, so they cost money. The
  Release Review engine moved out of its API route into
  `lib/ai/release-review.ts` so it can be measured without HTTP or spending a
  visitor allowance.
- **Saved Coverage Reviews** (2026-09-16): signed-in people keep their reviews
  (inputs, result, pasted tests as they last ran, and the run result) under
  "Your saved reviews", and can reopen them. Verified: review, run passed
  (5 checks), reload, reopen.
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
- **/mcp page** (2026-09-16): what editor assistants can do over MCP, the ten
  tools, how to connect from VS Code, Cursor and Claude Code, and what the
  connection can never do. Linked from the menu and the sitemap.
- Per-page titles and descriptions, a generated share card (`app/opengraph-image.tsx`),
  `robots.txt` and `sitemap.xml`; the old `/login` placeholder redirects to `/sign-in`.
- Measured: server ~20ms, largest paint under 0.6s, no layout shift, no console
  errors, nothing wider than a phone.

### Workspace (new-user and team experience)
- **Daily live checks** (2026-09-19): on a project with a live URL, "Turn on
  and run now" replays every approved browser automation (for the test case's
  current approved version) on that URL once a day, and records each result as
  a Test Run attempt, so a pass followed by a failure is a regression on
  Quality and Release without any CI. No AI allowance is used. Tests that read
  values from the environment are skipped with the reason shown (accounts are
  never stored). Vercel cron `/api/cron/live-checks` at 06:00 UTC, protected by
  `CRON_SECRET` (set in Vercel production and `.env.local`). Verified: the
  lead approved a TodoMVC automation, "Run now" recorded 1 passed on the live
  page.
- **Cover a page, behind a login, in the background** (2026-09-19): a test
  account on the plan form signs in to read the page; proving asks for it again
  and keeps it only in the open page, never stored. Planning now starts at once
  and finishes in the background (the plan page refreshes itself) -- a minute
  of reading and planning inside one request was long enough for the sign-in
  session to lapse, which showed a sign-in screen instead of the plan. The
  proven tests download as one spec file, each wrapped in its own describe
  block so their helper constants cannot collide, and the coverage count also
  recognises controls reached through their test attribute. Verified on
  saucedemo behind its login: plan page open in 3s, plan in 67s, both kept
  tests passed with 13 checks each.
- **Cover a page** (`lib/services/page-coverage.ts`, `/projects/:id/cover`,
  2026-09-19): one URL in; an AI plan of up to six test cases for what a person
  can do there, skipping ones the project already has and listing what it left
  out on purpose (payments, real accounts). A person ticks what to keep and sees
  the cost; only then is anything spent. Each kept item becomes a draft Test
  Case, written from the real page, run, fixed up to twice, with its code and
  run evidence attached. Proving is one item per request, two in parallel from
  the progress page, so no request outlives the server's limit; closing the tab
  pauses it. The summary counts which of the page's named controls the proven
  tests reach, from the page and the locators rather than the model. Verified:
  TodoMVC planned in 58s, two kept tests proven in 61s (one passed with 5
  checks), "reach 2 of the page's 4 named controls"; saucedemo's login page
  planned locked-out, empty-field and invalid-credential tests.
- **Automation proves itself before review** (2026-09-17): a project can hold a
  live URL ("Where this project runs", on the project page). With one set,
  generating automation for an approved Test Case reads that page first, so
  locators come from its real roles, names and test attributes instead of
  process.env placeholders nobody could run; then the code is run there, a
  failing step is fixed once from the page as it was, and the version records
  "Passed on the live page · N checks". A person still reviews and approves.
  Verified: approved Test Case to passing automation in 64 seconds with one
  automatic fix. Before this, generated automation read every selector from
  environment variables, which is why it could never be run.
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

1. **Cover a page over MCP.** The same plan-approve-prove flow as one pair of
   MCP tools, so an editor agent can cover a page and a person approves the
   plan in PlaywrightGen.
2. **MCP directory listings (needs the owner).** The official MCP registry
   verifies the publisher through GitHub or DNS, so publishing is the owner's
   step; everything else (the /mcp page, tools, docs) is ready.
3. **Split the Release Review page.** It is 1,500 lines in one file. The
   analysis now lives in lib/ai/release-review.ts; the page does not.
4. **Open a pull request from approved automation.** Needs the owner's
   decision on giving the GitHub App write permission (currently read-only).
5. **Verify the paid path end to end — on hold at the owner's request.** Stripe
   payment, then webhook, then entitlement, then the Team allowance. Needs the
   owner's account and a real card; they said on 2026-09-19 they do not want to
   do it now, so do not raise it until they bring it up.

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
