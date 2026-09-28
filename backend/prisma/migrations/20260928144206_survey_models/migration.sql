-- CreateEnum
CREATE TYPE "SurveySource" AS ENUM ('micro', 'dashboard', 'whatsapp');

-- CreateTable
CREATE TABLE "surveys" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "intro" TEXT,
    "questions" JSONB NOT NULL,
    "audience" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surveys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_responses" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "landlordProfileId" TEXT,
    "source" "SurveySource" NOT NULL,
    "answers" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survey_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_dismissals" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "landlordProfileId" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survey_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "surveys_slug_key" ON "surveys"("slug");

-- CreateIndex
CREATE INDEX "survey_responses_surveyId_source_idx" ON "survey_responses"("surveyId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "survey_responses_surveyId_landlordProfileId_key" ON "survey_responses"("surveyId", "landlordProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "survey_dismissals_surveyId_landlordProfileId_key" ON "survey_dismissals"("surveyId", "landlordProfileId");

-- AddForeignKey
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_dismissals" ADD CONSTRAINT "survey_dismissals_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
