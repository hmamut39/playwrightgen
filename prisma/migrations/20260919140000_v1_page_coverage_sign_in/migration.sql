-- Cover a page behind a login.
--
-- PageCoverage.needsSignIn marks a plan made with a test account, so proving
-- asks for it again: the account itself is never stored.
--
-- Additive only: one column with a default.

-- AlterTable
ALTER TABLE "PageCoverage" ADD COLUMN     "needsSignIn" BOOLEAN NOT NULL DEFAULT false;

