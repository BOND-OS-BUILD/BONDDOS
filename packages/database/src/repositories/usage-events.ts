import type { UsageMetric } from '../generated';
import { prisma } from '../client';

/**
 * Phase 10 — usage metering. Explicit `UsageEvent` rows (billing-ready) for
 * metrics with no other source (API calls, storage bytes), plus
 * `getDerivedUsageCounts` which reads existing operational tables so the
 * common metrics need no double-writes. Quantities are BigInt in the DB;
 * summaries down-convert to Number (safe for realistic token/byte counts).
 */

export async function recordUsageEvent(input: {
  organizationId: string;
  metric: UsageMetric;
  quantity: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const quantity = BigInt(Math.max(0, Math.round(input.quantity)));
  await prisma.usageEvent.create({
    data: {
      organizationId: input.organizationId,
      metric: input.metric,
      quantity,
      metadata: input.metadata ? (input.metadata as object) : undefined,
    },
  });
}

/** Summed UsageEvent quantities per metric within the window. */
export async function getUsageEventTotals(
  organizationId: string,
  since: Date,
): Promise<Partial<Record<UsageMetric, number>>> {
  const grouped = await prisma.usageEvent.groupBy({
    by: ['metric'],
    where: { organizationId, occurredAt: { gte: since } },
    _sum: { quantity: true },
  });
  const totals: Partial<Record<UsageMetric, number>> = {};
  for (const row of grouped) {
    totals[row.metric] = Number(row._sum.quantity ?? 0n);
  }
  return totals;
}

/** Counts derived from existing operational tables — no duplicated storage. */
export async function getDerivedUsageCounts(
  organizationId: string,
  since: Date,
): Promise<{ toolExecutions: number; workflowExecutions: number; notifications: number; embeddings: number }> {
  const [toolExecutions, workflowExecutions, notifications, embeddings] = await Promise.all([
    prisma.toolExecution.count({ where: { organizationId, startedAt: { gte: since } } }),
    prisma.workflowRun.count({ where: { organizationId, startedAt: { gte: since } } }),
    prisma.notification.count({ where: { organizationId, createdAt: { gte: since } } }),
    prisma.embeddingJob.count({ where: { organizationId, status: 'SUCCEEDED', completedAt: { gte: since } } }),
  ]);
  return { toolExecutions, workflowExecutions, notifications, embeddings };
}

/** Total AI tokens (prompt + completion) from assistant messages in the window. */
export async function getAiTokenTotal(organizationId: string, since: Date): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ total: bigint | null }>>`
    SELECT COALESCE(
      SUM(
        COALESCE((("tokenUsage"->>'promptTokens'))::bigint, 0) +
        COALESCE((("tokenUsage"->>'completionTokens'))::bigint, 0)
      ), 0) AS total
    FROM "messages"
    WHERE "organizationId" = ${organizationId}
      AND "role" = 'ASSISTANT'
      AND "createdAt" >= ${since}
      AND "tokenUsage" IS NOT NULL
  `;
  return Number(rows[0]?.total ?? 0n);
}
