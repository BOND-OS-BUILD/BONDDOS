-- CreateEnum
CREATE TYPE "FeatureFlagScope" AS ENUM ('GLOBAL', 'ORGANIZATION', 'USER');

-- CreateEnum
CREATE TYPE "UsageMetric" AS ENUM ('AI_TOKENS', 'EMBEDDINGS', 'STORAGE_BYTES', 'API_CALLS', 'TOOL_EXECUTIONS', 'WORKFLOW_EXECUTIONS', 'NOTIFICATIONS');

-- CreateEnum
CREATE TYPE "SecurityEventType" AS ENUM ('LOGIN_SUCCEEDED', 'LOGIN_FAILED', 'AUTH_REQUIRED', 'PERMISSION_DENIED', 'APPROVAL_FAILED', 'TOOL_BLOCKED', 'RATE_LIMIT_EXCEEDED', 'CROSS_ORG_ATTEMPT');

-- CreateEnum
CREATE TYPE "RateLimitScope" AS ENUM ('USER', 'ORGANIZATION', 'API', 'AI', 'TOOL', 'WORKFLOW');

-- CreateEnum
CREATE TYPE "SearchQuerySource" AS ENUM ('FULL_TEXT', 'RETRIEVAL', 'HYBRID');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" "FeatureFlagScope" NOT NULL,
    "scopeId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_groups" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'error',
    "count" INTEGER NOT NULL DEFAULT 0,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "lastRoute" TEXT,
    "lastStatusCode" INTEGER,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "error_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_events" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "route" TEXT,
    "method" TEXT,
    "statusCode" INTEGER,
    "requestId" TEXT,
    "correlationId" TEXT,
    "userId" TEXT,
    "organizationId" TEXT,
    "url" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "error_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "metric" "UsageMetric" NOT NULL,
    "quantity" BIGINT NOT NULL DEFAULT 0,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" TEXT NOT NULL,
    "type" "SecurityEventType" NOT NULL,
    "userId" TEXT,
    "organizationId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "route" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_policies" (
    "id" TEXT NOT NULL,
    "scope" "RateLimitScope" NOT NULL,
    "key" TEXT,
    "limit" INTEGER NOT NULL,
    "windowSeconds" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_query_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "query" TEXT NOT NULL,
    "source" "SearchQuerySource" NOT NULL,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "zeroResults" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER,
    "citationCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_query_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feature_flags_key_idx" ON "feature_flags"("key");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_key_scope_scopeId_key" ON "feature_flags"("key", "scope", "scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "error_groups_fingerprint_key" ON "error_groups"("fingerprint");

-- CreateIndex
CREATE INDEX "error_groups_resolved_lastSeenAt_idx" ON "error_groups"("resolved", "lastSeenAt");

-- CreateIndex
CREATE INDEX "error_events_groupId_createdAt_idx" ON "error_events"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "error_events_organizationId_createdAt_idx" ON "error_events"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "usage_events_organizationId_metric_occurredAt_idx" ON "usage_events"("organizationId", "metric", "occurredAt");

-- CreateIndex
CREATE INDEX "security_events_type_createdAt_idx" ON "security_events"("type", "createdAt");

-- CreateIndex
CREATE INDEX "security_events_organizationId_createdAt_idx" ON "security_events"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limit_policies_scope_key_key" ON "rate_limit_policies"("scope", "key");

-- CreateIndex
CREATE INDEX "search_query_logs_organizationId_createdAt_idx" ON "search_query_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "search_query_logs_organizationId_zeroResults_idx" ON "search_query_logs"("organizationId", "zeroResults");

-- CreateIndex
CREATE UNIQUE INDEX "system_config_key_key" ON "system_config"("key");

