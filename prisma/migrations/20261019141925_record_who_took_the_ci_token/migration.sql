-- AlterTable
ALTER TABLE "AutomationArtifact" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AutomationArtifactVersion" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "BillingSubscription" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "FailureAnalysis" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "FailureFinding" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "GitHubInstallation" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "GitHubWebhookDelivery" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "OrganizationBillingAccount" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "OrganizationEntitlement" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "runnerTokenActorUserId" UUID;

-- AlterTable
ALTER TABLE "RepositoryConnection" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RepositoryImport" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RepositoryImportFile" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "StripeWebhookDelivery" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "TestRun" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "TestRunAttempt" ALTER COLUMN "id" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "OrganizationBillingAccount_stripeCustomerId_idx" ON "OrganizationBillingAccount"("stripeCustomerId");

-- RenameForeignKey
ALTER TABLE "AiRun" RENAME CONSTRAINT "AiRun_organizationId_projectId_requirementId_requirementVersion" TO "AiRun_organizationId_projectId_requirementId_requirementVe_fkey";

-- RenameForeignKey
ALTER TABLE "AiSuggestion" RENAME CONSTRAINT "AiSuggestion_organizationId_projectId_requirementId_requirement" TO "AiSuggestion_organizationId_projectId_requirementId_requir_fkey";

-- RenameForeignKey
ALTER TABLE "AutomationArtifact" RENAME CONSTRAINT "AutomationArtifact_organizationId_projectId_testCaseId_testCase" TO "AutomationArtifact_organizationId_projectId_testCaseId_tes_fkey";

-- RenameForeignKey
ALTER TABLE "AutomationArtifactVersion" RENAME CONSTRAINT "AutomationArtifactVersion_organizationId_projectId_automationAr" TO "AutomationArtifactVersion_organizationId_projectId_automat_fkey";

-- RenameForeignKey
ALTER TABLE "FailureAnalysis" RENAME CONSTRAINT "FailureAnalysis_organizationId_projectId_testRunId_testRunAttem" TO "FailureAnalysis_organizationId_projectId_testRunId_testRun_fkey";

-- RenameForeignKey
ALTER TABLE "FailureFinding" RENAME CONSTRAINT "FailureFinding_organizationId_projectId_testRunId_testRunAttemp" TO "FailureFinding_organizationId_projectId_testRunId_testRunA_fkey";

-- RenameForeignKey
ALTER TABLE "OrganizationEntitlement" RENAME CONSTRAINT "OrganizationEntitlement_organizationId_sourceSubscriptionId_fke" TO "OrganizationEntitlement_organizationId_sourceSubscriptionI_fkey";

-- RenameForeignKey
ALTER TABLE "RepositoryImport" RENAME CONSTRAINT "RepositoryImport_organizationId_projectId_repositoryConnectionI" TO "RepositoryImport_organizationId_projectId_repositoryConnec_fkey";

-- RenameForeignKey
ALTER TABLE "RepositoryImportFile" RENAME CONSTRAINT "RepositoryImportFile_organizationId_projectId_repositoryImportI" TO "RepositoryImportFile_organizationId_projectId_repositoryIm_fkey";

-- RenameForeignKey
ALTER TABLE "TestRun" RENAME CONSTRAINT "TestRun_organizationId_projectId_testCaseId_testCaseVersionId_f" TO "TestRun_organizationId_projectId_testCaseId_testCaseVersio_fkey";

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_runnerTokenActorUserId_fkey" FOREIGN KEY ("runnerTokenActorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- RenameIndex
ALTER INDEX "AutomationArtifact_organizationId_projectId_status_updatedAt_id" RENAME TO "AutomationArtifact_organizationId_projectId_status_updatedA_idx";

-- RenameIndex
ALTER INDEX "AutomationArtifact_organizationId_projectId_testCaseVersionId_e" RENAME TO "AutomationArtifact_organizationId_projectId_testCaseVersion_key";

-- RenameIndex
ALTER INDEX "AutomationArtifactVersion_automationArtifactId_versionNumber_id" RENAME TO "AutomationArtifactVersion_automationArtifactId_versionNumbe_idx";

-- RenameIndex
ALTER INDEX "FailureAnalysis_organizationId_projectId_testRunAttemptId_start" RENAME TO "FailureAnalysis_organizationId_projectId_testRunAttemptId_s_idx";

-- RenameIndex
ALTER INDEX "FailureFinding_organizationId_projectId_testRunAttemptId_status" RENAME TO "FailureFinding_organizationId_projectId_testRunAttemptId_st_idx";

-- RenameIndex
ALTER INDEX "RepositoryConnection_organizationId_projectId_externalRepositor" RENAME TO "RepositoryConnection_organizationId_projectId_externalRepos_key";

-- RenameIndex
ALTER INDEX "RepositoryConnection_organizationId_projectId_status_updatedAt_" RENAME TO "RepositoryConnection_organizationId_projectId_status_update_idx";

-- RenameIndex
ALTER INDEX "RepositoryImportFile_organizationId_projectId_repositoryImportI" RENAME TO "RepositoryImportFile_organizationId_projectId_repositoryImp_key";

-- RenameIndex
ALTER INDEX "RequirementVersion_organizationId_projectId_requirementId_id_ke" RENAME TO "RequirementVersion_organizationId_projectId_requirementId_i_key";

-- RenameIndex
ALTER INDEX "RequirementVersion_organizationId_projectId_requirementId_versi" RENAME TO "RequirementVersion_organizationId_projectId_requirementId_v_key";

-- RenameIndex
ALTER INDEX "TestCaseVersion_organizationId_projectId_testCaseId_versionNumb" RENAME TO "TestCaseVersion_organizationId_projectId_testCaseId_version_key";

-- RenameIndex
ALTER INDEX "TestRunAttempt_organizationId_projectId_testRunId_attemptNumber" RENAME TO "TestRunAttempt_organizationId_projectId_testRunId_attemptNu_key";
