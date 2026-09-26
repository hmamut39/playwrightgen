-- Which assistant proposed a test, and which sent its code.
--
-- A proposal arriving over MCP was recorded as AI_SUGGESTED and nothing more,
-- so the trail said "an AI made this" and stopped. Traceability for
-- AI-assisted work is now expected to name which tool produced which
-- artifact, and a reviewer facing a queue has a fair question about who wrote
-- what. PlaywrightGen is both the MCP server and the evidence store, so it can
-- record the answer rather than reconstruct it later.
--
-- The value is the caller's own claim about itself, kept for reading history.
-- It authorizes nothing: the editor token decides access, and a person still
-- approves everything.
--
-- Additive only: two nullable columns.

ALTER TABLE "TestCaseVersion" ADD COLUMN     "authoredByAgent" VARCHAR(120);
ALTER TABLE "TestCaseImportedDraft" ADD COLUMN     "authoredByAgent" VARCHAR(120);
