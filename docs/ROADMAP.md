# PlaywrightGen roadmap

The working plan, kept in the repository so any session can pick up where the
last one stopped. Update the "Shipped" and "Next" sections at the end of every
work session.

Last updated: 2026-09-14.

## Where the product is

Live at https://playwrightgen.com (Vercel, Clerk production, Stripe live,
Neon Postgres). Every item below was verified in a real browser, and the full
test suite (447 tests) passes.

## Shipped (most recent first)

### Free tools
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

1. **"Run it" in Coverage Review.** Let a visitor run their pasted tests (or the
   suggested next tests) on the live page with the same safe runner.
2. **Save free-tool results.** Signed-in visitors keep a history of drafts,
   runs and reviews, and can send a passing draft straight into a workspace
   project as a test case plus automation.
3. **Pages behind sign-in.** Let the live page reader and runner use a test
   account (credentials entered for one run, never stored) so tools work past
   a login page.
4. **Evals for Coverage Review and Release Review.** Only Quick Generate has
   an eval today (`evals/quick-generation.eval.ts`).
5. **Release Review structured output.** Move its route to zod structured
   output like the other tools and split the 1,500-line page into components.
6. **Open a pull request from approved automation.** Needs the owner's
   decision on giving the GitHub App write permission (currently read-only).
7. **Verify the paid path end to end.** Stripe payment, then webhook, then
   entitlement, then the Team allowance in the free tools. Not yet exercised
   with a real card.

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
