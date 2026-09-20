-- Approved automation offered to the connected repository as a pull request.
--
-- Additive only: one new activity action, so the audit trail can record who
-- opened which pull request from which approved version.

ALTER TYPE "ActivityAction" ADD VALUE 'AUTOMATION_PULL_REQUEST_OPENED';
