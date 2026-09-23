# PlaywrightGen roadmap

The working plan, kept in the repository so any session can pick up where the
last one stopped. Update the "Shipped" and "Next" sections at the end of every
work session.

Last updated: 2026-09-19.

## Where the product is

Live at https://playwrightgen.com (Vercel, Clerk production, Stripe live,
Neon Postgres). Every item below was verified in a real browser, and the full
test suite (493 tests) passes.

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
- **Release Review page split** (2026-09-19): app/engineering-review/page.tsx
  went from 1,503 lines to 920 (the form and its flow). Types and option
  lists are in review-model.ts, the inputs in form-controls.tsx, and the whole
  result (sections, report download, workspace handoff) in review-result.tsx.
  Moved, not rewritten. Verified in a browser: example, analysis, all nine
  result sections, report download, "Analyze Another Change", phone width.
  The form's remaining fields share one set of state; splitting them further
  would mean restructuring that state, which is not worth the risk now.
- **/mcp page** (2026-09-16): what editor assistants can do over MCP, the ten
  tools, how to connect from VS Code, Cursor and Claude Code, and what the
  connection can never do. Linked from the menu and the sitemap.
- Per-page titles and descriptions, a generated share card (`app/opengraph-image.tsx`),
  `robots.txt` and `sitemap.xml`; the old `/login` placeholder redirects to `/sign-in`.
- Measured: server ~20ms, largest paint under 0.6s, no layout shift, no console
  errors, nothing wider than a phone.

### Workspace (new-user and team experience)
- **A guided first project** (2026-09-23): the new-project form takes "Where
  does it run?" beside the name. Give a page and the project is created, the
  address saved, the page read and its tests planned while the form answers --
  the person lands on the plan instead of an empty project. Leave it empty and
  nothing changes. The empty-workspace guide now describes that path (name and
  page, tick the tests, watch each proved, approve and let daily checks watch
  the site) rather than the old requirement-first one. Verified from a brand
  new account at 390px: one button, one form, plan ready 40 s after the first
  click.
- **No more tests that pass while the product is broken** (2026-09-23): the
  planner had put "Instruction and attribution links are present" in a plan.
  The rule is now explicit -- never plan a test whose only outcome is that
  text, links, headings or credits exist; plan one only when something a
  person can see changes. Checked on three pages: TodoMVC and saucedemo plans
  are all behaviour, and a marketing page yields the navigation it really has.
- **"Flaky" means one thing** (2026-09-23): a live-check retry now records both
  runs, so Test Runs shows the failure and the pass that followed rather than a
  pass that hides a failure, and the Quality page carries a "Flaky in the last
  live check" signal worded exactly like the Health card ("failed and passed
  for the same version, with nothing changed in between").
- **Plain words where a newcomer lands** (2026-09-23): read every empty page in
  a brand-new workspace and rewrote the ones written for us rather than for a
  tester. "Automation Studio / Every artifact pins an approved Test Case
  version" became "Automation / The Playwright code for each approved test";
  "Quality Command Center" became "Quality"; "Immutable execution attempts
  pinned to..." became "Every time a test runs, the result is kept exactly as
  it happened"; Repositories now says plainly that PlaywrightGen never changes
  your code. The pricing feature list was a year behind and now names what the
  product does (cover a page, daily checks with alerts, pull requests, MCP).
