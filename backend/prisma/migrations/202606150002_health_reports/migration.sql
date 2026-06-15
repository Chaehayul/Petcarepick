CREATE TABLE "HealthReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "petId" TEXT NOT NULL,
    "report" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HealthReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HealthReport_userId_createdAt_idx" ON "HealthReport"("userId", "createdAt");
CREATE INDEX "HealthReport_petId_createdAt_idx" ON "HealthReport"("petId", "createdAt");

ALTER TABLE "HealthReport" ADD CONSTRAINT "HealthReport_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HealthReport" ADD CONSTRAINT "HealthReport_petId_fkey"
FOREIGN KEY ("petId") REFERENCES "Pet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
