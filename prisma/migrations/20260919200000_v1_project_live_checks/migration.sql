-- Daily live checks.
--
-- A project can run its approved automation on its live URL every day and
-- record the results as ordinary run attempts, so regressions surface
-- without CI. liveChecksActorUserId is who turned them on; attempts are
-- recorded under them, as CI results are recorded under whoever connected
-- the repository.
--
-- Additive only: four nullable or defaulted columns and one foreign key.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "liveChecksActorUserId" UUID,
ADD COLUMN     "liveChecksEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "liveChecksLastRunAt" TIMESTAMPTZ(3),
ADD COLUMN     "liveChecksLastSummary" JSONB;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_liveChecksActorUserId_fkey" FOREIGN KEY ("liveChecksActorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

