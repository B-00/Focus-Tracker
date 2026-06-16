-- CreateEnum
CREATE TYPE "DeviceSource" AS ENUM ('browser', 'desktop');

-- CreateEnum
CREATE TYPE "TelemetryEventKind" AS ENUM ('focus_change', 'heartbeat', 'session_start', 'session_end');

-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('dated', 'ongoing', 'routine');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('low', 'mid', 'high', 'extreme');

-- CreateEnum
CREATE TYPE "FocusSessionState" AS ENUM ('running', 'paused', 'completed', 'aborted');

-- CreateEnum
CREATE TYPE "FocusSessionMode" AS ENUM ('timer', 'open');

-- CreateEnum
CREATE TYPE "FocusSessionEndReason" AS ENUM ('timer_complete', 'manual_stop', 'aborted');

-- CreateEnum
CREATE TYPE "ApiKeyScope" AS ENUM ('telemetry_write');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "birthday" DATE,
    "lifeExpectancyYears" INTEGER NOT NULL DEFAULT 80,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "timezoneOverridden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ip" TEXT,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scope" "ApiKeyScope" NOT NULL DEFAULT 'telemetry_write',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PairingCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "deviceProposal" JSONB NOT NULL,
    "claimedByUserId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PairingCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "DeviceSource" NOT NULL,
    "label" TEXT NOT NULL,
    "platform" TEXT,
    "clientVersion" TEXT,
    "pairedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3),
    "lastSuccessfulIngestAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Section" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#9ca3af',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sectionId" TEXT,
    "kind" "TaskKind" NOT NULL,
    "priority" "TaskPriority" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "completedAt" TIMESTAMP(3),
    "routineDaysOfWeek" INTEGER[],
    "routineStartDate" DATE,
    "routineEndDate" DATE,
    "transferIfMissed" BOOLEAN NOT NULL DEFAULT false,
    "transferredFromDate" DATE,
    "inBacklog" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskInstance" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "scheduledDate" DATE NOT NULL,
    "priority" "TaskPriority" NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FocusSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT,
    "mode" "FocusSessionMode" NOT NULL,
    "plannedDurationMs" INTEGER,
    "state" "FocusSessionState" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "effectiveDurationMs" INTEGER,
    "endReason" "FocusSessionEndReason",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FocusSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FocusSessionPause" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "pausedAt" TIMESTAMP(3) NOT NULL,
    "resumedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "FocusSessionPause_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetDate" DATE NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "icon" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeekNote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekIndex" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeekNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelemetryEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" UUID,
    "source" "DeviceSource" NOT NULL,
    "kind" "TelemetryEventKind" NOT NULL,
    "target" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "focusSessionId" TEXT,
    "clientVersion" TEXT NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelemetryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_minute_rollup" (
    "userId" TEXT NOT NULL,
    "source" "DeviceSource" NOT NULL,
    "target" TEXT NOT NULL,
    "minuteBucket" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,

    CONSTRAINT "activity_minute_rollup_pkey" PRIMARY KEY ("userId","source","target","minuteBucket")
);

-- CreateTable
CREATE TABLE "week_activity_minutes" (
    "userId" TEXT NOT NULL,
    "weekIndex" INTEGER NOT NULL,
    "totalMinutes" INTEGER NOT NULL,
    "hasSessions" BOOLEAN NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "week_activity_minutes_pkey" PRIMARY KEY ("userId","weekIndex")
);

-- CreateTable
CREATE TABLE "routine_section_daily_score" (
    "sectionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "scheduledCount" INTEGER NOT NULL,
    "completedCount" INTEGER NOT NULL,
    "scheduledWeight" DECIMAL(6,2) NOT NULL,
    "completedWeight" DECIMAL(6,2) NOT NULL,
    "score" DECIMAL(4,3) NOT NULL,
    "runningTotal" DECIMAL(10,3) NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routine_section_daily_score_pkey" PRIMARY KEY ("sectionId","date")
);

-- CreateTable
CREATE TABLE "dated_section_daily_score" (
    "sectionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "scheduledCount" INTEGER NOT NULL,
    "completedCount" INTEGER NOT NULL,
    "scheduledWeight" DECIMAL(6,2) NOT NULL,
    "completedWeight" DECIMAL(6,2) NOT NULL,
    "backlogCount" INTEGER NOT NULL,
    "backlogTopPriority" "TaskPriority",
    "baseScore" DECIMAL(4,3) NOT NULL,
    "backlogPenalty" DECIMAL(4,3) NOT NULL,
    "score" DECIMAL(5,3) NOT NULL,
    "runningTotal" DECIMAL(10,3) NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dated_section_daily_score_pkey" PRIMARY KEY ("sectionId","date")
);

