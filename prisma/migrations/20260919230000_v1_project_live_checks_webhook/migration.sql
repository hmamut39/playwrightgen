-- Live check alerts.
--
-- A project can name a Slack or Discord incoming webhook to hear when a daily
-- live check turns a passing test into a failing one, or a failing one passes
-- again. Additive only: one nullable column.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "liveChecksWebhookUrl" TEXT;
