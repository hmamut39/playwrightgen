# PlaywrightGen roadmap

The working plan, kept in the repository so any session can pick up where the
last one stopped. Update the "Shipped" and "Next" sections at the end of every
work session.

Last updated: 2026-09-23.

## Where the product is

Live at https://playwrightgen.com (Vercel, Clerk production, Stripe live,
Neon Postgres). Every item below was verified in a real browser, and the full
test suite (493 tests) passes.

## Shipped (most recent first)

### Free tools
- **A test that passed stopped being called "partly run"** (2026-09-23): walked
  the "cover a page" shortcut on a fresh project against TodoMVC. Two tests
  were planned, written and run; nothing failed, twelve and six checks passed
  -- and both came back "Partly run", with the project reporting 0 passed on
  the live page. The cause was one step: `await todoInput.focus()`. The preview
  runner's safe list had nine actions and did not include focus, so the step
  was skipped, and `runVerdict` downgrades any run with a skipped step to
  partial. A field being focused before it is filled changes nothing, and it
  was making honest work look unproven.
  The safe list now also carries focus, blur, selectText,
  scrollIntoViewIfNeeded, pressSequentially and type (run as
  pressSequentially, since models still write the older name), and the
  matchers toBeFocused, toBeEmpty, toBeEditable and toBeAttached. Every one is
  deterministic and confined to the page; nothing that reaches outside it was
  added, and setInputFiles and page.evaluate are still refused. Re-running the
  same stored test in the real remote browser afterwards: 7 passed, 0 skipped,
  verdict passed.
  Two more causes of the same false "partly run" turned up by repeating the
  walk. `expect(items).toHaveText(['A', 'B', 'C'])` -- Playwright's list form,
  which asserts every matched element in order -- was refused as "needs a
  literal value"; it is now read and checked against allInnerTexts, and only
  for toHaveText and toContainText, where a list means something. And
  `const before = await items.count()` followed by `toHaveCount(before)` was
  refused as "needs a literal number". Count, act, count again is one of the
  most common shapes a generated test takes, and the plan cannot know the
  number because it never executes anything; the plan now carries a capture
  step and the name, and the run fills the value in. Anything it still cannot
  read, such as a count from the environment, is refused as before.
  End to end on a fresh project afterwards: TodoMVC planned in 29s, two tests
  proven in 37s, **2 passed on the live page, 0 partly run** -- the same walk
  that started at 0 passed, 2 partly run.