-- CreateTable
CREATE TABLE "UserDashboardPrefs" (
    "userId" TEXT NOT NULL,
    "widgetOrder" TEXT[],
    "hiddenWidgets" TEXT[],
    "collapsedWidgets" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDashboardPrefs_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_revokedAt_idx" ON "RefreshToken"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_deviceId_key" ON "ApiKey"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_tokenHash_key" ON "ApiKey"("tokenHash");

-- CreateIndex
CREATE INDEX "ApiKey_userId_revokedAt_idx" ON "ApiKey"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PairingCode_code_key" ON "PairingCode"("code");

-- CreateIndex
CREATE INDEX "PairingCode_expiresAt_idx" ON "PairingCode"("expiresAt");

-- CreateIndex
CREATE INDEX "Device_userId_idx" ON "Device"("userId");

-- CreateIndex
CREATE INDEX "Section_userId_position_idx" ON "Section"("userId", "position");

-- CreateIndex
CREATE INDEX "Section_userId_archivedAt_idx" ON "Section"("userId", "archivedAt");

-- CreateIndex
CREATE INDEX "Task_userId_kind_idx" ON "Task"("userId", "kind");

-- CreateIndex
CREATE INDEX "Task_userId_startDate_idx" ON "Task"("userId", "startDate");

-- CreateIndex
CREATE INDEX "Task_userId_inBacklog_idx" ON "Task"("userId", "inBacklog");

-- CreateIndex
CREATE INDEX "Task_sectionId_kind_idx" ON "Task"("sectionId", "kind");

-- CreateIndex
CREATE INDEX "TaskInstance_scheduledDate_idx" ON "TaskInstance"("scheduledDate");

-- CreateIndex
CREATE UNIQUE INDEX "TaskInstance_taskId_scheduledDate_key" ON "TaskInstance"("taskId", "scheduledDate");

-- CreateIndex
CREATE INDEX "FocusSession_userId_state_idx" ON "FocusSession"("userId", "state");

-- CreateIndex
CREATE INDEX "FocusSession_userId_startedAt_idx" ON "FocusSession"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "FocusSession_taskId_idx" ON "FocusSession"("taskId");

-- CreateIndex
CREATE INDEX "FocusSessionPause_sessionId_idx" ON "FocusSessionPause"("sessionId");

-- CreateIndex
CREATE INDEX "Milestone_userId_targetDate_idx" ON "Milestone"("userId", "targetDate");

-- CreateIndex
CREATE UNIQUE INDEX "WeekNote_userId_weekIndex_key" ON "WeekNote"("userId", "weekIndex");

-- CreateIndex
CREATE INDEX "TelemetryEvent_userId_startedAt_idx" ON "TelemetryEvent"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "TelemetryEvent_userId_focusSessionId_idx" ON "TelemetryEvent"("userId", "focusSessionId");

-- CreateIndex
CREATE INDEX "TelemetryEvent_deviceId_startedAt_idx" ON "TelemetryEvent"("deviceId", "startedAt");

-- CreateIndex
CREATE INDEX "activity_minute_rollup_userId_minuteBucket_idx" ON "activity_minute_rollup"("userId", "minuteBucket");

-- CreateIndex
CREATE INDEX "routine_section_daily_score_userId_date_idx" ON "routine_section_daily_score"("userId", "date");

-- CreateIndex
CREATE INDEX "dated_section_daily_score_userId_date_idx" ON "dated_section_daily_score"("userId", "date");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PairingCode" ADD CONSTRAINT "PairingCode_claimedByUserId_fkey" FOREIGN KEY ("claimedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskInstance" ADD CONSTRAINT "TaskInstance_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FocusSession" ADD CONSTRAINT "FocusSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FocusSession" ADD CONSTRAINT "FocusSession_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FocusSessionPause" ADD CONSTRAINT "FocusSessionPause_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "FocusSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekNote" ADD CONSTRAINT "WeekNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelemetryEvent" ADD CONSTRAINT "TelemetryEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelemetryEvent" ADD CONSTRAINT "TelemetryEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelemetryEvent" ADD CONSTRAINT "TelemetryEvent_focusSessionId_fkey" FOREIGN KEY ("focusSessionId") REFERENCES "FocusSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_minute_rollup" ADD CONSTRAINT "activity_minute_rollup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "week_activity_minutes" ADD CONSTRAINT "week_activity_minutes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routine_section_daily_score" ADD CONSTRAINT "routine_section_daily_score_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routine_section_daily_score" ADD CONSTRAINT "routine_section_daily_score_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dated_section_daily_score" ADD CONSTRAINT "dated_section_daily_score_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dated_section_daily_score" ADD CONSTRAINT "dated_section_daily_score_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDashboardPrefs" ADD CONSTRAINT "UserDashboardPrefs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
