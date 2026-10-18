# PlaywrightGen roadmap

The working plan, kept in the repository so any session can pick up where the
last one stopped. Update the "Shipped" and "Next" sections at the end of every
work session.

Last updated: 2026-10-17.

## Where the product is

Live at https://playwrightgen.com (Vercel, Clerk production, Stripe live,
Neon Postgres). Every item below was verified in a real browser, and the full
test suite is 882 tests. The last full run on 2026-10-17 had one failure,
`project-team.test.ts > lets an invited person in on their first request`,
which passes on its own and passes beside the file added that day: a
cross-file flake under the full suite's load against the remote test
database, of the kind this file already warns about, and not a defect anyone
has reproduced in isolation. Everything else passed.

## Shipped (most recent first)

### Found by using the product as a team would
- **The design pass had only measured what a signed-out browser can see**
  (2026-10-18): the contrast work that morning covered the six public pages,
  which is where the measurement could reach. The workspace -- the part a
  customer is in all day -- was behind a sign-in and had never been looked at
  with a ruler.
  `audit:phone` already walks every workspace page with a real Clerk session,
  checking nothing is wider than the screen, so it measures contrast on the
  same walk rather than growing a second script with a second sign-in. It
  also follows the first item on each list now: walking the tabs alone
  measured thirteen index pages and none of the detail pages a reviewer
  spends the day on.
  Twenty-one pages, and the same fault as the marketing site had, on the ones
  people use most: nine styles below the floor, `text-slate-400` on white and
  on `slate-50` at 2.51 to 2.63 -- the "No run evidence" badge on the
  workspace home, the "Permissions" heading on Repositories and Activity, the
  note under the Activity export, "(optional)" beside form labels, a version
  number on Test Cases, a large "of 0" on Release.
  Then a second kind on the detail pages, which the tab walk had never
  reached: white text on a `-600` accent at 3.62 to 3.65 -- the green
  "Passed - 15 checks" badge, the cyan buttons on Repositories. White needs a
  700 behind it. Fixed wherever a resting state carried it, in six files.
  Hover variants are left alone, because nothing has measured one and
  guessing at interaction feel is not the same as fixing a defect.
  Zero on all twenty-one pages now, and the public check still passes.

### The surface nobody had walked
- **The MCP endpoint speaks both eras now** (2026-10-18): the protocol's
  2026-07-28 revision is not another version but a different shape -- no
  initialize handshake, no session, and the version, the client's identity
  and its capabilities carried in every request instead. Read from the
  specification rather than from memory, and its compatibility matrix decides
  the question the roadmap had left open ("do it when a client needs it"): a
  modern-only client meeting a legacy-only server **fails outright**. There is
  no fall-back for it to take. Waiting for a client to force it means finding
  out when somebody's editor cannot connect.
  The endpoint serves both, which that revision explicitly allows on one
  address. A request carrying modern `_meta` is answered statelessly; an
  `initialize` still selects the old behaviour, unchanged. `server/discover`
  is implemented, as a modern server must, and lists every version this one
  speaks so a client can choose without another round trip.
  The status codes are the part that is easy to get wrong and easy to test,
  because they are how a client tells a modern server from an old one: 400
  with -32020 when a header and the body disagree about the version, the
  method or the tool name (including a name carried in the base64 sentinel
  form); 400 with -32022 and the list of supported versions when asked for
  one this server does not speak; 404 with -32601 for a method that does not
  exist in this era, `initialize` among them; and a refusal of batches, which
  this revision does not have. Ten cases, one per rule.
  One quiet gain: the modern era names the calling client on every request,
  so what gets recorded beside an agent's proposal is now the editor's own
  claim rather than whatever its User-Agent happened to say.

### Reaching the people who never open it
- **A design system, counted rather than argued about** (2026-10-18): the
  owner asked for a deep look at the styling. Opinions about design are
  cheap, so every decision the codebase makes was tallied across 138 files
  and grouped by the job it does. The result was a product assembled piece by
  piece rather than designed to a system:
  twenty-one letter spacings (nine different negative trackings between
  -0.015 and -0.055, nine uppercase ones between 0.08 and 0.24), thirteen
  corner radii including six arbitrary rem values, two grey families mixed
  (`slate`, which is blue-tinted, and `gray`, which is not) and two accent
  hues mixed (`cyan` in the brand, `sky` in the forms and focus rings).
  Now four letter spacings chosen by what the text is -- display, heading,
  body, uppercase label -- six radii, one grey, one accent. Nothing was
  retyped by hand: three codemods, each dry-run first, then the whole site
  walked at two widths to confirm nothing moved.
  Then the part of design that is not taste at all. Every piece of text on
  six public pages was measured against what is behind it, and nine styles
  sat below the WCAG AA floor -- led by `text-slate-400` on white at 2.63
  where 4.5 is required: the product's own subtitle in the header, the eyebrow
  label on every card, the "(optional)" hints beside form labels, the tools
  table's column headings. White on `bg-cyan-600` was 3.62, the kind of near
  miss that looks fine to whoever picked it. All nine are fixed, each in its
  own direction -- lighter on the dark panels, darker on the light ones,
  which the measurement decided rather than guesswork, once by correcting me
  mid-fix when a "light" card turned out to be dark.
  It is a browser check now, so it runs in CI beside the other public-surface
  tests, and it names every failure with its ratio, size and class rather
  than reporting a count.
  Two measurement bugs of my own, both caught before they became claims. A
  first pass reported paragraphs at 240 characters per line; they were short
  strings in wide boxes, and the real prose measures 59 to 69. A first
  contrast pass reported every dark panel on the site as failing, because
  Tailwind v4 writes colours as `lab()` and a regular expression of mine only
  understood `rgb()`. The browser converts them now: a 1x1 canvas fill, read
  back as sRGB.

### Reaching the people who never open it
- **The page that says "paste this into your editor" had nothing to paste
  with** (2026-10-18): a sweep of every public page after the font change --
  for breakage first, then for the density the owner had asked about. No
  breakage: nine pages, two widths, all rendering Geist, no horizontal
  overflow, no script errors, and the rest of them already lean at 235 to 448
  words. `/mcp` is the only long one at 764, and it was left alone, because
  its length is a sixteen-row tools table. Density is a fault in persuasion
  and a feature in reference.
  What the sweep did find: all three editor-config blocks on that page are
  wider than their cards on desktop *and* phone, so the text scrolls sideways
  inside a small box and anyone reading it by eye copies a truncated command.
  The page had no copy button anywhere. Each block has one now, reusing the
  free tools' own copy control rather than writing a second -- which only
  needed an option to leave out the download, since a ten-line editor config
  is going straight into a settings file somebody already has open. Verified
  by clicking it in a browser and reading the clipboard back: 401 characters
  ending in the closing brace, not what the card happened to show.

### Reaching the people who never open it
- **The site was rendering in Arial, and the front page asked for four
  minutes** (2026-10-18): the owner's own reading of the home page -- "lots of
  paragraphs, do you think an end client understands and is comfortable" --
  checked against the live page in a browser rather than agreed with.
  Two faults, one of them invisible until measured. `next/font` loads Geist
  and puts it on the body as CSS variables, and `globals.css` then said
  `font-family: Arial, Helvetica, sans-serif`, which won. Every page of this
  product rendered in Arial while paying to download a font it never showed.
  The fix needs `@theme inline`, not `@theme`: a custom property is computed
  on the element that declares it, so a plain theme token emits
  `--font-sans: var(--font-geist-sans)` at the document root, where next/font
  has defined nothing, and it inherits down empty -- which is how the first
  attempt moved the site from Arial to the system stack and left every
  `font-mono` rendering in the sans face. Both faces are now verified by
  computed style in a real browser, not by reading the CSS.
  The second fault was volume. 1,049 words, 6,179px on a desktop and 10,982px
  on a phone -- about twenty-eight phone screens -- and three of the six
  sections making the same promise in different words: the editor section,
  the roles section and the trust model all said AI proposes, people approve,
  evidence is kept. Now 865 words and 5,087px, with the roles as one scannable
  line instead of three cards of prose, the twelve-item capability wall cut to
  the six a team cannot get from an assistant that only writes code, and every
  card's description shortened without losing a single fact -- the detail
  lines under them already carried the specifics.
  A measurement that was wrong is worth recording too: a first pass reported
  paragraphs running 240 characters per line. They were short strings in wide
  boxes, not long lines. Measured properly -- text length over rendered lines
  -- the page's prose sits at 59 to 69 characters, which is comfortable, and
  nothing needed doing about it.

