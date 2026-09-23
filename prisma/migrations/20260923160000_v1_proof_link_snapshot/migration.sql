-- A frozen proof link.
--
-- A link shared before a change should still show what was true when it was
-- shared. When this column holds the report, the page renders it and never
-- looks at the project again; when it is null the link stays live.
--
-- Additive only: one nullable column.

ALTER TABLE "ProofLink" ADD COLUMN     "snapshot" JSONB;
