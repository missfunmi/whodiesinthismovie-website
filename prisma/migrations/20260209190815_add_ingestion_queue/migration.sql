-- CreateTable
CREATE TABLE "IngestionQueue" (
    "id" SERIAL NOT NULL,
    "query" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "tmdbId" INTEGER,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "IngestionQueue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IngestionQueue_status_createdAt_idx" ON "IngestionQueue"("status", "createdAt");

-- CreateIndex
CREATE INDEX "IngestionQueue_tmdbId_status_idx" ON "IngestionQueue"("tmdbId", "status");
