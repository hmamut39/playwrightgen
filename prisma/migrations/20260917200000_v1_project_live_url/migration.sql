-- Somewhere to prove generated automation.
--
-- Project.liveUrl is the address a project's tests run against, so automation
-- generated for an approved test case can be run and fixed before review.
-- AutomationArtifactVersion.liveRun records that run.
--
-- Additive only: two nullable columns.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "liveUrl" TEXT;

-- AlterTable
ALTER TABLE "AutomationArtifactVersion" ADD COLUMN     "liveRun" JSONB;

