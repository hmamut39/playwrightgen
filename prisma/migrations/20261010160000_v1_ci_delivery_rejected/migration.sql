-- A delivery that arrived and was refused is recorded too.
--
-- Accepted deliveries became visible in the previous migration, which left one
-- case dark and it is the common one: a project token is rotated here and the
-- pipeline keeps sending the old one. Every request is refused, the product
-- records nothing, and the page says no results have arrived -- which reads as
-- "your CI never ran" when the truth is "your CI is being turned away".
--
-- Only a refusal the product can attribute is recorded: the caller held a real
-- token for this project, either the current one with the connection since gone
-- inactive, or one of the recent previous versions. A request that cannot prove
-- that writes nothing, so an unauthenticated caller can neither fill this table
-- nor learn which projects exist by watching what happens.
--
-- Additive only: one enum value.

ALTER TYPE "ActivityAction" ADD VALUE 'CI_RESULTS_REJECTED';