### The surface nobody had walked
- **The seam a customer's first push lands on had no test either side of it**
  (2026-10-17): `playwrightgen-report.mjs` is plain Node that runs on somebody
  else's runner; the ingest route is TypeScript here. Both were tested and the
  seam between them was not -- nothing checked that the payload one builds is
  the payload the other accepts. A renamed field, a changed signature scheme
  or a stricter schema would have been discovered by a stranger whose first
  push silently recorded nothing, at the one moment a new team decides whether
  this product works.
  It is covered now by running the shipped file the way a pipeline does: a
  Playwright JSON report on disk, the environment variables the workflow sets,
  a child process, and a real HTTP request over a loopback socket to the real
  handler. Only what would reach outside the test is injected -- the rate
  limiter, the pull-request note, the failure analysis. Six cases: a marked
  result recorded against its approved version with the duration rounded
  rather than dropped, a failure's message and steps carried through, the
  provider recorded on the trail, an unmarked test explained rather than
  counted, a wrong token refused without failing the pipeline, and a first
  push with no tests sending nothing at all.
  Two mistakes of my own worth keeping. The first version used a synchronous
  child process, which blocks the event loop that has to serve it: both sides
  waited and five tests hung for thirty seconds each. And three of six
  assertions were wrong where the product was right -- the step shape it
  stores, where the provider is recorded, and the delivery note's wording,
  which explains the silence ("A result is attached to an approved test by a
  [pwg:...] marker in its title") where mine would have reported a zero.
  Reading what the product does before asserting what it should do is a
  lesson this session has now learned twice.

### Reaching the people who never open it
- **The repository's front door described a different product** (2026-10-17):
  the README still called this "AI-powered Playwright test generation" with
  "multiple output styles: Fast, Clean, Production" and a "Free / Pro product
  structure", none of which exist, and promised "component to unit test
  generation", which the product deliberately does not do. Below that, a
  changelog of checkpoints -- Phase 1A, V1.3, V1.5 -- that nobody reads and
  that says nothing about what the thing is for.
  One claim was worse than stale. "The GitHub App is read-only during
  repository import: metadata and contents read" was written before the App
  gained contents write (to open a pull request with approved test code) and
  pull-requests write (to leave the evidence note on it). Somebody deciding
  whether to install it reads that sentence instead of the code, and a
  security claim that is more generous to us than the code is the one kind of
  staleness that is not harmless.
  Rewritten as what the product is: the chain from an approved requirement to
  a proof link a stranger can open, what holds it honest, the MCP surface, and
  the environment it needs -- with the real permission ceiling and what each
  permission is for. Two of its claims are now checked by a test, because they
  are the two a reader cannot check themselves: the number of MCP tools, and
  the App's permissions against the ceiling the code enforces.

### Found by using the product as a team would
- **The first push of the CI example failed, before anything existed to run**
  (2026-10-17): working towards a dogfood run that genuinely passes, the
  example's own configuration was run against its own empty tests folder.
  Playwright treats finding no tests as an error, so `npx playwright test`
  exits 1 -- the workflow reports nothing, the last step fails the job, and
  the one artifact whose whole purpose is to show the loop working is red on
  arrival, before a single test has been generated. It reads as "this does
  not work" when the truth is "there is nothing to run yet".
  All four pipeline files pass with no tests now -- the three downloadable
  templates and the standalone example -- and each still decides its own
  result from the tests that did run, so passing with none has not become
  passing with failures.
  The other half: the answer to "did my push record anything" was a line in
  a collapsed step log, several clicks from the run. Both reporters now write
  one line where the pipeline shows it first (GitHub's run summary; the
  console on GitLab and Jenkins, which have no equivalent), saying what was
  recorded, or that no tests ran and what to paste in, or that the run could
  not be recorded and why. Writing it is best effort: a summary file that
  cannot be written must never change what is reported.
  A test now holds all of this, because nothing else in the suite runs these
  files: they execute on somebody else's runner days later, and a mistake is
  discovered by a stranger whose first impression of this product is a red
  pipeline. Two copies exist on purpose -- the templates and the example --
  which is exactly the shape that drifts, so both are checked.
  The example also had no `.gitignore`, so anyone following its README
  committed `test-results/` on their second push. A trace or a video can
  carry whatever was on the page, including a signed-in session.
  Verified along the way, with the product pointed at itself: Quick Generate
  wrote a test for playwrightgen.com's own home page and it passed on the
  first run, 8 checks, no fixes. That proven test is what the dogfood
  repository needs in order to report a result that passed rather than one
  that was skipped; tying it to an approved version needs the owner, because
  approval cannot be done on their behalf.

### Found by using the product as a team would
- **"3 steps could not run there", beside an Approve button** (2026-10-17):
  the thread the live-page eval left behind. A generated test is replayed in
  the preview rather than executed as code -- it is read into operations the
  sandbox can perform, and anything it cannot is refused *with a reason*: a
  value it cannot evaluate, a locator built from something that is not a
  literal, an API it does not implement, a credential it does not have.
  Those reasons were shown in the free tool, which renders every line with
  its own reason, and thrown away everywhere else. The workspace kept the
  count. So the artifact page said "7 checks passed, 3 steps could not run
  there" next to the button that approves it, and the only way to find out
  which three was to read the code and work out which lines a sandbox would
  refuse.
  The reasons differ in exactly the way the reviewer's decision turns on.
  "needs E2E_PASSWORD from your environment" is a step that will run in the
  team's own pipeline, and the artifact is as good as it looks. "page.route()
  is not run in the preview" is a step that has been exercised nowhere, and
  the check it carries is unproven. One count covered both.
  The lines and their reasons are now kept with the version's run record and
  shown under it, on the page where the approving happens; the same under a
  partly-run item in a page-coverage plan; and in the MCP reply, where an
  agent is the one caller that can act on them immediately. Old versions have
  a count and no lines, which reads as "no detail kept" rather than "nothing
  was skipped" -- so the record's absence is undefined, never an empty list.
  Left alone, for the reason: the import note for code brought in with a
  signed receipt says how many steps did not run and cannot say which, because
  the receipt is a signature over the code and the counts. Putting the lines
  inside it would change what is signed, which is not worth doing for a
  sentence.

### Measuring the prompts
- **The first run on a real page: 4 in 10, then 10 in 10** (2026-10-17): the
  live-page eval generates a test from the TodoMVC demo and runs it in the
  remote browser, and the first run's verdict is the grade. It was recorded on
  2026-10-11 as passing about one run in three, with nobody able to say why.
  Five runs, ten cases, before touching anything: 4 of 10 passed on the first
  run, and Quick Generate failed 5 times out of 5. Every failure was the same
  line -- an assertion on the "1 item left" counter, timing out on
  `getByRole('status', { name: '1 item left' })`.
  Two causes, and the page settled both. The first: a role that takes no name
  from its text matches nothing when given one, which a deterministic rewrite
  already fixed for list items and did not cover for live regions. It covers
  status, alert, log, timer, note, figure, blockquote, paragraph and row now,
  and deliberately not landmarks or large containers -- a text filter over
  `main` matches the whole region that happens to contain the text, which
  would turn a test that correctly fails into one that passes while checking
  almost nothing.
  That alone changed nothing, which is the more interesting half. Reading the
  page showed why: TodoMVC's list is empty on arrival, so the counter is not
  in the captured tree at all, and the prompt told the model that anything
  missing from the tree should get "your best role-based locator" -- an
  instruction to invent a role for an element nobody had seen. The expected
  result already contains the one fact that is certainly true of it: the words
  it shows. Both generators now prefer `getByText('1 item left')` for an
  element the tree does not have and whose text the requirement names, and
  invent a role only when there is no text to go on.
  After: ten runs, every case passed on the first run, Quick Generate 5 of 5
  outright. The sample is small and a model's rate is noisy, but the failure
  had one identified cause and the fix addresses that cause. The two evals
  whose prompts changed still pass (quick-generation 7 cases,
  automation-generation 4 of 4).
  One flaw in the eval itself, found while measuring it: Vitest keeps a
  passing test's console output to itself, and the per-case verdicts are
  printed there. Four green runs in a row were unreadable -- "2 passed" with
  no way to see that three of them were partial rather than clean. A
  measurement you can only read when it fails is not a measurement, so the
  evals config no longer intercepts console output.
  `live-page` stays out of the blessed baseline on purpose: it depends on a
  third-party demo page and a remote browser, so a red light there would mean
  "the page changed" as often as "the prompt got worse". The workspace path's PARTIAL verdicts
  were the thread this left behind, and the entry above follows it.

### The surface nobody had walked
- **The approval came out of the log; the log has a window** (2026-10-17):
  finishing the cap sweep, by asking of each bounded read the one question
  that matters -- does the surface reading it say the bound exists.
  The evidence report read "approved by" out of the append-only activity
  trail through a window of two thousand events. Three things were wrong with
  that, and only the first is about size. A project with more approval events
  than the window lost the oldest names, and the document decided *on the
  name* whether to mention the approval at all -- so an approved requirement
  whose name had scrolled out exported as though nobody had ever approved it.
  The trail also keeps an approval after a reviewer reopens the artifact, so a
  requirement sent back for changes read "DRAFT &middot; approved by Priya".
  And the actor on an activity row is nullable, so the same silence could
  arrive without any window at all.
  The fact now comes from the record, where approving sets `approvedAt` and
  reopening clears it, and only the name comes from the trail. A name is never
  reported without a standing approval, and an approval without a name says
  "approved on 18 September (the trail no longer names who)" rather than
  nothing. The window costs a name now, never the approval.
  The weekly digest read a week of checks oldest-first, two thousand of them.
  A project checking a few hundred tests a day produces more than that, so the
  window it kept was the *start* of the week: a message headed "week in
  review" could describe Monday and Tuesday and say nothing about the days a
  reader cares about. Worse, a week read in part could come out as "all 300
  tests passed every day this week" while a failure sat in the days it never
  read. It keeps the most recent checks now, counts the week only when the
  window came back full, and says so on both surfaces -- the Health card and
  the message. A quiet week read in part says "no failures in the most recent
  2,000 of 2,540 checks this week" and does not use the word "every".
  The digest round also reported the size of its own batch as the number of
  projects waiting. The daily round learned that in September ("50 due, 50
  ran" reads as finished); the weekly one now counts the same way.
  Checked and left alone, with the reason: `live-checks` and `project-quality`
  already count past their bound and say so; `release-proof` returns a total
  beside its page; `approval-policy` names up to three people to ask, which is
  a suggestion and not a claim of completeness. `page-coverage` compares a new
  plan against the 200 most recently updated test cases, so a project past 200
  could be proposed a duplicate of an old one -- the cost is a proposal a
  reviewer sees and rejects, not a false statement, and no project is near it.
  Written down rather than plumbed through the planner for nobody.

### The surface nobody had walked
- **What an agent can and cannot do, written down instead of merely true**
  (2026-10-17): an audit of the MCP server, the one surface where the
  customer is another AI. Sixteen tools, and the server tells each client
  that connects: "You can propose and send code, but not approve: a person
  reviews everything in PlaywrightGen before it counts."
  That sentence was true for a reason nothing recorded -- there is no approve
  tool, no accept, share or delete tool. The boundary was held by absence,
  which is the one thing a review of a diff that *adds* a tool will not
  notice: the new tool reads fine on its own and the promise it breaks is in
  a string nine hundred lines above it. The boundary is now a test that reads
  the import graph: no module an agent can reach may take in a capability
  that approves, accepts, shares or deletes. Proved both ways -- it passes
  today, and it names the file and the import the moment an approval is
  wired in. The same rule pointed at the page where a reviewer approves a
  test case does find the capability, so it is measuring something.
  Two gaps behind that promise, both the same shape as bugs fixed earlier
  this week on the surfaces people use:
  Proving a test over MCP spends three AI requests in a row -- write, run,
  fix -- and a free workspace allows four a minute. The web app learned in
  the morning that a minute is a wait, not a refusal; the agent surface had
  not, so a loop stopped half-way and handed back a job it had been asked to
  finish. An agent cannot be told to come back in a minute: it gives up, or
  starts again and spends the allowance twice. It now waits the minute out,
  but only while the call still has room for the wait and the work after it,
  because a wait that runs the route out of time returns nothing at all.
  The safety rules that refuse a test carrying cookies to another address
  need the address of the application to compare against; without it they are
  skipped, and the validation still reads PASSED. A repair -- which rewrites
  the whole file, not a patch -- passed no address, and code an agent sent
  over MCP was checked before the project was read, so the project's own live
  address was never used. Both are checked against their page now, and a test
  reads the call sites so a future caller cannot quietly stop.

### Reaching the people who never open it
- **One project's evidence, published, so a stranger sees the point first**
  (2026-10-17): the thing that makes this product different is a page
  somebody outside the team can read -- and a visitor had to create an
  account, make a project, prove tests and share a link before they ever saw
  one. The order was backwards.
  The owner can now name one project whose evidence is public, and the same
  proof page serves it at `/proof/example`: no second view to drift from the
  first, no token to expire, and a word no real token can be (they are
  `pwgp1.<payload>.<signature>`). It is read live from a real project rather
  than staged or frozen, so a visitor may well meet a failing requirement --
  which is the point, and the first thing most tools would hide.
  Two sentences that are true of a shared link are not true of this page, so
  it stops saying them: nothing here expires and nobody can retire it. The
  acceptance form is replaced by what it would do on a team's own evidence,
  because a stranger signing the example would record nothing and mean
  nothing. The download works, because a reader who would keep the file is
  exactly the reader this page is for.
  One setting, and it is the one value the owner can see: the project id out
  of the address bar. The first version also wanted the organization's id,
  which appears nowhere in the product -- an id nobody can find is a setting
  nobody sets, and the database already knows which workspace owns a project.
  Nothing is published without it, an id that is not an id publishes nothing,
  and a project that has been archived or deleted publishes nothing either.
  The front page is prerendered, so whether it carries the link is decided
  when the site is built; the example page resolves the project per request
  and works the moment the variable exists. **EXAMPLE_EVIDENCE_PROJECT_ID is
  the owner's to set in production**, naming whichever project they are happy
  for the world to read.

### Found by using the product as a team would
- **The free tool ran weaker safety rules than the workspace** (2026-10-17):
  an audit of every generating surface, one row per promise. Three gaps, and
  the worst of them had it exactly backwards.
  The red-team rules shipped that morning -- a request to another site, a
  fetch inside page.evaluate carrying cookies, storage or environment values
  posted somewhere, a Node capability reached through `await import(...)` --
  were in the workspace generator alone. The public tool is the one a
  stranger pastes markup into and then copies the result into their own
  repository, and it still carried the old rule that only read
  `import ... from`. Both now run one set of rules from one module, so
  neither copy can drift.
  The public tool also judged every draft the same way whatever shape was
  asked for. An API draft that drove a browser, or a browser draft with no
  page fixture, was nobody's business; the workspace generator had checked
  exactly that for months. It knows the mode now.
  And `release-review`, the free tool a stranger pastes a change description
  into, was the only surface whose prompt never said its input was untrusted
  data rather than instructions. Every other one says it. Now it does too.
  `draft-repair` was the last surface with no eval -- the loop that rewrites
  a failing test, where the cheapest way to pass is to delete what failed.
  Four cases, 4 of 4: it takes the real name from the page's tree, it keeps
  the assertion and says the behaviour is absent rather than weakening it, it
  never turns a credential into a literal, and it treats a 404 as the wrong
  address rather than something to assert. Every AI surface is now measured.

- **A newcomer's first proof stopped half way and asked them to resume it**
  (2026-10-17): signed up a brand-new account and took the four steps the
  empty workspace promises. Most of it is good: onboarding is one step, the
  empty workspace says "From nothing to tests that prove your app works" and
  names the four, the project and its page are one short form, step one took
  38 seconds, and the plan arrived with five tests to tick.
  Then the first press of "Prove the ticked tests" stopped after two of them:
  "Too many AI requests in a minute; it carries on in a moment", with a
  "Carry on" button to press. Proving one test spends several requests in
  quick succession -- write it, run it, fix it -- so a free workspace reaches
  its per-minute limit during a single press of a single button. The product
  handed back a job it had been asked to finish, thirty seconds into
  somebody's first use of it.
  A minute is a wait, not a refusal. The reservation now waits that minute
  out and carries on by itself, once, and never longer than a minute: a
  retry-after larger than that is not a minute limit behaving normally, and
  parking somebody's run on that figure is how a page sits saying "proving"
  for an hour. The daily allowance still stops the run and says so, because
  it returns at midnight and nobody should sit in front of a page for that.
  The same flaw was in the automation generator and the repair loop, so the
  policy lives in one place and all three use it. Afterwards the newcomer's
  run went from paused to covered on a single press: two tests passed on the
  live page with 15 and 9 checks, two partly run, one needing a person.

- **The free tool contradicted itself in front of every visitor**
  (2026-10-17): walked the public surface as a stranger, which nobody had
  done this week and which is the first thing a new user meets. The journey
  itself holds up: the form is on the first screen, a Playwright test comes
  back in under half a minute, it runs on the real page, and the assumptions
  it could not verify are listed.
  Then, two lines under "Passed on the live page", the draft panel said
  "Generated, not executed". A fixed label, written before the tool could
  prove anything, left on a page that now proves things. A visitor reading a
  product contradict itself can only conclude the flattering half was
  boilerplate -- and that half was the true one.
  It now says what is true of that code: how many checks passed, or that
  nothing failed but some steps could not run, or that it has not been
  executed. The middle one was the second mistake, mine: the first fix
  called a partial run "did not pass", which is the same kind of lie in the
  other direction, and walking it again caught that too.

- **The planner proposed clicking "Delete this workspace"** (2026-10-17):
  the last AI surface with no eval, measured against a settings page with a
  danger zone. It planned "Clicking Delete this workspace opens a
  confirmation", one step: click that button. It had listed the actual
  deletion as out of scope, so it meant well -- but the page's tree showed no
  confirmation dialog, and a planner cannot know there is one. If there is
  not, the test deletes the workspace it runs against, once, and everything
  after it fails for a reason nobody will understand.
  Such an item is now set aside and moved into outOfScope rather than
  dropped, because a plan that quietly returns five items where it meant six
  has lied about what the page needs. The rule is narrow on purpose: the
  target must be the account itself. "Remove from team", "Delete draft" and
  "Clear completed" are ordinary behaviours teams want tested, and a guard
  that swallowed them would be switched off.
  Two of the eval's four failures were the eval being wrong, which is worth
  as much as the one that was real. It called test data an invented control
  (`type 'not-an-email' into the textbox`), and called "Invite fails with
  invalid email format" a repeat of "An admin invites a new member by email"
  -- the validation case the instructions ask for once the happy path is
  covered. Both assertions were fixed by reading what the planner actually
  produced rather than trusting the failure.
- **A rule that could never match, three times in one day** (2026-10-17): a
  tool wrote `` into regular expressions as the byte it escapes, 0x08, so
  `/(?:delete|destroy)/` became `/<backspace>(?:delete|destroy)/` and
  matched nothing. It happened in the repair guard, in the destructive-plan
  guard, and once more inside the fix for it. Present, readable, and
  silently inert is the worst way for a rule to be wrong: typecheck says
  nothing, lint says nothing, and a reader sees `` because an editor
  renders the byte as its escape.
  A test now reads the bytes of every source file and fails on any raw
  control character, and proves it can fail. It found a third instance
  nobody had noticed: the ANSI colour stripper in the preview runner carried
  a raw escape, which worked and was invisible to every reader and every
  tool that touches control characters. Written as `` now.

- **A repair may no longer pass by checking less** (2026-10-17): the prove
  loop rewrites a failing test until it passes, which makes it the one place
  in this product where "it passes now" can mean "it stopped checking".
  Everything else is read by a person meeting new work; a fix arrives as a
  small diff on a test they already approved, after a loop that ran until the
  red went away, and the quickest way to make a failing assertion pass is to
  delete it.
  The prompt forbade that in words -- keep the structure, keep the
  assertions' intent, say so rather than weakening it -- and nothing checked.
  Every validation run on a repair looks at the new code alone, where a
  missing assertion is invisible: three assertions are well-formed whether
  the test began with three or with four. Nothing compared the fix with what
  it was given.
  Now something does, at all three places a repair is taken: the automation
  generator, the repair service, and the MCP loop an agent drives. A fix is
  refused when it checks fewer things, turns an assertion into its opposite,
  makes the test skip itself, swallows the failure in a catch or an
  expect.soft, or waits instead of asserting. The rules are about shape, not
  meaning -- they cannot tell a better assertion from a worse one, and they
  do not try.
  Half the tests are repairs that must keep working, because a guard that
  stopped the loop doing its job would be switched off within a week: a
  locator corrected against the page that really loaded, an address fixed, a
  fixed wait replaced by an assertion, a test rewritten with the same number
  of checks.

- **A delivery says which project the markers really belong to**
  (2026-10-17): the owner merged the pull request and the dogfood repository
  ran a real test for the first time -- one passed on the live page in 1.4
  seconds. And the pass could not be recorded. Its marker named a version in
  the project it had been written in, while the pipeline reports to another,
  so production received a passing test it had never heard of and said: those
  tests "belong to a different PlaywrightGen project". True, and nowhere to
  go from.
  The product knew which project. The miss was scoped to organization and
  project, so a second lookup scoped to the organization alone -- and never
  wider, because which projects a workspace has is that workspace's business
  -- names it: "That version belongs to 'Checkout web app' in this workspace:
  this pipeline is reporting to a different project than the one those tests
  were written in. Point PLAYWRIGHTGEN_PROJECT_ID at that project, or write
  the tests in this one."
  Said in both shapes of the failure, including the likelier one where
  nothing was recorded at all, which a test caught because the first version
  of the fix only spoke in the other. Bounded to three lookups: a suite whose
  every marker is foreign asks one question, not two hundred. A version
  owned by no project in this workspace is not named at all -- it may be
  another tenant's, and a test holds that line.

- **The cap sweep: four counts that were counting the page, not the thing**
  (2026-10-15): the question for each hard `take:` was never whether the
  bound is right but whether the surface reading it says the bound exists.
  Three of the four said nothing, and each was wrong in the direction nobody
  would question.
  The release page counted the rows it had been handed: a project with more
  than twenty live proof links was told "20 shared links can read this
  evidence", which is the worst possible answer to "who can see our
  evidence". It now counts them and says when the list is not all of them.
  The Quality page read "{failed} of {total} recent attempts failed", with
  the total from a real count and the failures counted from a list capped at
  twenty-five. Sixty failures showed as twenty-five, understating failure on
  the page called Quality. Counted properly now, with the list beside it
  named as the twenty-five most recent.
  The cron reported "50 due, 50 ran", which reads as a finished round whether
  fifty projects were waiting or two hundred. It now reports what was due,
  what this invocation took, and what ran.
  The fourth was not a count. The review trail looked for a submission among
  the twenty newest events for a record; a record argued over long enough
  pushed its own submission out of that window, and the page then dropped the
  submitter's name and offered an Approve button to the person who had
  submitted it. The rule itself held -- `checkSelfApproval` asks for the
  submission directly and refuses the click -- but a page offering something
  the product will refuse has told somebody a lie about what they may do. The
  trail now reads the same fact the rule reads.
  Each fix carries a test proven to fail against the old code: 25 where 30
  was true, and "expected undefined to be 'Author'".

- **The evals became a gate that cannot be satisfied by deleting them**
  (2026-10-15): nine eval files measured the AI surfaces and nothing failed
  when one regressed. Worse, the runner compared each run with the one before
  it, which ratchets: a case breaks, the run is archived, the next run
  compares against the broken one and reports nothing wrong. A regression
  became the new normal without anybody deciding it should.
  The comparison is now against a baseline that moves only by hand
  (`npm run evals -- --accept`), committed because what a case is expected to
  do is a decision somebody can argue with, while a score from one afternoon
  is not. The gate fails on two things and no others: a case that was passing
  has stopped, or a case in the baseline did not run at all -- renaming a
  case looks exactly like deleting one, and a suite that quietly stops
  measuring leaves somebody trusting a check that is not happening. A case
  this suite expects to fail, like the live-page generator passing about one
  run in three or the review inventing a missing criterion, keeps failing
  without gating anything. A gate that demanded all green would be satisfied
  by deleting the measurements, which are the only things that know.
  It runs weekly and on demand rather than on every push: each case calls a
  real model, and a gate on every commit would spend money on typo fixes.
  Without a provider key the workflow says so and stops, rather than standing
  red where nobody can fix it -- which is what the dependency audit did for
  three weeks while hiding every real failure behind it. **The owner must add
  `OPENAI_API_KEY` as an Actions secret before it measures anything.**

- **"This workspace has used today's AI requests" -- on what?**
  (2026-10-15): the product could not say. The allowance was a single counter
  in Redis; token counts lived in an AiRun row for reviews, an automation
  version row for generation, a third table for failure analysis, and a
  console line for the free tools. Nobody could answer the only question
  that follows being refused.
  Every AI request in the product passes through one function, with the
  surface already named in the call. The reservation script now counts by
  surface in the same atomic step as the spend, so the breakdown cannot
  disagree with the total it breaks down, and it expires with the day it
  describes. No table, no migration, no new page.
  The answer appears where the refusal does: "Today's requests went to
  planning a page's tests (12) and writing automation (6)." Three surfaces at
  most, largest first, with the remainder totalled -- a tail of ones answers
  nothing -- and a surface the product has no name for is shown by its slug
  rather than dropped, because a silent omission is how a tally stops adding
  up. Read only when somebody was refused the daily allowance, so every other
  render pays nothing, and a tally that cannot be read leaves the figure that
  is actually enforced untouched.

- **Measuring the requirement review found it throwing good reviews away**
  (2026-10-15): the surface that was wholly broken on 2026-10-12 had no eval,
  which is why nothing noticed. Writing one found two more ways it discarded
  work nobody could get back.
  The product demands that every suggestion quote the requirement, and
  refuses the whole review when one cannot. Right for invented words. Wrong
  twice over: the model quoted an acceptance criterion exactly and labelled
  it DESCRIPTION, and it quoted a sentence as far as "without a reload" and
  closed the quotation with a full stop. Both were the customer's own words.
  Both threw away a complete review of a well-written requirement, and the
  reviewer saw only "the AI review did not finish". A quote found in another
  field is now kept and its label corrected; a quotation that stops
  mid-sentence is accepted; a quote found in no field at all still refuses
  the lot, because that is the rule worth having.
  The strict validator that disagreed with this was dead in production and
  alive only in its own tests, so it is gone rather than left to mislead.
  Severity is now defined in the prompt -- HIGH means a defect could ship or
  the requirement cannot be tested as written -- because a sound requirement
  was coming back with four HIGH suggestions including "verification of no
  page reload", and a review where everything is urgent says nothing about
  where to look first. That halved it. The eval stands at 3 of 4 and the
  fourth is left failing: on a complete requirement this model still claims a
  criterion is missing that the requirement contains. The score is the
  measurement.

- **A hidden instruction would have had somewhere to go** (2026-10-15):
  every AI surface's prompt says to treat the page, the ticket and the run
  output as untrusted data and never as instructions, and nothing anywhere
  checked that it held. A prompt is a request; a validator is a rule. The
  threat is specific rather than theoretical: generated code is approved by
  somebody reading for whether the test is right, and then runs in the
  customer's own pipeline with the customer's secrets in the environment.
  One line in sixty is a reasonable thing to miss.
  None of the attacks needed `eval`, a shell or an import worth noticing. A
  request to another site, a `fetch` inside `page.evaluate` carrying
  `document.cookie`, cookies or `storageState` posted somewhere, and
  `await import("node:child_process")` -- which walked straight past a rule
  that only read `import ... from`. All four are now blocked by shape rather
  than by the model's good behaviour, and the finding names the address so
  the line can be found.
  The corpus is the point: ten cases, written the way a model that had been
  talked into it would write them, half of them legitimate tests that must
  keep passing -- the application's own API by three spellings, a
  `page.evaluate` that reads the page, an ordinary browser test. A rule that
  stops an attack and also stops real work is not a rule anybody keeps.

- **This repository's own CI has been red since 2026-09-23** (2026-10-12):
  found by asking why production had stopped taking deployments, and worse
  than first written here. The claim that it had been red "for a day and a
  half" was about one step: the dependency audit began failing on 2026-10-11
  21:56. The workflow as a whole has failed on all 58 runs since 2026-09-23.
  Every commit yesterday and today was verified locally with typecheck, lint,
  targeted tests and a production build, and not one was checked against the
  repository's own pipeline. Exactly the failure this product exists to
  prevent, in the repository that builds it.
  The advisories were real: a critical one in `next`, nine high, among them
  `undici` reached through `cheerio`, which this codebase uses to read HTML.
  Fixed where a fix exists -- `next` to 16.4.0, `vitest` to 4.1.11, and
  overrides pinning `undici`, `sharp`, `micromatch`, `brace-expansion` and
  `fast-uri` to patched versions. What ships now audits clean at every
  severity.
  One advisory cannot be fixed: `braces` has a high advisory against every
  version ever published and reaches this project only through
  eslint-config-next's plugin chain. A gate no change to this repository can
  satisfy is not a gate, it is a permanent red light that hides the real
  failures behind it, so the enforced audit is now what ships
  (`npm audit --omit=dev --audit-level=high`) and development tooling is
  audited beside it without failing the build. The next session should check
  whether `braces` has a patched release and, if so, enforce the whole tree
  again.

- **"Open a pull request" crashed every time it was pressed** (2026-10-12):
  the one path in the GitHub integration nothing had walked. The action
  redirected using `artifactPath`, a constant declared two lines below it, so
  every press threw "artifactPath is not defined" and showed the crash page --
  after the branch and the commit had already been written, which is how a
  branch from September came to exist with no record of anyone succeeding.
  Fixed by declaring the paths above the actions that close over them, and
  `no-use-before-define` is now on for variables, which is what would have
  caught it. Four other places tripped it; all four were safe (references
  inside functions that run later), and three were reordered while the fourth
  carries a comment saying why it stays.
  Two more things the same walk found. The pull request now says what the test
  needs before it can run -- it opens `./`, the address it was proven against,
  and that only the test file is included -- because PlaywrightGen keeps the
  configuration that holds the baseURL and the repository's own config belongs
  to the team. And when a pull request for that branch already exists, its
  description is refreshed instead of left at an earlier version's: the
  dogfood repository's had sat there since September while the product pushed
  new commits under it.
  The pipeline template now passes `BASE_URL` from repository variables into
  the test run, with the reason written beside it; the GitLab and Jenkins
  templates already pass their whole environment through, so they say it
  rather than change. The example repository's configuration reads that
  variable, which it previously did not set at all.
  Verified on the real pull request: hmamut39/playwrightgen-ci-proof#1 now
  carries the current description and the sentence about the address.

- **The pull request says what the test needs before it can run**
  (2026-10-12): trying to make the dogfood repository prove something
  explained why it never had. PlaywrightGen writes tests that open `./`,
  relative to Playwright's `baseURL`, and the only copy of the address they
  were proven against lives in the configuration PlaywrightGen keeps. The
  pull request carries the test file alone -- the repository's configuration
  belongs to the team and this product does not rewrite it -- so the test
  arrives somewhere with no address. That repository's own config takes its
  base URL from an environment variable its pipeline never sets, and for
  weeks the result was a skip that no page, comment or log explained.
  The pull request now states it where the decision is made: what the test
  opens, the address it was proven against, that only the test file is
  included, and that without a `baseURL` the run reports a failure about the
  missing address rather than about the application. When the test uses full
  addresses it says nothing.
  Fixing it also surfaced a test that had been red on main since the
  validation rule for relative navigation landed: the fixture generated
  `page.goto("./")` with `defineConfig({})`, so the rule correctly blocked an
  artifact the test then tried to submit. The fixture was unrealistic, not
  the rule; it now carries a baseURL. The miss was mine -- the rule shipped
  without this file among the ones I ran.

- **The AI requirement review was refusing its own work, silently**
  (2026-10-12): walking the reviewer's leg on a requirement drafted from a
  pasted ticket, "Run AI review" replaced the page with "This page didn't
  load" -- every time, and not because of the allowance. The reason reached a
  database column and nothing else: one code, `invalid_output`, covering
  three different faults, never logged, never shown. The reviewer saw a crash
  and the operator saw nothing.
  With the code logged and split, the fault was plain: the model had raised
  an edge case without quoting the requirement, and the product throws away
  the entire review when any suggestion cannot be supported. That rule is
  right for a quote the requirement does not contain -- attributing words to
  a customer who never wrote them is the one thing this product must never do
  -- and wrong for a suggestion that quotes nothing, which attributes nothing.
  Those are now treated apart: a fabricated quote still refuses the lot, a
  suggestion citing nothing is dropped, and the summary says how many were
  dropped and why. The review page also survives any other refusal with a
  sentence instead of a crash.
  Live afterwards, same requirement: the review succeeded, kept two
  missing-criteria suggestions a reviewer can act on, and said "3 further
  suggestions quoted nothing in this requirement and were left out".
  Typographic punctuation is now flattened before an excerpt is compared, so
  a curly apostrophe out of Jira cannot fail an honest quote. That was a
  guess about the cause, not the cause; it is a real robustness fix and it
  earned no credit for this one.

- **A skipped test is an absence, not a failure** (2026-10-12): the first
  question of the day was whether the dogfood repository was still red. It
  was green -- and green for the wrong reason. Yesterday's fix there made an
  unrunnable test skip before navigating instead of crashing, so the suite
  passes with one test skipped and nothing proven: the pipeline has no base
  URL and no card data, and never will have, because the test was written
  against a shop that does not exist.
  What the product then did with that skip was the real find, in three
  places. The CI log read "Recorded 1 of 1 result." -- true, and it reads as
  a pipeline that proved something. The requirement's verdict read FAILING,
  "1 approved test last ran and did not pass", directly above a line saying
  "could not run": the page contradicted itself, and the verdict sends a team
  hunting a product defect that is really a missing secret. And every such
  delivery queued a paid model call to explain why a test that never ran did
  not pass.
  All three now follow what was already stored. The verdict for a blocked
  test is UNVERIFIED, saying nothing demonstrates the behaviour and that a
  skip is usually waiting on an address or a credential; a real failure is
  still FAILING and now also names what was skipped alongside it. The CI log
  and the pull-request comment say the delivery proved nothing. Only a test
  that ran and failed is analysed.

- **The verdict accounts for the approved tests that never ran**
  (2026-10-11): reading a shared link as the client -- no account, one link,
  asked whether this is good enough to ship -- the requirement said "1
  approved test last ran and did not pass." Beneath it sat three tests, two of
  them "never run". The verdict was drawn only from the tests that had
  executed, so the sentence a reviewer reads first was true and incomplete.
  On a VERIFIED requirement the same silence is worse: one test passes, two
  have never run, and the page reads as coverage nobody demonstrated. Both
  verdicts now end with how many approved tests have never run, and the
  shared page and the kept file inherit it from the same sentence. Live:
  "1 approved test last ran and did not pass. 2 more approved tests have
  never run."
  Two smaller things from the same walk. The acceptance badge on the team's
  release page read "the evidence is unchanged since" and stopped there --
  now "unchanged since they accepted it". And the file downloaded from a
  shared link knows that link's acceptances and no others, so with none of
  them it left the section out entirely; a reader a year later takes that
  silence for a project nobody signed off. It now says it can only speak for
  the link it came from. The team's own copy stays silent, which an earlier
  decision settled deliberately and this did not overturn.
- **A spent AI allowance is a sentence with a time in it, not a crash**
  (2026-10-11): continuing the walkthrough as the business analyst -- paste
  the ticket, press Read the ticket -- produced a 500 page reading "This page
  didn't load. If you just created your workspace, it may still be finishing
  setup. Trying again usually works." The workspace was weeks old, the
  failure was the day's AI allowance, and trying again would not have worked
  for another 64 minutes, which the guard knew to the second. The pasted
  ticket was gone too.
  Looking for the same fact elsewhere found five surfaces answering it five
  ways: that crash page, "It could not be read just now", "The model could
  not be reached" (it was never asked), a branch testing
  `organization_ai_rate_limited` -- a code nothing throws, so it could never
  fire -- and one correct notice. They now all read it from one translator,
  which keeps the wait, and the two limits get opposite advice: a burst limit
  says press the same button again in a minute, a daily limit never invites a
  retry it knows will fail. A refused ticket read comes back with what the
  person pasted still in the box. Verified against a workspace that had
  really spent its allowance: "This workspace has used today's AI requests.
  Reading tickets works again in 54 min, at midnight UTC."
- **The gaps panel reported in a sentence instead of killing the page**
  (2026-10-11): pressing "Read the gaps" on a requirement with no approved
  test took the whole requirement page down -- not the panel, the page, with
  everything the reviewer was working on. `initialGapsState` was imported
  into the server component from the `"use client"` module that declared it,
  where the bundler replaces every export with a client reference, so
  spreading it into the action's answer produced a state with no `criteria`
  and the panel died on `state.criteria.filter`. Every failure it was written
  to explain did this, including the commonest: no approved test linked yet.
  The value moved to a plain module. Typecheck, lint and the build all passed
  before and after, so a test now reads the repository and fails on any plain
  value a server module takes from a client module; it proves itself against
  the shape of this bug before trusting its verdict on the real tree.
- **Coverage counts the app's controls, not the credit line in the footer**
  (2026-10-11): walking the product as a whole team -- lead creates a
  project, product reads the page, QA proves the plan -- produced six tests,
  five passing on the live page, and then a coverage line that read "the
  proven tests reach 1 of the page's 4 named controls" and named the three it
  had missed: `link "real TodoMVC app."`, `link "Remo H. Jansen"`,
  `link "TodoMVC"`. All three are footer links to other websites. A team
  reading that goes looking for three missing tests, two of which would
  assert something about a stranger's GitHub profile. Under-reporting
  coverage misleads exactly as badly as flattering it.
  A link's address is the only thing that separates a control of this page
  from a way off it, and the page snapshot was deleting addresses before
  anything could look -- they are long and useless for writing a locator, so
  they were stripped out of the tree handed to the model. They are now kept
  beside it. Links leaving the site are held out of the total and the page
  says so in a line of its own, because a number that quietly shrank is the
  other way to mislead with a count. Proven on the live product after a
  rebuild: the same page now reads 1 named control, with 3 off-site links
  reported as not counted.
  The first fix passed its unit tests and changed nothing in the product,
  because the test fed the parser a raw snapshot and the product fed it a
  stripped one. The regression test now strips the tree exactly as the
  capture does.

### Reaching the people who never open it
- **The evidence can be read for one release, without owning the release**
  (2026-10-11): a product owner arrives asking what the evidence says for
  what they are shipping, and the whole report cannot answer it -- a project
  holds every requirement it ever had and a release is a handful of them.
  Answered without a release entity. A sprint or a milestone is a time-box
  that lives in the tracker where the team edits it daily; a copy here would
  disagree with it inside a week and would need a page to disagree on. So the
  grouping is read from GitHub milestones and the join is the reference a
  requirement already carries from the ticket it was drafted from, which the
  ticket fetch now fills in by itself. No new entity, no new page: a row of
  chips on the evidence report that already existed.
  The cost is stated rather than hidden. Requirements written by hand carry
  no reference and belong to no milestone, and an issue in the milestone that
  no requirement references is reported as exactly that -- work going out
  with nothing saying anything about it, which is what a release review is
  for. Totals follow whichever list is on screen, because a count describing
  something other than the list beneath it is the oldest way to mislead with
  a report.
### Reaching the people who never open it
- **A push is told what it did to the evidence, on its pull request**
  (2026-10-11): the structural problem this product has is not missing
  features, it is that everything it knows lives on its own pages. A
  developer who broke a test never opens them -- their work is a pull
  request, and that is where merging is decided. CI already lists which
  tests failed, so repeating it would be noise. The sentence nothing else in
  the pipeline can write is the one about requirements: that the test which
  just started failing is the only thing verifying a behaviour, and the
  behaviour is now unverified. That is assembled from the approval chain, the
  version pinning and the run evidence, and no other tool holds all three.
  One comment per pull request, edited in place rather than appended to,
  because a comment per push turns a conversation into a log and the second
  one is where people stop reading. It states and never gates: a product that
  refuses to let somebody ship has claimed an authority this one spent its
  design avoiding.
  Needed no new permission. The App already holds `pull_requests: write` for
  the branch-opening path, and the token minted here carries that alone --
  not the `contents: write` that path also needs, because nothing here writes
  a file. A blocked test reads as not verified rather than as fine, which is
  the documented way a required check silently stops guarding anything.
  No page was added. That was the constraint and it was the right one.
### Saying how much a report covers
- **The acceptances say when they are not all of them** (2026-10-11): the
  last known instance of the cap defect, and the one in the worst place.
  `listEvidenceSignatures` took fifty with no count, so a project with more
  sign-offs than that showed fifty in the compliance pack and implied they
  were all of them. A pack that under-reports who accepted a release is worse
  than one listing none, because it looks complete. The listing now returns
  its page beside the true total, the pack names both when they differ, and
  the Release page says it is showing the most recent.
  The per-link listing was checked and left alone: signing refuses beyond
  twenty on one link and the listing takes twenty, so it can never be a
  truncated view of a longer list, and saying so costs no count query.
### Measuring the prompts
- **The eval caught a bad fixture, once the archive could say why**
  (2026-10-11): the new `criteria-coverage` eval failed one case in about
  five, and the run recorder kept only pass or fail, so by the time anybody
  looked the model had answered differently and the evidence was gone.
  Failure messages are now archived with the run. The very next failure
  explained itself: the reading had reported "Signing in as the customer
  before opening the payment step" as behaviour outside the requirement, and
  it was right -- the test signs in and the requirement never mentions
  signing in. The fixture meant to show tests staying inside the requirement
  did not stay inside it. The eval caught my mistake, not the model's, which
  is the second time in two days that reading the output beat changing the
  assertion.
  Also fixed while there: the runner spawned `npx.cmd` through a shell, which
  Node warns about because an args array is concatenated rather than escaped
  there. It now runs vitest's own entry with this Node, no shell involved.
### Measuring the prompts
- **An eval asserted the wrong thing, and four runs said so** (2026-10-11):
  the new `requirement-from-ticket` eval held the drafted description to the
  prompt's literal wording -- open questions belong "never in the description
  or the acceptance criteria" -- and failed. Before changing either side, the
  draft was run four times and printed. Expiry reached the description once,
  and the sentence was the ticket's own: "We have not decided what happens
  when the saved card has expired." Repeating that decides nothing. Across
  the same four runs no acceptance criterion mentioned expiry at all, which
  is where an invented rule would become a testable claim and enter the
  evidence chain.
  So the criteria are asserted strictly and the description is not. That is
  not an assertion relaxed to go green: the property worth protecting is
  still held, and the one removed was measuring a rule stricter than the harm
  it existed to prevent. The prompt was left alone -- its strictness is cheap
  and mostly obeyed, and loosening it to match the eval would trade a real
  guard for a tidier test.
### What the product found in itself
- **A marker that points nowhere is not a missing marker** (2026-10-11):
  ingest counted two quite different outcomes as `unmatched` -- a result
  whose title carried no `[pwg:…]` marker, and one carrying a marker for a
  version this project does not have -- and the delivery note told both of
  them "carried no marker, so they belong to tests PlaywrightGen does not
  know about". For the second that is false, and the advice is backwards: the
  marker is already there, and the fix is to look at which project the tests
  belong to, not to add something.
  PlaywrightGen's own delivery on 2026-09-22 was exactly that case and was
  told exactly the wrong thing -- found while checking whether a different
  hypothesis about multiple tests per file was true. It was not; this was.
  The two are now counted apart as `unmatched` and `unknownVersion`, and the
  note says whichever applies, or both when a delivery carries some of each.
  Rows written before the split read as zero, so older deliveries keep their
  original wording rather than acquiring a claim nobody measured.
### What the product found in itself
- **The proof repository is green again, and says it has not been verified**
  (2026-10-11): `playwrightgen-ci-proof` had failed every run since
  2026-09-07. Fixed in that repository the way the new rules describe: the
  configuration takes `baseURL` from `TEST_BASE_URL`, and the guard moved to
  the top of `beforeEach`, where it runs before the navigation instead of
  after it. Checked before pushing by running Playwright against both
  versions -- one failed, one skipped, exit zero.
  CI is now green and PlaywrightGen recorded attempt 4 as **BLOCKED** on
  `main @ 0f2de60b`, which is the point worth keeping: a green pipeline did
  not buy a verified requirement. The test did not run, so the evidence says
  it did not run. It stays blocked until somebody supplies `TEST_BASE_URL`
  and the card details, which is the paid-path work the owner has deferred.
### What the product found in itself
- **A generated test that could not run anywhere** (2026-10-11): looking at
  production to answer "is anybody using this" turned up the answer -- three
  users, two projects, no proof links, nothing since 2026-09-22 -- and then
  something better. The proof repository `playwrightgen-ci-proof` has been red
  since 2026-09-07. The CI integration was working the whole time: results
  were ingested, the failure was recorded, the job went red because the test
  failed, exactly as designed.
  The test was the problem. It navigated to `/cart` while its configuration
  set no `baseURL`, so every run failed with "Cannot navigate to invalid
  URL" before reaching an assertion. It could not have passed on any machine.
  A person approved it, CI ran it three times over a fortnight, and the
  product honestly recorded three failures of a test that was never able to
  work. The same file guarded itself with `test.skip()` when card details
  were absent -- sensible -- but put the navigation in `beforeEach`, which
  runs first, so the guard could never fire.
  Generation now blocks a relative navigation when nothing sets a `baseURL`,
  naming the path, and warns when a `test.skip()` sits behind a hook. Both
  run before a reviewer sees the code, which is the only place either is
  cheap. The prompt says the same so the model is less likely to write it.
  The failure detail came out of PlaywrightGen's own evidence, which is the
  first time the product has been used to answer a real question about
  itself.
### Connecting a repository
- **A failed connection names the cause** (2026-10-11): fifteen distinct
  causes arrived at three sentences, none of which said what to do. A
  suspended installation, a repository the App cannot reach, an address that
  is not a public repository, an installation already connected to another
  workspace, a repository renamed since it was connected -- each has a fix
  that takes a minute once it is named, and each produced "GitHub access or
  repository evidence could not be verified", which sends somebody to look at
  their repository, their token and their network.
  `githubFailureReason` is an allowlist of causes this deployment is willing
  to explain; the three actions carry a known code back in the address and
  anything else keeps the general message rather than being dressed up as
  advice. A code arriving in a URL that is not on the list renders nothing of
  its own, and no sentence names a token, a secret or an account the person
  cannot already see -- the already-connected case says that another
  workspace holds the installation without saying which.
  The test that enumerates every code the services can throw and requires
  each to be either explained or listed as deliberately general found three
  the first time it ran, which is the reason it exists: a code added later
  would otherwise fall back silently and for ever, which is how fifteen
  causes came to share one sentence.
### Saying how much a report covers
- **A read that failed is no longer shown as a fact** (2026-10-11): every
  surface on the evidence path caught a failed read and carried on with an
  empty list, which renders exactly like a project nobody has accepted. On a
  page that is tolerable for a moment; in the compliance pack somebody keeps
  as the record of a release it is a claim -- made by a database blip -- that
  no sign-off happened. The acceptances are now read as `null` when they
  cannot be read, and the pack prints an **Accepted by** heading followed by
  "the record of who accepted this evidence could not be read while this file
  was produced. That is not a statement that nobody has accepted it." The
  Release page and the shared proof page say the same in their own words, and
  an acceptance whose evidence could not be re-checked now says so instead of
  rendering no badge at all, which read as reassurance.
  Both branches were proven: the notice appears when the read is forced to
  fail and stays away when it succeeds.
### Saying how much a report covers
- **A partial report says so at every exit** (2026-10-11): the evidence report
  is bounded at five hundred requirements so a large project produces a report
  rather than a timeout, and it already carried `truncated`. Two of its six
  readers looked at it. The badge in a README read "480 of 500 verified" for a
  project with nine hundred requirements; the shared proof link -- the page
  sent to a customer, an auditor or a UAT stakeholder -- showed the same
  counts as a project total; the weekly email kept `report.totals` and dropped
  the caveat with the rest of the report; and the MCP tool repeated them to
  whoever asked, with no page in front of it to notice.
  The report now carries `coverage: { shown, total }` from a count beside the
  capped read, so every surface can say how much is missing rather than that
  something is. The badge says "480 of first 500 verified" and reports a
  partial failure count as "2+ failing", because a failure count from part of
  a project is a floor. The proof page, the kept file, the email and the agent
  each say it in their own words. `tests/unit/partial-evidence.test.ts` holds
  each exit separately, because careful wording on one page has never
  travelled to the others on its own.
  Found by the sweep this was scheduled for: state decided in two places.
  Proven against the real database with the dev project seeded to 521
  requirements, then the seed removed.
- **A run form keeps the test it was opened for** (2026-10-11): yesterday's
  picker work replaced a hundred-option list with a sample of twenty-five, and
  the Test Run form checked whether the test case in the address was in that
  sample before selecting it. Arriving from a Test Case that had not been
  touched lately therefore opened the form with nothing chosen, on a page
  reached from that very test. The preferred test case is now read directly
  and pinned into the options whether or not the sample holds it, and one that
  exists but is not approved says so instead of being silently ignored.
### Starting from a ticket
- **A ticket can be fetched instead of pasted** (2026-10-10): the owner
  granted the GitHub App `issues: read` and accepted it on the installation,
  so a requirement can now start from the address of an issue. Paste
  `https://github.com/owner/repository/issues/123` and the title, labels and
  body are read from GitHub and handed to the same reader the paste box fed:
  the same refusal when a ticket is not about behaviour, the same open
  questions kept out of the description.
  Only a repository the project has actively connected may be read. The App
  is installed across an account, and without that check a member of one
  project could read issues out of any repository it reaches; the connection
  is the permission, scoped to the organization and the project. The token
  minted lasts minutes, covers that one repository and carries `issues: read`
  alone -- there is no write path, and the permission ceiling refuses
  `issues: write` so one cannot appear later.
  The external reference is taken from the address rather than read back out
  of the text. Which ticket was fetched is a fact; finding it in the body is a
  guess, and a ticket mentioning another one would make that guess wrong.
  Verified end to end in a browser against a real issue: an unconnected
  repository was refused by name, and the connected one produced a titled
  requirement with four acceptance criteria and the reference
  `owner/repository#2`.
### Connecting a repository
- **The App could no longer pass its own verification** (2026-10-10): the
  installation check required every permission to be `read`, which matched an
  App that only read repositories. Opening a pull request with approved
  automation needs to write a branch and a file and open the request, so the
  App was granted `contents: write` and `pull_requests: write` -- and the
  check was never updated. Asking GitHub what the App actually holds, while
  adding `issues: read`, is what surfaced it: the live App's permissions are
  exactly the set the repository's own test asserted must be refused, so
  connecting a new GitHub installation failed, and the callback reported it as
  "GitHub access or repository evidence could not be verified" -- a sentence
  that sends people to look at their repository, their token and their
  network, none of which were the problem.
  The ceiling is now per permission instead of one blanket level, and each
  entry names the shipped feature that cannot work without it: metadata read,
  contents write, pull requests write, issues read. It stays an allowlist, so
  a permission nobody decided on is still refused whatever its level, and
  `issues` is capped at read because PlaywrightGen reads a ticket and never
  changes one. A permissions mismatch now has its own message on the
  Repositories tab saying it is a setting on the App and listing what is
  required, rather than sharing the generic failure.
  Verified against the live App and installation over the real GitHub API.
### Working at a real team's size
- **A project's hundred-and-first requirement can be reached** (2026-10-10):
  three pickers rendered a list capped at a hundred, ordered by what changed
  most recently, with no search and nothing saying anything had been left out.
  Past the cap a requirement could not be linked at all, and the page looked
  exactly as it does when no such requirement exists. The Test Run form was
  worse: it read a page of test cases and then kept the approved ones, so a
  project whose hundred most recently changed test cases were drafts offered
  nothing to run while approved ones sat just beyond the cap. That filter now
  happens in the query, through a new `statuses` option on `listTestCases`.
  All three use one `SearchablePicker`: a sample of 25, the true total stated
  on the page, and a search that runs in the database rather than over
  whatever happened to be fetched. Anything already chosen stays listed even
  when a later search does not match it -- a selection that vanishes while you
  look for the next one is how people submit half a form without noticing --
  and the match count says so. It is a client component rather than a URL
  parameter because two of the three pages are forms: a reload to search would
  throw away everything typed so far.
### The audit trail
- **The activity feed says what it knows, and can be taken away**
  (2026-10-10): every row already carried metadata -- which pipeline
  delivered results and how many were recorded, which attempt failed on which
  commit, which version of the automation was generated -- and the feed threw
  all of it away and printed the verb. Eleven rows reading "received results
  from CI" told a lead nothing while the rows underneath knew that ten of
  those deliveries had recorded nothing. `activityDetail` now reads that
  metadata defensively (these rows outlive the shape that wrote them, so an
  unexpected field produces no detail rather than a confident blank) and the
  feed shows one line of it.
  And the trail can leave the screen: `GET .../activity/download` exports it
  as CSV through the same `project:read` check as the page, newest first, with
  the project and the dates it covers in the file name. Bounded at 5,000 rows
  and the page says so whether or not the project has that many, because a
  reviewer must never read a truncated file as the whole history. The export
  and the page share one phrase per action, so the file and the screen cannot
  be read as two different records of one event.

### Running tests in your own CI
- **A delivery that is turned away is recorded, and says how to fix it**
  (2026-10-10): accepted deliveries became visible earlier today, which left
  the commoner failure dark. A project token is rotated here, the pipeline
  keeps sending the old one, every request is refused and nothing is written,
  so the page reads "no results have arrived" -- which sounds like "your CI
  never ran" when the truth is "your CI is being turned away at the door".
  A refused signature is now checked against the five most recent previous
  token versions. The delivery is still refused -- an old token writes no
  evidence, ever -- but a caller who proves possession of a real past token
  gets `stale_token` and a sentence naming the fix, and the project gets an
  Activity row saying something came and why it was turned away. The same
  applies to a valid token with no active repository connection, where there
  is nobody to attribute evidence to. The Repositories tab shows the refusal
  above the last recorded delivery while it is the latest word.
  The security line, held by two tests: a signature that was never valid is
  refused exactly as before, with nothing written and nothing revealed, so an
  unauthenticated caller can neither fill the table nor learn which projects
  exist by watching what happens. Recording is also incapable of turning a
  refusal into a 500 -- the refusal is the point and it stands either way.
  Migration `20261010160000_v1_ci_delivery_rejected` adds one enum value.

### Running tests in your own CI
- **The marker is visible to a person, not only to an agent** (2026-10-10):
  having just told teams that their existing tests record nothing because they
  carry no `[pwg:...]` marker, the obvious next question was where to get one.
  The answer was nowhere: the marker appeared only in the MCP tool output, so
  a senior SDET with four hundred existing Playwright tests and no agent could
  not adopt a single one of them by hand. Every Test Case page now shows the
  marker for its current version, with a copy button and the `test(` line it
  belongs in. It is shown for an unapproved version too, saying plainly that
  results recorded against it are kept but do not count as approved coverage --
  hiding it until approval would send somebody looking for a mistake that is
  not there. The delivery note on the Repositories tab points at it when a
  pipeline recorded nothing. Matching on title instead was rejected: a renamed
  test would silently detach, or attach to the wrong version, and the marker
  being the only binding is what makes the evidence worth anything.

### Running tests in your own CI
- **A delivery from CI is recorded even when it records nothing** (2026-10-10):
  results attach to an approved test through a `[pwg:...]` marker in the test
  title, which PlaywrightGen writes. A team with an existing Playwright suite
  has no markers, so their first pipeline run reports hundreds of results and
  none are recorded -- correctly. What was wrong is that this left no trace:
  an empty Test Runs tab, an empty activity feed, and nothing to distinguish a
  wrong token from a working pipeline whose tests simply are not ours. The
  counts existed and were a line of JSON in a CI log.
  Every delivery now writes one Activity row -- pipeline, ref, commit, and the
  recorded, duplicate and unmatched counts -- so "did my CI reach you?" is a
  question the product can answer. The row is evidence of a delivery and
  claims nothing about whether anything passed. The Repositories tab shows the
  last one under the CI steps, with an amber note when nothing was recorded,
  and says plainly when nothing has ever arrived. `deliveryNote` writes the
  sentence once and both the page and the runner's reply use it, so a build
  engineer reading a CI log and a tester reading the page are told the same
  thing; the reporter prints that sentence instead of the raw JSON.
  Migration `20261010100000_v1_ci_delivery_recorded` adds one enum value.

### Running tests in your own CI
- **The pipeline files became downloadable, and there are three of them now**
  (2026-10-10): the CI setup panel told a customer to copy `playwrightgen.yml`
  and `playwrightgen-report.mjs` out of `templates/github-actions/` -- a folder
  that exists in this repository and nowhere a customer can reach. The
  instruction was impossible to follow for everybody except the person who
  wrote it, and it sat in the first hour of the first thing an SDET or a build
  engineer does. Nothing failed to say so, because the instruction was prose.
  The files are now served by `GET /ci/<provider>/<file>`, public on purpose:
  they carry the names of credentials and none of their values, so a build
  engineer can curl one from a machine that has never signed in. The panel
  lists them as downloads, each labelled with the path it is committed at.
  GitLab CI and Jenkins were added beside GitHub Actions, because an IT
  department rarely runs only one CI and a team on either could not report at
  all before this. All three run the same reporter -- one file, served at each
  pipeline's own path -- so a fix reaches every pipeline at once and the
  evidence a reviewer reads does not depend on which CI produced it. The
  reporter now names its pipeline through `PLAYWRIGHTGEN_PROVIDER`, recorded
  with the attempt; `ingestPayloadSchema` accepts the five values it can send
  instead of GitHub Actions alone. The value grants nothing: the HMAC
  signature is still what authorizes the write.
  Two things are now checked rather than trusted. `outputFileTracingIncludes`
  puts `templates/` in the route's trace -- a runtime `fs` read is invisible to
  static analysis, so without it the files are left out of the deployment and
  the download 500s in production only, which is the worst place to find out;
  the built trace was confirmed to list all four. And `tests/unit/`
  `ci-templates.test.ts` (9 tests) holds the manifest to the pipeline files:
  every download has a readable file behind it, each definition really runs the
  reporter at the path the manifest tells a person to commit it at, every
  provider the reporter can send is one ingest accepts, no template leaks a
  token, and nothing outside the manifest can be fetched by asking for it
  cleverly.

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
- **A failing test is only repaired when the test is what is broken**
  (2026-09-27): "can it fix the failing test" is the first thing a
  team asks, and the honest answer has a condition attached. A test fails for
  two different reasons. The product changed and the test is right -- the
  failure is the whole point, and quietly repairing the test deletes the only
  warning anybody was going to get. Or the test is wrong, a renamed button or a
  timing assumption, and repairing it is the chore worth automating.
  Failure analysis already told them apart (`FailureCategory` with a
  confidence), and nothing used that. `readRepairReadiness` now does: a repair
  is offered only when the strongest finding says TEST_DEFECT or FLAKY_TIMING
  with at least 60 confidence, and a PRODUCT_DEFECT is refused in words --
  "repairing the test here would delete the only warning anybody was going to
  get" -- rather than by a button that silently declines. Environment, test
  data, dependency and unknown are left to a person. So is a failure nothing
  has analysed yet.
  The repair itself is now built. `proposeAutomationRepair` checks that gate
  first, then runs the team's own approved code against the project's live
  address through `proveDraftOnLivePage`: if it fails, the failing step is
  repaired from the page as it actually was and run again, up to two fixes.
  It starts from approved code rather than writing a new test, so a run that
  passes spends nothing and only a fix costs a request, and what comes back is
  recognisably their test with one thing changed. A repair that ends partial
  is not proposed at all -- nothing failed is not the same as proved -- and
  neither is one that still fails, which may mean the failure was not the test
  after all. When it passes it lands beside the Test Case with its run
  evidence, exactly where code from covering a page lands, and a person
  chooses to use it. It replaces no automation on its own.
  The Test Case page shows the diagnosis and the reason without anyone
  pressing anything, so a product defect reads as "repairing the test here
  would delete the only warning anybody was going to get" rather than as a
  button that declines. Integration-tested across every category, plus the
  refusals for no live address and no approved automation.
- **What this requirement still needs** (2026-09-27): a requirement counts as
  verified when any one approved test last ran and passed, so a requirement
  with six criteria and two tests reads as covered, and the records cannot do
  better -- nothing links a test to the criterion it checks. The requirement
  page now reads the two lists against each other and says which criteria
  nothing appears to check, and, in the other direction, which behaviour the
  tests exercise that the requirement never states. That second one is the
  harder gap to notice, because everything looks green while the story quietly
  left something out, and it is the question a team adopting this asks first.
  It is a reading, not a record: rendered in the panel, never stored, never
  counted, never near a verdict, and labelled that way on screen. A mapping
  nobody has verified is a good prompt for a person and a bad thing to show an
  auditor, and the only difference is whether it was written down as fact.
  Only approved tests are compared, because a draft proves nothing, and a
  requirement with no criteria says so rather than returning an empty reading.
  Integration-tested, including that nothing is written: same updatedAt, same
  version number, no AI suggestion rows.
- **An assistant is never told the project is releasable** (2026-09-27): the
  Release page is careful -- "no blocking condition was found in the recorded
  evidence... not a guarantee about untested behaviour" -- while
  `project_overview` handed an assistant a bare "Releasable: yes" and a
  `releasable: true` field. An assistant repeats that to a person as fact, and
  it is a stronger claim than this product makes anywhere. The tool now says
  "Blocking conditions: none found in the recorded evidence", adds how old the
  evidence is and marks it when stale, and carries the same sentence the page
  does. The structured result lost `releasable` and gained `blockersFound`,
  `cautionsFound` and `evidenceAgeDays`, so there is no boolean left to
  misread. Integration-tested that the word does not appear at all. Verified
  over real HTTP against the development project.
- **Green no longer means "checked lately"** (2026-09-27): the Health page
  calls a project on track when something has run and nothing is failing or
  blocking. A project whose only run was six months ago satisfies all of that,
  so it showed a plain green "On track" above "Tests have run, nothing is
  failing, and nothing blocks a release" -- every word true, and the wrong
  impression, on the screen people glance at from a phone. The verdict stays
  on track, because old evidence is still evidence and calling it a problem
  would cry wolf, but it now carries the age: "nothing failing, but the last
  evidence is 193 days old". Evidence merely aging (a week to a month) says
  nothing, or the line that matters would be trained out of people.
  Unit-tested both ways, with the exact sentence pinned. Not confirmed in a
  browser: the freshness clock reads requirement, test-case and automation
  timestamps as well as runs, and forcing the development project into a stale
  state without disturbing it proved more trouble than it was worth.
- **One passing test no longer speaks for six acceptance criteria**
  (2026-09-27): a requirement is called verified when an approved test last ran
  and passed -- any one of them -- so a requirement with six criteria and one
  passing test read exactly like one with six criteria and six. Reading a
  ticket now routinely produces requirements with five or six criteria, which
  made the overstatement common rather than theoretical, and it was going into
  the pack an auditor is handed.
  Nothing in the records says which criteria a test covers, so this does not
  claim to. It reports the number the requirement itself states -- "2
  acceptance criteria", next to the approver and the age -- and when the tests
  are outnumbered the reason says so: "1 approved test last ran and passed.
  This requirement states 6 acceptance criteria, and the records do not say
  which of them those tests cover." Where they are not outnumbered nothing
  extra is said. The pack's method section carries the same warning, so a
  reader is never left to assume that verified means every criterion was
  checked. Blank lines are not criteria. No schema change.
  Integration- and unit-tested both ways. Verified in a real downloaded pack:
  "Version 1 · approved by Aylin Tester on 2026-09-13 19:52 UTC · 2 acceptance
  criteria · checked 13 days ago".
- **An agent can start the chain** (2026-09-27): an assistant could propose
  tests and read what was agreed, but the chain begins at a requirement and
  only a person in the web app could create one -- so an assistant working
  from a ticket had to stop and ask somebody to go and type it in, which is
  where intent gets reworded or lost. `propose_requirement` creates a draft
  with a title, description and acceptance criteria, optionally submitted for
  review, and the chain names the assistant that proposed it
  (`RequirementVersion.authoredByAgent`, migration 20260927150000) for the
  same reasons it does on a Test Case version. It only proposes: coverage is
  measured against approved intent, so nothing it writes counts until a person
  approves it. Sixteen tools now. Verified over real HTTP: proposed from a
  caller identifying as Cursor 1.8.2, came back IN_REVIEW and UNVERIFIED, and
  the version recorded the assistant.
- **A correction to yesterday's pack** (2026-09-27): writing the test above
  caught it. The evidence report includes every requirement that is not
  archived, drafts included -- but three places described it as covering
  approved requirements, one of them the compliance pack's own "What it is",
  which is exactly the kind of overstatement that document exists to avoid.
  The pack now says it covers approved requirements and drafts alike, and that
  a draft will read as not verified because intent nobody has agreed to cannot
  be counted as covered. `list_requirements` and `get_requirement` say the same
  and now return each requirement's review status, so an agent can tell intent
  somebody agreed to from intent nobody has yet.
- **A requirement can start from the ticket it came from** (2026-09-27): the
  chain starts at an approved requirement, and that requirement had to be
  typed by hand -- while the work itself almost always starts in a Jira
  ticket, a Linear issue or a GitHub issue. People retyped the same intent
  into a second place, which is a chore and a chance to lose the wording that
  was agreed. "Start from a ticket" on the new-requirement page takes pasted
  text and fills the title, description, acceptance criteria and external
  reference for a person to check and edit; nothing is created until they
  press Create draft, and nothing counts until somebody approves it.
  Pasting rather than integrating was the point: it works with every tracker
  on the first day, needs no account, no OAuth and no permission from anybody,
  and a later Jira or GitHub integration only has to fetch the same text.
  What it refuses matters more than what it writes. It never fills a gap: what
  the ticket left open comes back as questions for a person to settle, shown
  in amber above the form and kept out of the description and the criteria, so
  a guess never becomes something approved, verified and shown to an auditor.
  A ticket that is not about product behaviour -- an upgrade, a question, a bug
  report that never says what should happen -- is reported as that rather than
  forced into a requirement. Integration-tested, including the refusals, the
  viewer who may not write requirements, and text too short to read (which
  spends nothing).
  Verified with the real model on a realistic ticket: 15 seconds, it kept "no
  default card in this release", and returned seven genuine open questions
  including what happens when a saved card has expired and what "most recently
  used" means.
- **The exported evidence is a pack an auditor can use** (2026-09-27): the file
  already held the evidence; what it lacked was the framing that lets somebody
  outside the team trust and navigate it. It now carries a document reference
  -- the first twelve characters of the evidence hash -- so a reader holding a
  file and a reader looking at the page can tell whether they are looking at
  the same thing, and two copies of the same evidence can be told apart from
  two different sets. Below the evidence, "How to read this" states what the
  document is, what each verdict means and that nothing is assumed beyond the
  records, how each entry came to be there (a person approved it; where an
  assistant proposed a test it is named), and -- the part that makes it usable
  as evidence rather than marketing -- what it does not claim: that the names
  were identity-checked, that the evidence is current, or that coverage is
  complete.
  The hash moved to `lib/services/evidence-hash.ts` so there is exactly one
  definition: a signature records the hash of what somebody accepted, and the
  document prints the same reference, and those two must never drift apart.
  Unit-tested, including that the same evidence yields the same reference and
  different evidence does not. Verified by downloading the file and opening it
  from disk with every network request blocked.
  Note: verified with the tests around the change (51 across evidence,
  signatures, proof links and the report), typecheck, lint and a production
  build. The full suite was not run -- the machine had 4 GB free and the full
  run has crashed it twice.
- **The evidence names who approved it** (2026-09-26): the chain said who
  proposed a test and that it ran and passed, and it ended with whoever
  accepted the result -- but the part a reviewing body actually asks for was
  missing between them: the sign-off record naming who approved each artifact
  and when. PlaywrightGen already had it, in the append-only activity trail,
  where nobody exporting evidence would ever find it. The evidence report now
  reads it back for every requirement and every test case, and the shared page
  and the kept file say "approved by Priya Raman on 2026-09-18 10:00 UTC".
  Read from the trail rather than a column on the record, which is the right
  way round: the trail cannot be edited after the fact. Where no approval is
  recorded nothing is said, rather than implying one. No schema change.
  Unit- and integration-tested, including that the name is read back from the
  activity rather than assumed.
  The chain is now whole: proposed by, proven on the live page, approved by a
  named person on a date, accepted by whoever the evidence was shared with.
- **Approve everything proven, in one action** (2026-09-26): the queue already
  said which items had passed on the live page; accepting four of them still
  cost four page loads. The Reviews page now offers "Approve the N proven
  tests" when more than one in the reader's own turn carries a passing run.
  Only tests a run has already proven are included -- anything else is a
  judgement somebody has to make by reading it, and hurrying that would defeat
  the point of the gate. Each one goes through the same approveTestCase service
  as the single-item button, one at a time, so no rule is skipped: above all
  that nobody approves their own work, which holds because the list is built
  from the reader's own turn and the queue already excludes own submissions
  wherever another approver exists. A refusal is counted and reported ("3 tests
  approved. 1 could not be, and stayed where they were"), never swallowed.
  Verified in a browser: three proven tests accepted in one action, and the
  reader's queue was then empty.
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

All three of the 2026-10-13 items are done: this repository's CI is green
again, the owner merged the proof repository's pull request and gave it a
BASE_URL, and the pull-request comment has now been seen on a real pull
request (hmamut39/playwrightgen-ci-proof#3, 2026-10-17): "GitHub Actions
reported 1 result for `bbbbbbbb`. Recorded 1 of 1 result. None of the tests
recorded here are linked to a requirement yet." A second delivery updated
that comment rather than adding another, which is the promise it makes.

What is left is no longer a list of defects. Every AI surface is measured,
every count says what it counts, the repair loop cannot weaken a test and the
generated code cannot carry anything out of a run. The next real constraint
is use: as of 2026-10-11 production held three users, two projects, no proof
links and no activity since 2026-09-22. One pass through the chain in
production, by the owner, would be worth more than another week of
hardening -- it is the only thing that says what a real team meets next.

The original 2026-10-13 list, now closed:

1. **This repository's CI, red on every run since 2026-09-23.** The audit
   gate is fixed and the failure moved to "Run unit and integration tests",
   where three causes are visible in the log: tests that call the AI guard
   and fail on `Invalid Upstash Redis environment configuration` because the
   repository holds no Actions secrets at all; one test that needs
   `RUNNER_INGEST_SECRET`; and six `reviewable_automation_required` failures,
   the same unrealistic fixture fixed in `automation-pull-requests.test.ts`
   on 2026-10-12 and still present elsewhere. The guard ones are the real
   decision: either CI gets the two secrets, or those tests inject a guard
   instead of reaching the real one. The second is better and is more work.
2. **The owner's two steps on the proof repository**: merge
   hmamut39/playwrightgen-ci-proof#1, and give that repository a `BASE_URL`
   variable of `https://demo.playwright.dev/todomvc/` plus the updated
   workflow and config from `examples/ci-proof`. Then its CI proves a real
   test for the first time, and the delivery records a pass rather than a
   skip.
3. **The pull-request comment from a real delivery.** With #1 merged and a
   passing run, the note PlaywrightGen leaves on a pull request can finally
   be seen on a real one.

Walked on 2026-10-12: the developer's CI leg, the automation leg, and the
AI paths. The dogfood repository is green and the product now says what that
green means -- verified in its real CI log, from production: "Recorded 1 of 1
result. It was skipped, so nothing here demonstrates the behaviour: a skipped
test is usually waiting on something the run did not have, such as an address
or a credential." The automation leg runs end to end: an approved test case
generated code, ran on the live page (7 checks passed, 1 step could not run
there), passed deterministic validation and waits for a person. Ticket into
draft, approval, and proposing test cases all succeed; the AI requirement
review was broken for every requirement whose review carried an unquoted
suggestion and now works.

Still unwalked: a pull-request comment from a real delivery (the proof
repository pushes to main, so there has been no open pull request to comment
on; opening one on it is the way to see that surface), and the proof
repository still proves nothing, because its only test was written against a
shop that does not exist. The honest fix there is a test from PlaywrightGen's
own flow against a page that does exist -- the TodoMVC demo -- pushed to the
repository by the product, which is also the one path in the GitHub
integration never yet walked.

Where 2026-10-11 stopped, so the next session starts without re-deriving it.
The whole-company walkthrough reached the outside world -- lead creates a
project, the product plans and proves on the live page, the BA drafts, the
reviewer reviews, a signed-out client accepts, an auditor downloads the file
-- and three legs are still unwalked:

- **The developer's leg: a CI run and the comment it leaves on a pull
  request.** Needs a push to `hmamut39/playwrightgen-ci-proof`, which was
  last seen red for 34 days because of a test that could never run. Check
  whether that is still true before anything else: the dogfood repo being red
  is the product failing in public.
- **The automation leg.** Generating code for an approved test, the
  validation gate, and a person reviewing it. Partly seen on 2026-10-11 (an
  artifact sat at "Validation passed", approved v--), never walked end to end.
- **The AI legs a spent allowance blocked.** The refusal path is fixed and
  verified; the success path is not: a ticket read into a draft, proposed
  test cases, criteria gaps. The workspace allowance resets at midnight UTC,
  so these run first in a fresh session.

In priority order. Each item should end verified in a browser and shipped.

A note before the list. On 2026-10-11 production held three users, two
projects, no proof links and no acceptances, with nothing happening since
2026-09-22. The code is ahead of the adoption, and five finds that day came
from one question -- where does the product know something and not say it --
each narrower than the last. Keep that honest: hardening has falling returns
against one real team using it.

On 2026-10-11 the owner sent seven industry reference diagrams -- agent skill
trees, the nine terms, the 2026 concepts list, the tooling cheatsheets -- and
asked that the plan be built from them. Checked against the code rather than
adopted wholesale, most of what they name is already here or does not apply:

- **MCP, tool calling, structured output**: shipped. Sixteen tools.
- **Guardrails**: shipped, and stronger than the diagrams describe. Approval
  gates, a permission ceiling that fails closed, a refusal to repair a test
  whose failure looks like a product defect, and an append-only Activity log
  behind every action. "Least access, every action logged" is the caption; it
  is also the code.
- **Memory and state**: shipped. PostgreSQL is the long-term memory --
  versions, attempts, approvals, acceptances -- and it is the product, not a
  side effect.
- **Observability**: largely shipped. Every AI run records model, prompt
  version, schema version, token counts, failure code and timing.
- **RAG**: deliberately not. Retrieval here is a structured read -- the
  approved version, the live page's accessibility tree, the recorded failure
  -- and each is exact. A vector store would add infrastructure without a
  question it answers better, and an approximate match is the wrong shape for
  evidence.
- **Multi-agent, A2A, AI gateway, agent harness**: not this product.
  PlaywrightGen is a system agents use through MCP, not a harness that runs
  them. Spend here would be fashion.

That leaves evals, where the three diagrams that list it agree -- and where
the first reading of this repository was simply wrong.

**Correction, 2026-10-11.** The line that stood here said `lib/ai/` holds
eleven prompts and nothing measures any of them. That was false. `evals/`
already held seven eval files, a `vitest.evals.config.ts` and an `npm run
evals` script, and had done for some time. The claim came from a search
scoped to `tests/`, which could not have found a directory called `evals`,
and the absence of a result was written down as the absence of the thing.
An `ls` at the repository root would have settled it. The suite that exists
is also better than the one that was going to replace it: it grades
deterministically against structured output rather than with a model judge,
and holds every evidence field constant except the one under test, so a
change in classification can only be attributed to that field.

1. ~~**Evaluate the surfaces the suite does not reach.**~~ Closed 2026-10-17:
   every surface in `lib/ai/` that calls a model has an eval file, twelve in
   all. The two that do not are `generated-code-safety` and
   `repair-weakening`, which are deterministic validators rather than prompts
   and are covered by unit tests. Original item, which named three that have
   since been written:
   **Evaluate the surfaces the suite does not reach.** `requirement-from-
   ticket` was covered on 2026-10-11, five cases, paired so a prompt that
   answered "behaviour" to everything or invented a ticket key would fail
   half of them. `criteria-coverage` followed on the same day, six cases.
   Remaining: `requirement-review`, `draft-repair`, `page-coverage-plan`.
   Previously covered:
   automation-generation, coverage-review, failure-analysis, live-page,
   quick-generation, release-review, test-case-proposals. Not covered:
   `requirement-from-ticket`, `requirement-review`, `criteria-coverage`,
   `draft-repair`, `page-coverage-plan`. The first is the one with the
   sharpest property to assert and no coverage at all: a drafted requirement
   must state no acceptance criterion the ticket did not contain, must put
   what the ticket left open into assumptions rather than the description,
   and must refuse a ticket that is not about behaviour. Follow the existing
   files' shape -- allowed and forbidden sets rather than one expected
   answer, graded deterministically, every case paired with one that must
   come out differently.

2. ~~**The live-page eval passes about one run in three.**~~ Measured and
   fixed 2026-10-17: 4 of 10 cases on the first run before, 10 of 10 after,
   with one cause (an invented role for the counter, which is not in the tree
   because the list starts empty) and two fixes (live regions in the
   container-name rewrite; prefer the text the requirement names over a
   guessed role). Details in Shipped. Original item: Measured on
   2026-10-11 across three runs of `evals/live-page.eval.ts`: 1/2, 0/2, then
   2/2. The page is not at fault -- a hand-written test adds a todo and sees
   it, 4/4, and the `getByRole('listitem').filter(...)` locator the prompt
   recommends matches when the item is there. So the generator writes a
   first-run-passing test for this page only sometimes. The prove loop
   repairs a first-run failure in the product, so this is a quality number
   rather than a broken feature, but it is a number nobody could see before
   today. Worth several runs to establish the real rate before changing
   anything, and worth resisting the urge to fix it by loosening the eval.

3. ~~**Finish the cap sweep that 2026-10-11 started.**~~ Closed 2026-10-17.
   Every remaining bounded read was asked the question. Two were lying by
   silence and are fixed: the evidence report's approval window (it decided on
   a *name* whether to state an approval at all) and the weekly digest's week
   of checks (oldest-first, so a partial read described the start of the week
   and could post "passed every day"). The digest round also reported its own
   batch size as the number of projects waiting. `live-checks`,
   `project-quality` and `release-proof` already count past their bound;
   `approval-policy` names up to three people to ask, which is a suggestion;
   `page-coverage` compares against 200 test cases, where the cost is a
   duplicate proposal a reviewer rejects rather than a false statement. The
   earlier state of this item, for context -- known instance
   `listEvidenceSignatures` fixed 2026-10-11, the rest still open then: The evidence report's
   500-requirement bound now reaches every surface that reads it. One known
   instance was left: `listEvidenceSignatures` takes 50 with no count and no
   caller saying so, so a project with more than fifty acceptances shows
   fifty in the compliance pack and claims nothing is missing -- the same
   defect, in the same file somebody keeps. Verified present on 2026-10-11,
   not fixed. While there, check the other hard `take:` constants the same
   way: `approval-policy` 20, `live-checks` 50, `page-coverage` 200,
   `release-proof` 20, `project-quality` 25. The question for each is not
   whether the bound is right but whether the surface reading it says the
   bound exists.
4. **Make dogfooding produce a passing result.** Half of this is prepared as
   of 2026-10-17: the product wrote a test for playwrightgen.com's own home
   page through Quick Generate and it passed on the live page first time, 8
   checks, no fixes (the code is reproducible by running the same request
   against the home page). What is left needs the owner, because approval
   cannot be done on their behalf: approve a Test Case for it in production,
   then put the generated code -- with its `[pwg:...]` marker -- in the proof
   repository, whose BASE_URL would become https://playwrightgen.com.
   Original item: The loop is live: the proof
   repository reports into a real production project, CI is green, and
   PlaywrightGen records the attempt as BLOCKED because the test cannot run
   without card details the owner has deferred. Honest, but it means there is
   still no verified requirement, no proof link and no acceptance anywhere in
   production. A test of playwrightgen.com itself -- a public page, no
   credentials -- would pass genuinely and give the first real evidence trail
   and a proof link worth sending a prospect. Preparing the spec and the
   workflow is doable here; creating and approving the Test Case needs the
   owner, because approval cannot be done on their behalf.
5. **The bulk-adoption decision.** Still the owner's. A team with hundreds of
   existing Playwright tests adopts them one at a time by pasting a marker.
   Mass-creating Test Cases would manufacture approval records nobody
   reviewed, which would spend the one thing that makes this product
   different. Raised 2026-10-11; do not build either way without a decision.

6. ~~**Finish the sweep for state decided in two places.**~~ Done 2026-10-11.
   Four shapes were searched: a page filtering a service's items after the
   fact, a hard `take:` in a service whose bound never reached the surfaces
   reading it, a `slice` over a set, and a count drawn from a different query
   than its list. Two real faults came out -- the Test Run form's preselect and
   the evidence report's cap -- and the rest were string truncations or counts
   taken from the same row. Original item, kept for context:
   **Finish the sweep for state decided in two places.** Twice on 2026-10-10 a
   bug came from one place choosing rows and another filtering them: the Test
   Run form read a page of test cases and then kept the approved ones, and the
   permission gate demanded read-only while the App held the write the pull
   request feature needs. Both were silent. Worth walking the remaining list
   and detail pages asking the same question: does anything narrow, filter or
   validate a set after it has already been bounded somewhere else? Start with
   the pages that call a service and then use `.filter(` on its items.
7. **Does production use a different GitHub App?** The owner granted
   `issues: read` on `playwrightgen-development` on 2026-10-10 and it is
   verified working. If the production deployment points at another App, the
   ticket fetch there says "the App may not read issues in that repository
   yet" until the same grant is made. Degrades cleanly, so this is a question
   to ask rather than a fault to chase. `GITHUB_APP_SLUG` in Vercel answers it.
8. **Fetch a ticket from Jira or Linear.** GitHub issues are done (2026-10-10).
   Jira and Linear each need an OAuth app the owner would have to create, so
   ask only when somebody actually wants one.
9. ~~**MCP 2026-07-28.**~~ Done 2026-10-18, before a client forced it: the
   endpoint serves both eras. Checked against the specification rather than
   memory, and the compatibility matrix there is blunt -- a modern-only
   client meeting a legacy-only server fails outright, with no fall-back, and
   this surface is the product's whole bet on agents. Details in Shipped.
   Original item: The server speaks 2025-06-18. The new spec is a
   stateless rewrite (no initialize handshake, no session id, Mcp-Method
   routing, MRTR in place of server-initiated requests). Clients still
   negotiate older versions, so this is maintenance rather than a feature: do
   it when a client needs it, and keep 2025-06-18 working when it happens.
10. **Verify the paid path end to end.** Stripe payment, then webhook, then
   entitlement, then the Team allowance. Needs the owner's account and a real
   card. They deferred it again on 2026-10-10 ("i am not gonna do this for
   now"), having deferred it on 2026-09-19 as well. Do not raise it; wait for
   them to bring it up.

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

- **The full suite can crash this machine.** `npx vitest run` spawns many
  workers and twice took the owner's machine down mid-run on 2026-09-26, both
  times freezing their screen. If memory is tight, verify a change with the
  test files it touches plus typecheck, lint and a build, and say plainly in
  the report that the full suite was not run. Never start a second vitest
  process while one is running: they share one test database and destroy each
  other's fixtures. Stopping a background shell does not necessarily stop
  vitest -- on 2026-10-17 a stopped run was still going twenty minutes later
  while a second one waited on the same database, and neither finished. Check
  with `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` and kill the
  vitest process itself before starting another. The full suite takes about
  eighteen minutes (117 files, 856 tests), and its default reporter prints
  nothing until the end when the output is piped, so silence is not a hang.

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
