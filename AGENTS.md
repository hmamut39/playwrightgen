# PlaywrightGen Engineering Guide

## Start here

Before editing, read `docs/PLAYWRIGHTGEN_MASTER_PLAN.md`,
`docs/ARCHITECTURE.md`, `docs/CHECKPOINT_STATUS.md`,
`docs/DECISIONS.md`, and `docs/PRODUCTION_READINESS.md`. Then inspect the
current branch, working tree, and recent commits. Repository evidence overrides
stale prose.

## Working rules

- Continue the approved checkpoint roadmap in `docs/CHECKPOINT_STATUS.md`.
- Use current official primary documentation for Clerk, Prisma, Next.js,
  PostgreSQL/Neon, OpenAI, Stripe, Vercel, Playwright, and GitHub decisions.
- Preserve tenant isolation. Every tenant-sensitive lookup must be scoped to
  its organization, and project lookups must include `organizationId`.
- PostgreSQL owns domain state and authorization. Clerk proves identity and
  external organization membership; email is never authorization authority.
- Preserve legacy routes until a tested project-aware replacement exists.
- Never expose or log secrets, tokens, raw webhook payloads, or unnecessary PII.
- Never weaken tests merely to make validation pass.
- Use Prisma migrations for schema changes. Never edit an applied migration or
  use `prisma db push` for production.
- Prefer coherent milestones over unrelated small edits. Record architecture
  decisions and update the checkpoint ledger with each milestone.
- Before committing, run relevant tests, the full test suite when practical,
  typecheck, lint changed files, and a production build. Review the final diff.
- Do not ask the human questions the repository, terminal, tests, screenshots,
  or official docs can answer. Stop only for genuine external-account actions,
  destructive production operations, secrets, billing, DNS, or material
  product decisions.

## Git and safety

Preserve unrelated human changes. Never force-push or reset the worktree. Use
checkpoint commits after validation. Do not deploy production until the gates
in `docs/PRODUCTION_READINESS.md` are met and production approval is explicit.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
