-- The weekly digest of daily live checks.
--
-- One nullable column recording when a project's digest was last posted, so a
-- job that runs more than once a week does not repeat it. Additive only.

ALTER TABLE "Project" ADD COLUMN     "liveChecksLastDigestAt" TIMESTAMPTZ(3);
