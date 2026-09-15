-- Free-tool results that outlive the browser tab.
--
-- TestCaseImportedDraft keeps the Playwright code brought in with a Test Case
-- from a free tool, and the live-run evidence when a signed receipt matched it.
-- FreeToolDraft is a signed-in person's recent free-tool history, keyed by the
-- Clerk user so it works before they have a workspace.
--
-- Additive only: two new tables, no change to existing rows.

-- CreateTable
CREATE TABLE "TestCaseImportedDraft" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "testCaseId" UUID NOT NULL,
    "source" VARCHAR(40) NOT NULL,
    "code" TEXT NOT NULL,
    "pageUrl" TEXT,
    "runEvidence" JSONB,
    "importedByUserId" UUID NOT NULL,
    "usedInAutomationVersionId" UUID,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestCaseImportedDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FreeToolDraft" (
    "id" UUID NOT NULL,
    "clerkUserId" VARCHAR(255) NOT NULL,
    "source" VARCHAR(40) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "pageUrl" TEXT,
    "code" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "lastRun" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FreeToolDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TestCaseImportedDraft_organizationId_projectId_testCaseId_key" ON "TestCaseImportedDraft"("organizationId", "projectId", "testCaseId");

-- CreateIndex
CREATE INDEX "FreeToolDraft_clerkUserId_updatedAt_idx" ON "FreeToolDraft"("clerkUserId", "updatedAt");

-- AddForeignKey
ALTER TABLE "TestCaseImportedDraft" ADD CONSTRAINT "TestCaseImportedDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TestCaseImportedDraft" ADD CONSTRAINT "TestCaseImportedDraft_organizationId_projectId_fkey" FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TestCaseImportedDraft" ADD CONSTRAINT "TestCaseImportedDraft_organizationId_projectId_testCaseId_fkey" FOREIGN KEY ("organizationId", "projectId", "testCaseId") REFERENCES "TestCase"("organizationId", "projectId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TestCaseImportedDraft" ADD CONSTRAINT "TestCaseImportedDraft_importedByUserId_fkey" FOREIGN KEY ("importedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

