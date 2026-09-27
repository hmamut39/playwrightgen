-- Which assistant proposed a requirement.
--
-- Test Case versions already carry this. An editor assistant can now propose
-- a requirement too, and the chain should name the tool there for the same
-- reason: evidence that says only "an AI wrote it" answers half the question.
--
-- The value is the caller's own claim about itself. It authorizes nothing: the
-- editor token decides access and a person still approves everything.
--
-- Additive only: one nullable column.

ALTER TABLE "RequirementVersion" ADD COLUMN     "authoredByAgent" VARCHAR(120);