- **What is left, before the click** (2026-09-23): Quick Generate and Coverage
  Review open saying "5 of 5 drafts left today" instead of the generic "up to 5
  per day", and a Team workspace sees its own allowance. `GET
  /api/free-tool-allowance?surface=` reads the same counters the reservation
  increments (visitor keyed by address, workspace by session) and spends
  nothing; a failed read leaves the old line rather than blocking the tool.
  Verified in a browser: both tools showed 5 of 5 before any click, three reads
  in a row left it at 5, and a real draft took it to 4 of 5, still 4 after a
  reload. Unit-tested that a Team workspace gets its own allowance and that a
  failed workspace lookup falls back to the visitor count rather than granting
  the paid one.
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
- **The site says the evidence can be kept** (2026-09-23): the home page's
  list gained "Keep it: one file that opens anywhere, and a badge for your
  README", and the proof card says a reader can download the evidence as a
  file. /mcp's "what happens after your team approves" says the same. Sharing
  a link, keeping a file and showing a badge are three different needs, and
  the site now names all three.
- **The public site says evidence can be shared** (2026-09-23): the home page
  lists "Share the evidence with anyone: a read-only link, expiring,
  stoppable" and carries a fourth integration card, "Proof for the people who
  ask whether it was tested". /mcp gained "What happens after your team
  approves" (daily checks, pull requests, proof links) and its tool count is
  right again: thirteen, not eleven.
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
- **Somebody outside the team can accept the evidence, and that is kept**
  (2026-09-26): every audit chain ends at a person saying "yes, this is
  acceptable", and in most teams that moment happens in a meeting or an email
  and is never recorded -- so a year later nobody can say what exactly was
  accepted. A proof link already puts the evidence in front of that person; the
  shared page now keeps their answer next to it (`EvidenceSignature`, migration
  20260926180000). They give a name, optionally a role and a note, and it
  appears on the page, on the team's Release page, and in the file an auditor
  keeps.
  Two rules make it worth keeping. It is bound to what was on the screen: the
  report is hashed at the moment of signing and a copy is stored, so the
  Release page can say "the evidence is unchanged since" or "the evidence has
  changed since" rather than leaving a reader to assume. The hash covers the
  claims and not the moment they were read, or unchanged evidence would hash
  differently every time and the comparison would mean nothing. And it does not
  pretend to be more than it is: the name is what the signer typed, and the
  page, the Release card and the exported file all say the identity was not
  verified. What it does have is a link that was sent to someone, expires, can
  be stopped, and a signature that cannot be moved to other evidence.
  Signing goes through the same check as opening, so a stopped or expired link
  records nothing, and a link holds at most twenty acceptances -- it is sent to
  a few people, not a petition. Integration-tested across all of those.
  Verified in a browser at 390px: a reader with no account accepted the
  evidence, saw it echoed back, and the team's Release page showed it with "the
  evidence is unchanged since".
- **An agent can finally see what is not covered** (2026-09-26): the MCP server
  let an assistant list test cases -- what somebody has already written -- but
  requirements were invisible to it, so it could not see what was agreed or
  what nothing verifies. Writing tests for the gaps is impossible if the gaps
  cannot be named, and this project is the one place that knows them, because
  it holds intent, tests and runs together. `list_requirements` returns each
  approved requirement with a verdict derived from stored records only, its
  reason, how many days since anything checked it, and how many approved tests
  verify it; `verdict: "UNVERIFIED"` returns exactly the gaps.
  `get_requirement` returns one of them with every approved test, how each last
  ran, and which assistant proposed it -- provenance and proof in one answer.
  Both read only, spend no AI allowance, and are annotated readOnlyHint so a
  client can approve them without asking. Fifteen tools now, and /mcp says so.
  Verified over real HTTP against the development project: the requirement came
  back FAILING with "1 approved test last ran and did not pass. Last checked 12
  days ago", and its three tests with their individual results.
- **The review queue answers what a reviewer would open each item to learn**
  (2026-09-26): approval is the gate the whole product rests on, and a gate is
  only worth having if people pass through it. Reviewing AI-written work is
  measurably slower than reviewing a person's -- published figures this year
  put review time up 441% and 31% more pull requests merged with no review at
  all -- and a queue that said only "a test case is waiting" made every item
  cost a page load and a read. Each waiting item now carries the three facts a
  reviewer actually decides on: "passed on the live page - 9 checks", who
  proposed it when an assistant did, and the requirement it is linked to
  verify. Only a receipt reading "passed" earns the badge; a partial run shows
  nothing, because calling it proven would be the overstatement the rest of the
  product avoids. Integration-tested both ways. Verified in a browser: a proven
  draft submitted for review showed its badge in the queue at 390px.
  A note for future sessions: do not run a second vitest file while the full
  suite is running. They share one test database, and the cleanup between tests
  deletes everything, so the two runs destroy each other's fixtures and fail
  with foreign key errors that look like product bugs.
- **The evidence names which assistant proposed the test** (2026-09-26): a
  proposal arriving over MCP was recorded as AI_SUGGESTED and nothing more, so
  the trail said "an AI made this" and stopped -- while the server received the
  caller's identity on every request and discarded it. Traceability for
  AI-assisted work is now expected to name which tool produced which artifact,
  and PlaywrightGen is in the rare position of being both the MCP server and
  the evidence store, so it can record the answer instead of reconstructing it
  later. `TestCaseVersion.authoredByAgent` and
  `TestCaseImportedDraft.authoredByAgent` (migration 20260926170000) hold the
  name; it appears in version history, on the shared proof page, and as a
  "Proposed by" column in the file an auditor keeps.
  The name is the caller's own claim about itself, taken from MCP's clientInfo
  where a message carries it and otherwise from the User-Agent, with the
  version kept because "which tool, and which version" is what a trail is asked
  later. It authorizes nothing: the editor token decides access and a person
  still approves everything. A caller that says only "node" or "curl" leaves
  the field null rather than putting a runtime in the audit trail as though
  something had been established. Recorded on the version rather than the Test
  Case, because who proposed version 1 does not change when someone edits it.
  Unit- and integration-tested, including code later sent by a different
  assistant being attributed to that one while the proposal's authorship stays
  put. Verified over real HTTP: a call with "Claude Code/2.1.0 (mcp)" was
  recorded as "Claude Code 2.1.0", and one with "node" as null.
- **The project notices tests that already passed** (2026-09-26): walked what
  happens *after* the "cover a page" shortcut, which nobody had checked. Two
  tests had just been written, run and passed on the live page -- and the
  project said the person had done nothing: the getting-started card read "0 of
  6 done" and offered the shortcut again, Health said "No evidence yet, no test
  has run yet" and invited them to "Get your first evidence", and Reviews said
  nothing was waiting, because the drafts had never been submitted. Every one
  of those statements was literally true and together they read as "it did not
  work".
  `ProjectSetup` now carries `provenDrafts`: draft Test Cases whose kept code
  has a signed receipt saying it passed, and which have not yet become an
  automation version. The overview card and the Health page lead with them --
  "4 tests are already proven on your page, waiting for a person" -- explain
  that nothing counts until somebody approves it, and link straight to the one
  draft, or to the list when there are several. Health no longer asks for a
  first run while proven work is waiting, and the "In a hurry?" shortcut stops
  being offered once it has been used.
  Only a receipt reading "passed" counts: a partial run also carries one, and
  calling that proven would be the overstatement the rest of the product works
  to avoid. Integration-tested, including the partial, the draft with no run
  at all, and the draft whose code has since been used. Walked end to end
  afterwards: submit, approve, "Use this code as the automation" -- Version 1
  created, the checklist moved from 0 of 6 to 2 of 6, and the waiting count
  fell from 4 to 3.
- **A new project points at the fast route, and stops offering to share
  nothing** (2026-09-23): walked a brand-new empty project as a tester would.
  Two things were wrong. The getting-started card steered everyone down the
  six-step manual chain -- write a requirement, approve it, write a test case,
  approve it, link them, generate automation -- while "Cover a page", which
  does the first four from one address, was only in the navigation. It is now
  offered inside the card, while no step is done, as "In a hurry?", and the
  steps stay so somebody can see what the shortcut did. Second, the Release
  page of an empty project offered "Share this evidence outside the team" and
  "Share a snapshot of today", and the link would have shown a manager or an
  auditor a page reading "this project has no approved requirements yet" --
  worse than no link, because it says the team has nothing rather than that
  the team has not started. Sharing now appears only once a requirement is
  approved; before that the page says what makes evidence shareable and points
  at covering a page. Verified in a browser both ways: the empty project shows
  the notice and no share buttons, and a project with evidence is unchanged.
- **The weekly digest says where the project stands** (2026-09-23): the digest
  answered "what happened this week" -- what broke, recovered, stayed broken,
  was flaky. A lead forwarding it upward is asked a different question: where
  are we. That one is about requirements, not tests, so the message now carries
  a standings line from the same evidence report the Release page uses: "12
  requirements: 9 verified, 1 failing, 2 not verified. 3 of the verified were
  last checked over a month ago." Zeroes are left unsaid rather than padded,
  a project with no requirements gets no line at all, and a quiet week carries
  the standings too, since "all passed" means more when it says how much is
  covered. Reading the standings is best effort: a digest about a week that
  really happened is never lost because the report could not be built.
- **Stale evidence names its cure** (2026-09-23): Release readiness reported
  "Execution evidence is stale -- 47 days old" and linked to Test Runs, which
  is where the problem is visible rather than where it gets fixed. Daily checks
  re-run the approved automation every day, so a project with them on cannot
  drift into staleness; where they are off, the finding now says so and links
  to the switch, adding "once this project says where it runs" when no live URL
  is set, because that is the actual first step. Where the checks are already
  on, stale evidence means automation that is not covering what changed, and
  the finding says that instead and still points at Test Runs. It stays a
  caution, never a blocker: old evidence is still evidence.
  Integration-tested by ageing every timestamp the freshness clock reads, not
  only the run.
- **Evidence says how old it is** (2026-09-23): a requirement marked verified
  by a run from two hundred days ago read exactly like one verified this
  morning, which is the difference an auditor is actually asking about. Every
  requirement now carries `lastVerifiedAt`, `ageDays` and a freshness band,
  from the same seven- and thirty-day thresholds the project's own quality
  view already used, so there is one definition of "old" in the product. The
  age sits next to the verdict on the shared proof page, on the team's report
  and in the downloaded file -- "checked 9 days ago", "never run" -- and a
  verdict older than a month is amber. Above them, `totals.stale` counts the
  verified requirements nobody has rechecked in a month and says so in a
  sentence: "1 of the verified requirements was last checked more than a month
  ago. A verdict is only as current as the run behind it." The verdict itself
  is unchanged: a passing run is still a passing run, and the age is reported
  rather than used to overrule it. A snapshot kept before these fields existed
  still opens and simply says it cannot tell. Unit- and integration-tested
  (forty-day-old evidence reads STALE and is counted; a requirement nothing
  has run has no age at all). Verified in a browser, including ageing the
  development project by forty days to see the banner and restoring all
  thirteen attempts exactly.
- **The phone audit was measuring a project that never existed**
  (2026-09-23): `npm run audit:phone` took the first link containing
  /projects/, which on a workspace home can be "New project"; every tab under
  that id answered 500 and the audit reported fourteen broken pages when
  nothing was broken. It now requires a project id that is a UUID. All
  seventeen workspace pages fit 390px.
- **A failing check reaches a team with no Slack** (2026-09-23): daily checks
  could only post to a Slack or Discord channel, so a team with neither learned
  about a failure the next time somebody opened the app -- too late for the one
  feature whose point is to say which day it broke. A project can now name an
  address instead (`Project.liveChecksAlertEmail`, migration 20260923190000),
  and a round that changes anything mails the same words, with a subject that
  leads with what broke: "Shop: 1 test started failing today".
  The address must belong to a member of the workspace, checked against Clerk
  when it is saved; without that, a lead could point the product at a
  stranger's inbox and the server would mail it unattended every day. The
  address authorizes nothing -- it is delivery only. Sending never throws and
  its outcome is recorded as `emailAlert`, because a round that produced real
  evidence must not be lost to a slow mail server. Unit- and
  integration-tested, including a refused address, a viewer who may not set
  one, and a mail that failed. Verified in a browser against the live Clerk
  instance: a stranger's address was refused with "Nobody in this workspace
  uses that address", a member's address saved and was shown back, and Remove
  cleared it.
  **Still to do:** mail is sent through Resend from its shared
  `onboarding@resend.dev` address, which only delivers to the account owner.
  Setting `LIVE_CHECKS_EMAIL_FROM` to an address on a verified domain turns
  it on for everyone; verifying the domain is one DNS record on
  playwrightgen.com and the owner's to add.
- **What changed since a snapshot** (2026-09-23): a frozen link says what was
  true when it was shared; the question a team asks next is what has moved
  since. Each snapshot link on the Release page now has "What changed since",
  which compares the kept report against the project now: verdicts that moved
  (worst first, because that is what stops a release), requirements added, and
  requirements the snapshot still shows that the project no longer has. One
  sentence carries it -- "Since this snapshot, 1 requirement got worse and 1
  requirement improved" -- and the page states plainly that a verdict moving
  from verified to failing may be a product that broke or a test that was
  changed, because the record cannot tell them apart. Reading a snapshot this
  way is testrun:read and records nothing: it is the team reading their own
  record, not an outsider following a link. No schema change; the snapshot was
  already stored. Unit-tested, including that a renamed requirement is not
  counted as added and removed. Verified in a browser at 390px.
- **A badge that says what is verified, not what compiled** (2026-09-23):
  every repository already carries a badge saying the build passed, which says
  nothing about whether the product does what it was meant to do. Minting a
  proof link now also offers README markdown for
  /badge/<token>.svg: "requirements | 12 of 12 verified", red and leading with
  the count the moment anything fails. A badge token is a second signed
  statement carrying only the SHA-256 of the proof token, so a public README
  can never be read back into a link that opens the evidence, and the badge
  dies when the link is stopped or expires. Reading a badge is deliberately
  not recorded as a visit, because caches and image proxies fetch it on their
  own schedule and would make "last opened" meaningless. A stopped, expired or
  forged token still returns an image, saying "unavailable" -- a README that
  shows a broken image teaches people the product is broken. Unit- and
  integration-tested, and verified in a browser: the markdown was minted with
  the link, carried no proof link, served as image/svg+xml with a five-minute
  cache, rendered at 170x20 in an <img>, and a one-character edit to the token
  showed "unavailable". It also refuses to be more confident than the evidence:
  when a verified requirement has not been rechecked in a month the badge turns
  amber and says so -- "8 of 12 verified, 3 stale" -- because a green badge over
  month-old runs is exactly the claim the pages were changed to stop making.
- **Evidence you can keep** (2026-09-23): a proof link used to expire and take
  the evidence with it, which is no use to an auditor who has to file
  something. Both the shared page and the team's own report page now have a
  download: one self-contained HTML file, no script, no stylesheet, no image,
  which opens from a file system, prints to PDF and holds the same
  requirements, verdicts, test cases, results, dates and short commits the
  page shows -- and no test code. Dates in the file are UTC, because it is
  read later and somewhere else, and a snapshot link's file says "Snapshot
  taken" rather than "Read". The file is named
  <project>-test-evidence-<date>.html so it is recognisable a year later. The
  shared download carries the same permission as the page: a stopped or
  expired link downloads nothing. Unit-tested, including that a requirement
  title containing markup cannot write the document. Verified in a browser:
  the team's file downloaded from the report page, a stranger's file
  downloaded from a snapshot link, and that file then opened from disk with
  every network request blocked.
- **A snapshot of the day it shipped** (2026-09-23): the Release page now
  offers two links. "Share this evidence outside the team" stays live: whoever
  opens it sees the project as it stands then. "Share a snapshot of today"
  builds the report once and keeps it with the link (`ProofLink.snapshot`,
  migration 20260923160000), so "this is what we shipped on the 20th" is still
  true next week. The shared page says which it is, and the list of live links
  labels each one Snapshot or Live. A snapshot is a copy of evidence the
  workspace already holds, so it reveals nothing new; it simply stops a link
  from quietly answering for a later state. Integration-tested, and verified
  in a browser: both links were made, the requirement was renamed, and a
  browser with no account then read the old title through the snapshot and the
  new one through the live link, at 390px, with no test code on either page.
  The list labelled them Snapshot and Live, and "Stop this link" still stopped
  the snapshot. The migration was applied to the production database before
  the push.
- **Health mentions sharing** (2026-09-23): the Release card on the Health
  page says "Evidence can be shared outside the team, read-only", or how many
  live links can read it, so the phone-first screen people open first leads to
  proof links rather than hiding them on the Release page.
- **A proof link can be stopped today** (2026-09-23): every link issued is
  recorded (`ProofLink`, migration 20260923140000) by the SHA-256 of its
  token, so the row can stop a link but never rebuild one. The Release page
  lists the live links with who shared them, when they expire and whether
  anyone has opened them, each with "Stop this link"; a stopped link opens
  nothing from the next request. Sharing and stopping are both
  `project:update`. Verified end to end in a browser (shared, opened,
  listed with "last opened", stopped, then "This link is no longer valid")
  and in integration tests, including a signed token whose record was deleted.
  Note for future sessions: `prisma migrate diff --from-migrations` resets
  whatever database it is pointed at as its shadow -- it wiped the test
  database's migration history here, which cost a rebuild. Write additive
  migrations by hand instead.
- **Proof links: evidence someone outside the team can read** (2026-09-23):
  "Share this evidence outside the team" on the Release page mints a signed,
  expiring link (30 days, 90 max) to a read-only page at /proof/<token>: each
  requirement, the approved tests that verify it, and how those tests last ran.
  No session, no test code, no way into the workspace (the site menu hides
  itself there), and `robots: noindex` -- the link is the permission. The
  token names one project and nothing else; rotating RUNNER_INGEST_SECRET
  revokes every link at once. Unit-tested against tampering, another secret,
  wrong shapes, missing fields and expiry. Verified in a browser: a lead made
  a link, a browser with no account read the evidence at 390px, and a
  one-character edit to the token showed "This link is no longer valid".
  This is the moat made usable: the evidence was already immutable, but it
  could not leave the workspace without a screenshot or an invitation.
- **Coverage Review has its plain address** (2026-09-23): /intelligence named
  the machinery; it is /coverage-review now, with a permanent redirect from the
  old path and the menu, home page and sitemap updated.
- **A week in one message** (2026-09-23): daily checks write a record every
  day and nobody reads a list of days, so Monday 07:00 UTC
  (`/api/cron/weekly-digest`, same CRON_SECRET) posts each project's week to
  its channel: what broke, what is still failing, what is passing again, what
  was flaky, and how many passed every time. A quiet week still gets one line
  ("All 6 tests passed every day this week"), because silence and a broken job
  look the same. `summariseWeek` is pure and unit-tested; the sender is
  integration-tested against the database, including that a second run the
  same week posts nothing (`liveChecksLastDigestAt`, migration
  20260923120000). The same week is on the Health page as a "This week" card,
  for a team without a channel.
- **A run opens with its story** (2026-09-23): the run page repeats the list's
  one-line summary under the title, and the failing step when there is one.
  Caught while checking it in a browser: the first version showed the newest
  failure it could find, so a run reading "Passed the last 3 times." carried
  "It failed at: ..." from weeks ago. It now shows the failure only when the
  latest attempt failed, or when the retry proved it flaky (the failure the
  retry followed), keyed off `FAILED_THEN_PASSED` rather than a second guess
  at the wording.
- **Each run says what happened** (2026-09-23): the Test Runs list carried a
  status and an attempt count, which since the live-check retry can mean
  "broken" or "flaky" equally. Each row now reads its last five attempts and
  says which: "Failed, then passed when run again." (minutes apart, so the
  same round), "Failing before, passing now.", "Passed the last 3 times.",
  "Failed the last 2 times.", "The last attempt could not run."
  `describeAttempts` (lib/format/attempt-story.ts) is pure and unit-tested,
  including reading attempts in the order they happened rather than the order
  given. Verified in a browser at 390px.
- **What proving will cost, before it starts** (2026-09-23): the plan page now
  says "3 of 20 left today -- enough for about 1 of these 6. The rest wait
  until tomorrow, or untick some now." `readOrganizationAiAllowance` reads the
  same day counter the reservation increments and spends nothing (unit-tested,
  including an unused day, a broken value and an overspent one). A failed read
  hides the line rather than blocking the page. Verified in a browser at three
  levels: plenty left, nearly gone, and none.
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

1. **Make approval fast.** AI has broken review everywhere else: pull requests
   51% larger, review time up 441%, and 31% more merged with no review at all,
   while 96% of developers say they do not fully trust AI-written code.
   PlaywrightGen's answer is that nothing counts until a person approves it,
   which only holds if approving is quick. One screen per waiting item: what it
   verifies, that it passed on the real page with N checks, what it does not
   cover, and what changed since the last version -- and approve everything
   proven in one action.
2. **Open the evidence to agents.** Read tools over MCP: what verifies this
   requirement, what changed since the last release, what is approved but never
   ran, which past failures look like this one. Feeding agents processed
   evidence records instead of raw CI logs lifted useful advice from 35% to 53%
   in published measurements, and the records already exist -- structured
   retrieval over Postgres, not embeddings, and no vector database.
3. **UAT sign-off.** A proof link a business reader can sign, with the
   signature kept as evidence. It is the missing human link in every audit
   chain and no competitor has it. Pairs with a compliance pack for the EU AI
   Act, whose high-risk deadline is December 2027.
4. **MCP 2026-07-28.** The server speaks 2025-06-18. The new spec is a
   stateless rewrite (no initialize handshake, no session id, Mcp-Method
   routing, MRTR in place of server-initiated requests). Clients still
   negotiate older versions, so this is maintenance rather than a feature: do
   it when a client needs it, and keep 2025-06-18 working when it happens.
5. **Verify the paid path end to end — on hold at the owner's request.** Stripe
   payment, then webhook, then entitlement, then the Team allowance. Needs the
   owner's account and a real card; they said on 2026-09-19 they do not want to
   do it now, so do not raise it until they bring it up.

## Set aside at the owner's request

- **Turning on alert email for everyone.** The feature is built, tested and
  shipped; mail reaches only the Resend account owner because
  playwrightgen.com is not a verified sending domain. On 2026-09-23 the owner
  said this is not necessary for now: "i am okay if that email work not
  neccessary". Do not raise it again until they do. If they ever ask, the work
  is one DNS record on playwrightgen.com (Resend gives the exact value, and
  the domain's DNS is on Cloudflare, not Vercel), then `LIVE_CHECKS_EMAIL_FROM`
  in Vercel set to an address on it. The `RESEND_API_KEY` in `.env.local` is
  send-only, so it cannot manage domains.

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
