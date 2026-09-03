# Infrastructure Migration — 2026-09-02

Repository ownership and the Vercel Git connection moved from the `hasan-gen`
GitHub account to `hmamut39`. This record exists because `docs/CHECKPOINT_STATUS.md`
and `docs/PRODUCTION_READINESS.md` still cite evidence hosted under the old
account. Treat those citations as historical, not reachable.

## Why

Pushes began failing with `Permission to hasan-gen/playwrightgen.git denied to
hmamut39` (HTTP 403). The cause was credential drift, not lost ownership: the last
successful push (`9deb1eb`) completed 2026-09-01 19:27:44 EDT, and Git Credential
Manager subsequently replaced the stored token with one for `hmamut39` during the
GitHub App authorization work. The `hasan-gen` account could not be recovered — its
email address was unknown and password reset failed — so the repository was
re-established under the account the user actually controls.

## What changed

- Canonical repository is now `https://github.com/hmamut39/playwrightgen` (public).
- All 85 commits were pushed across `main` (40), `hasan_genai` (85, head `7781681`),
  and `fix-scroll-layoyt-final`. Local and remote are in sync.
- The previous remote is retained locally as `hasan-gen-backup`. It is read-only in
  practice; nobody available can push to it.
- Vercel project `playwrightgen` (`prj_adTY2946AvoXpfuaxm4f6aBQahk0`, team
  `hasan-gens-projects`) is reconnected to `hmamut39/playwrightgen` with production
  branch `main`. All 20 environment variables survived the reconnection.
- The Vercel GitHub App is installed on `hmamut39` scoped to `playwrightgen` only,
  deliberately excluding the unrelated private `Til-AI` repository.
- The Vercel account now has three independent sign-in methods (email, Google, and
  GitHub as `hmamut39`), removing the dependency on the unrecoverable account.

## Evidence that is now unreachable

The following are cited in the checkpoint ledger but live under `hasan-gen` and
cannot be opened or re-run:

- Hosted CI runs `33337224482`, `33447222445`, `33567562584`, `33569718657`.
- Vercel deployments `dpl_514c7AdqXsyeB65odPBjnhGD1Rug`,
  `dpl_Hxb1NgtN4aWvPaDNwZEXJCFncyK5`, `dpl_52T11stgWRKdhYAhirwsj33dZ2r4`, and the
  61 deployment records on the old project connection.
- The GitHub App installation `157602553` remains on `hmamut39` and is unaffected.

Re-establish equivalent evidence under the new repository before citing CI or
deployment proof for any future checkpoint.

## Local validation performed on 2026-09-02

Independently re-run against commit `7781681`, all passing: 199 tests across 30
files, `tsc --noEmit`, and `eslint`. No secrets are tracked, and none appear
anywhere in the 85-commit history.

## Caution

Production deploys are now live from `main`. `docs/PRODUCTION_READINESS.md` still
requires Production to remain untouched, so continue working on `hasan_genai`,
which produces Preview deployments only.

## Environment variable backup

A partial export lives outside the repository at
`C:\Users\Afiyat\vercel-env-backup-2026-09-02\`. Seven Preview variables are marked
Sensitive in Vercel and are write-only, so they are absent from that export and
cannot be recovered from Vercel by any means: `DATABASE_URL`, `DIRECT_URL`,
`CLERK_SECRET_KEY`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_SECRET`,
`GITHUB_SETUP_STATE_SECRET`, and `RATE_LIMIT_HASH_SECRET`. They remain obtainable
from Neon, Clerk, and GitHub respectively. Never create a replacement Vercel
project; reuse the existing one.
