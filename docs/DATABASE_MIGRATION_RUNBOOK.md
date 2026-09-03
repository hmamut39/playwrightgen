# Verified database migration runbook

Use this runbook for Preview and Production. It never authorizes a Production
deployment; the Production approval rule still applies.

## Preconditions

1. Select the exact Neon project and branch intended for the environment.
2. Confirm `DATABASE_URL` uses the pooled endpoint and `DIRECT_URL` uses the
   direct endpoint for the same database branch.
3. Configure `EXPECTED_NEON_PROJECT_ID` and `EXPECTED_NEON_BRANCH_ID` in the
   same environment scope. These identifiers are controls, not inferred from
   the connection hostname.
4. Create a provider-supported snapshot or recoverable disposable branch and
   prove the selected recovery operation before changing Production.
5. Review the additive migration and confirm hosted CI applied the full
   migration history to a fresh PostgreSQL service.

## Inspect and migrate

Run `npm run db:inspect-target`. It prints only redacted target identity, the
latest completed Prisma migration, and aggregate domain counts. Compare the
reported project and branch with the approved change record.

Run `npm run db:verify-target` when validating configuration without applying
a migration. Verification-only mode never starts Prisma.

Run `npm run db:migrate:verified`. The wrapper reads `neon.project_id` and
`neon.branch_id` from PostgreSQL and exits before Prisma unless both match the
explicit expected values. Never bypass this failure by running Prisma directly
against a deployment database.

After migration, rerun the inspector and `prisma migrate status`, then execute
the environment's authenticated data-flow tests. Record the branch ID,
migration name, commit SHA, CI run, immutable deployment ID, and recovery
artifact without recording connection strings or secrets.

## Dedicated test database

Local integration-test migrations use `npm run db:migrate:test`, never a raw
Prisma command. Set `EXPECTED_TEST_DATABASE_HOST` and
`EXPECTED_TEST_DATABASE_NAME` to the exact non-secret host and database name
that were reviewed. The wrapper also requires the target identity to contain a
`test` or `testing` marker and refuses names that contain a Production marker.
Use `npm run db:verify:test` to prove the target without starting Prisma.

## Failure and rollback

- Stop promotion and disable the affected feature flag or checkout switch.
- Do not edit an applied migration or issue an automatic down migration.
- Roll the application back to a previously verified immutable deployment when
  the additive schema remains backward compatible.
- If data recovery is required, preserve evidence and use the previously tested
  Neon recovery operation. Reconnect only after the database again reports the
  approved project and branch identity.
- Repair schema or data with a separately reviewed forward migration.
