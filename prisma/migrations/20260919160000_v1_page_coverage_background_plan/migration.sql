-- Plan a page in the background.
--
-- Reading a page and planning took long enough (about a minute) for the
-- sign-in session to lapse inside the request, so a plan now starts as
-- PLANNING, finishes in the background, and ends PLANNED or PLAN_FAILED.
--
-- Additive only: two enum values.

ALTER TYPE "PageCoverageStatus" ADD VALUE IF NOT EXISTS 'PLANNING';
ALTER TYPE "PageCoverageStatus" ADD VALUE IF NOT EXISTS 'PLAN_FAILED';
