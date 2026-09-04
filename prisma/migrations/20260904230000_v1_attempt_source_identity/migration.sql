-- Records the source revision each attempt executed against.
--
-- Without a structured commit, a failing attempt cannot be compared against
-- earlier evidence: the same immutable Test Case version failing on the same
-- commit is a flaky test, whereas failing only since a newer commit is a real
-- regression. Both were previously indistinguishable because the revision was
-- only embedded in free-text summary.
--
-- Additive and nullable: attempts recorded manually have no source revision,
-- and historical rows keep NULL rather than being backfilled with a guess.

ALTER TABLE "TestRunAttempt"
  ADD COLUMN "commitSha" VARCHAR(40),
  ADD COLUMN "sourceRef" VARCHAR(300),
  ADD CONSTRAINT "TestRunAttempt_commitSha_check"
    CHECK ("commitSha" IS NULL OR "commitSha" ~ '^[0-9a-f]{40}$');

CREATE INDEX "TestRunAttempt_organizationId_projectId_commitSha_idx"
  ON "TestRunAttempt"("organizationId", "projectId", "commitSha");
