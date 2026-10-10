-- Every delivery from a customer's CI is recorded, including the ones that
-- recorded nothing.
--
-- Results are attached to an approved test by a [pwg:...] marker in the test
-- title. A team with an existing Playwright suite has no markers, so their
-- first pipeline run reports hundreds of results and PlaywrightGen stores none
-- of them. Until now that left no trace at all: the Test Runs tab was empty,
-- the activity feed was empty, and a wrong token looked exactly the same as a
-- working pipeline whose tests simply were not ours. The one place the count
-- appeared was a line of JSON in their CI log.
--
-- Writing an Activity row for the delivery itself -- recorded, duplicate and
-- unmatched counts, the pipeline, the ref and the commit -- makes "did my CI
-- reach you?" a question the product can answer. The row is evidence of a
-- delivery, not of a test: it claims nothing about whether anything passed.
--
-- Additive only: one enum value.

ALTER TYPE "ActivityAction" ADD VALUE 'CI_RESULTS_DELIVERED';