- **Public site read with fresh eyes** (2026-09-23): home, Quick Generate,
  Release Review, /mcp and /pricing all answer in about 1.4 s on production, at
  390px and desktop, with no overflow and no console errors, and each has a
  clear way in ("Write & prove it", "Create a free workspace", "Start the 7
  days free").
- **One failure is not a regression** (2026-09-22): when a daily live check
  fails a test that passed last time, it runs that test once more before
  deciding. Passing on the second run is recorded as the passing attempt,
  noted on the attempt ("failed once and passed when run again, so it is flaky
  rather than broken"), and listed as flaky on the project page and the Health
  card -- no red banner and no channel alert. Failing twice is recorded as the
  regression it is. A test that was already failing is not run twice, so a
  persistently broken test costs no extra run, and the retry is skipped when
  the round is out of time.
- **The first minute, measured and halved** (2026-09-22): a brand-new account
  to planned tests took 77 s; the plan step was 48 s of it, and inside that the
  page read was 3.4 s and the model call 44 s. All three AI calls now set
  `reasoning: { effort }`, defaulting to "low" and overridable per surface
  (`OPENAI_PAGE_COVERAGE_EFFORT`, `OPENAI_QUICK_GENERATION_EFFORT`,
  `OPENAI_AUTOMATION_EFFORT`). Planning: 44 s -> 18 s with better plans (the
  slower setting spent tests on "static content and credit links are present",
  which the prompt tells it to skip). Generators: the live-page eval, which
  runs what was generated, went 1/2 passed in 92 s to 2/2 passed in ~49 s,
  repeated three times. New-account flow end to end: 77 s -> 41 s.
  The eval now prints the failing step when a first run fails.
- **`npm run audit:phone`** (2026-09-22, `scripts/audit-phone.mjs`): signs in
  with a Clerk ticket, walks all 17 workspace pages at 390px and exits non-zero
  when a page is wider than the screen, naming the box whose content overflows.
  Proven both ways: 17/17 pass on the current site, and a deliberately 900px
  element made it report "health 916px <- div.mx-auto.max-w-3xl". Needs a dev
  Clerk secret; `AUDIT_BASE_URL`, `AUDIT_EMAIL` and `AUDIT_WIDTH` override the
  defaults.
- **A page a role cannot open says so** (2026-09-22): the audit's first run
  found /projects/new answering HTTP 500 for a member without
  `project:create` -- `requireWorkspaceContext` threw and the error boundary
  said "This page didn't load". It now renders `NotAllowed`
  (components/workspace/not-allowed.tsx): what the page is for, who can open
  it, and a way back. The same component suits any other page that guards on a
  permission.
- **Pull request from approved automation, proven against GitHub** (2026-09-22):
  after the owner granted Contents + Pull requests write and accepted it on the
  installation, a real run opened
  https://github.com/hmamut39/playwrightgen-ci-proof/pull/1 in 5 s -- one file
  added (tests/playwrightgen/a-visitor-adds-a-todo-and-sees-it-in-the-list.spec.ts,
  32 lines), branch -> main, description carrying automation v3, Test Case v1,
  the approver and the record link. A second call returned the same pull
  request instead of opening another.
- **Listed in the official MCP registry** (2026-09-20): `com.playwrightgen/playwrightgen`,
  published with `server.json` (remote streamable-http at /api/mcp, personal
  editor token in the Authorization header). Ownership was proven with the
  registry's HTTP method -- `/.well-known/mcp-registry-auth` carries the public
  key, the private key lives in `.env.local` as `MCP_REGISTRY_PRIVATE_KEY` --
  so no GitHub account or DNS change was needed. Republish after changing
  server.json: `mcp-publisher login http --domain playwrightgen.com
  --private-key "$MCP_REGISTRY_PRIVATE_KEY"` then `mcp-publisher publish`,
  raising `version` first.
- **Pull request from approved automation** (2026-09-20): an approved browser
  artifact with a connected repository has "Open a pull request" on its
  Automation page (lead permission `repository:pull_request`). It branches
  from the default branch, writes `tests/playwrightgen/<name>.spec.ts`, opens
  the pull request with the approved version, its Test Case version and a link
  back, and records `AUTOMATION_PULL_REQUEST_OPENED`. Calling it again updates
  the branch and returns the pull request already open. The installation token
  is minted per call for that one repository with only contents+pull_requests
  write; without those permissions it refuses with a plain message and writes
  nothing.
- **Review from a phone** (2026-09-19): measured the review pages at 390px.
  The automation page was 408px wide -- a version summary containing a long
  URL could not wrap -- so the whole workspace content area now wraps long
  words (`wrap-anywhere` in workspace-frame.tsx); code blocks still scroll
  sideways inside their box. On test case and automation pages waiting for
  this reviewer, a bottom bar with Request changes / Approve appears on small
  screens once the header buttons scroll away (StickyReviewBar), with room
  left so it covers nothing. Verified as the lead: bar hidden at the top,
  shown after scrolling, Approve in the bar approved the test case
  (TEST_CASE_APPROVED recorded), bar gone afterwards, page 390px wide.
  Then all 21 workspace pages were measured at 390px: only the Automation
  list was wider (620px). A CSS grid with no column rule sizes its column to
  the widest single-line child, so a long artifact name (and the editor token
  field) stretched the page; both grids now declare `grid-cols-1`, which
  allows the column to shrink and the text to truncate as intended.
- **First evidence from the Health page** (2026-09-19): while a project reads
  "No evidence yet", people who can create tests see "Get your first
  evidence" -- one address field (or none, when the project has a live URL)
  and "Plan tests for this page", which starts the Cover a page plan and opens
  it. A typed address also becomes the project's live URL when the person may
  set it. Verified: new "Marketing site" project, TodoMVC address, 4 tests
  planned in 65 s, live URL saved. And when a project has a live URL and
  approved automation but daily checks are off, the Health page offers "Turn
  on daily checks and run now" (people who can update the project only).
  Verified: checks off, one tap, round ran (2 passed), offer gone.
- **Health verdict on every project card** (2026-09-19): the workspace home
  shows "Needs attention" (with why), "No evidence yet" or "On track" on each
  active project, by the Health page's rules (up to 12 projects, computed in
  parallel; unreadable ones show none). Fixed on the way: a new project with
  nothing run read "Needs attention -- 1 release blocker" because "no run
  evidence" is a Release blocker; it now reads "No evidence yet". Projects
  that need attention are listed first, archived last. Verified with a second
  project: the older one needing attention sorts above the newer one.
- **Project Health page** (2026-09-19, /workspace/:org/projects/:id/health):
  one screen, phone first. A verdict from plain rules
  (`lib/services/project-health.ts`): "Needs attention" when a live check
  fails, a regression exists or a release blocker is open (and says which);
  "No evidence yet" when nothing has run; otherwise "On track". Then cards
  that open the detail: daily live checks, release blockers, waiting for
  review, evidence, coverage. New "Health" tab; project cards on the
  workspace home now open it. Verified at 390px and desktop, no overflow.
  Note for local work: a `next build` followed by `next dev` on the same
  .next folder made every project page 404 in dev until .next was deleted.
- **Tests open the page, not the site root** (2026-09-19): `alignRootNavigation`
  (lib/free-tools/navigation.ts) rewrites `page.goto('/')` to the page relative
  to its folder (`./` or `./page.html`) whenever the page lives below the
  site root, in Quick Generate, workspace automation and the automatic fix --
  a safety net that works even when the model ignores the prompt. New eval
  `evals/live-page.eval.ts` generates with both generators for
  demo.playwright.dev/todomvc/, runs the result in the remote browser, and
  grades the first run (both passed); it also reports whether the model itself
  wrote '/', so a prompt regression stays visible.
- **Fix what live checks cannot run, and three bugs found doing it**
  (2026-09-19): a "Not checked" test that read a made-up environment value, or
  whose automation covers an older test-case version, has "Generate again from
  the live page"; the new version goes through normal review. Verifying it
  found: (1) generated tests opened `page.goto('/')`, which leaves a project
  URL's folder for the site root (a 404 on demo.playwright.dev) -- generators
  now write `page.goto('./')`; (2) the automatic fix then asserted the 404
  heading, turning a broken test into a "passing" one -- the repair prompt now
  forbids it and the prove loop discards any fix that newly expects an error
  page (`assertsErrorPage`); (3) a generation refused by the daily AI
  allowance showed "This page didn't load" -- it now returns to the page with
  "Nothing was generated: this workspace has used today's AI allowance".
  Verified: regenerated TodoMVC test passed 8 checks with no fixes, the lead
  approved it, and the live check went from 1 to 2 passed ("Passing again").
- **Live check alerts** (2026-09-19): each round compares every result with
  the test's last recorded one. A pass that turns into a failure is marked
  "Started failing" on the project (with the failing step), a red banner on
  the workspace home names it for two days, and project cards show "Live
  check: N failing" or "Live check passing". A failure that passes again is
  listed as "Passing again". A project can add a Slack or Discord incoming
  webhook (allow-listed hosts only, https, no redirects followed, shown back
  only as "a Slack channel"); changes are posted there, and a refused post is
  reported on the page. Verified in a browser by pointing the dev project at
  another site (started failing, banner, badge) and back (passing again).
  Email is not used: the Resend key can only send from its test sender until
  playwrightgen.com is verified in Resend (a DNS step for the owner).
- **Cover a page over MCP** (2026-09-19): two MCP tools, now 13 in all.
  `plan_page_coverage` reads a page (signed in when env carries E2E_USERNAME
  and E2E_PASSWORD, used for that call only) and returns the plan with a link;
  an agent cannot approve it. After a person ticks the tests in PlaywrightGen,
  `prove_page_coverage` proves them (about two minutes of new work per call,
  under the 300 s route limit) and, when done, returns the proven suite.
  Verified against the dev server: TodoMVC plan of 5 in 46 s, person approved
  2, one passed with 12 checks and one was reported still failing with its
  code kept for review. Listed on /mcp.
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

1. **Say what proving will cost before it starts.** The plan page shows the
   AI cost per test; a newcomer approving six tests cannot tell what that
   leaves of the daily allowance. Show the allowance before and after.
2. **Verify the paid path end to end — on hold at the owner's request.** Stripe
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
