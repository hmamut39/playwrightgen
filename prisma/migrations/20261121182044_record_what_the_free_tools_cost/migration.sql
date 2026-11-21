-- CreateTable
CREATE TABLE "PublicAiUsage" (
    "id" UUID NOT NULL,
    "surface" VARCHAR(100) NOT NULL,
    "model" VARCHAR(100) NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "proven" BOOLEAN,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicAiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublicAiUsage_createdAt_idx" ON "PublicAiUsage"("createdAt");

-- CreateIndex
CREATE INDEX "PublicAiUsage_surface_createdAt_idx" ON "PublicAiUsage"("surface", "createdAt");
