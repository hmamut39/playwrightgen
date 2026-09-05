-- Per-project rotation for the CI ingest token.
--
-- The token was derived from the server secret and tenant identity alone, so a
-- leaked project token could only be revoked by rotating RUNNER_INGEST_SECRET,
-- which invalidates every project at once. Folding a per-project version into
-- the derivation makes revocation local: incrementing this column invalidates
-- one project's token and nothing else.
--
-- Existing tokens change when this ships, because the derivation input changes.
-- No customer repository is reporting yet, so nothing in use is broken.

ALTER TABLE "Project"
  ADD COLUMN "runnerTokenVersion" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "Project_runnerTokenVersion_check"
    CHECK ("runnerTokenVersion" > 0);
