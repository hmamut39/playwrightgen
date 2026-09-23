-- An address told when a daily live check starts failing or recovers.
--
-- A team with no Slack channel gets nothing today until someone opens the
-- app. The address must belong to a member of the workspace, which is checked
-- against Clerk before it is written here, so this column can never point the
-- product at a stranger's inbox.
--
-- Additive only: one nullable column.

ALTER TABLE "Project" ADD COLUMN     "liveChecksAlertEmail" TEXT;
