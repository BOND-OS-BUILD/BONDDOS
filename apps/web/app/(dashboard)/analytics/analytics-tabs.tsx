'use client';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HBarList,
  StatCard,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@bond-os/ui';

interface UsageMetrics {
  aiTokens: number;
  embeddings: number;
  storageBytes: number;
  apiCalls: number;
  toolExecutions: number;
  workflowExecutions: number;
  notifications: number;
}
interface Usage {
  metrics: UsageMetrics;
}
interface TopQuery {
  query: string;
  count: number;
}
interface Search {
  totalQueries: number;
  zeroResultQueries: number;
  zeroResultRate: number;
  avgDurationMs: number;
  avgCitationCount: number;
  topQueries: TopQuery[];
  topZeroResultQueries: TopQuery[];
}

export function AnalyticsTabs({ usage, search }: { usage: Usage; search: Search }) {
  return (
    <Tabs defaultValue="usage">
      <TabsList>
        <TabsTrigger value="usage">Usage</TabsTrigger>
        <TabsTrigger value="ai">AI</TabsTrigger>
        <TabsTrigger value="search">Search</TabsTrigger>
      </TabsList>

      <TabsContent value="usage">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Tool executions" value={usage.metrics.toolExecutions} />
          <StatCard label="Workflow executions" value={usage.metrics.workflowExecutions} />
          <StatCard label="Notifications" value={usage.metrics.notifications} />
          <StatCard label="Embeddings" value={usage.metrics.embeddings} />
        </div>
      </TabsContent>

      <TabsContent value="ai">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="AI tokens" value={usage.metrics.aiTokens.toLocaleString()} description="Prompt + completion (30d)" />
          <StatCard label="API calls (metered)" value={usage.metrics.apiCalls} />
          <StatCard label="Storage" value={`${(usage.metrics.storageBytes / 1_048_576).toFixed(1)} MB`} />
        </div>
      </TabsContent>

      <TabsContent value="search">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Queries" value={search.totalQueries} />
          <StatCard label="Zero-result rate" value={`${(search.zeroResultRate * 100).toFixed(0)}%`} />
          <StatCard label="Avg latency" value={`${search.avgDurationMs} ms`} />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top queries</CardTitle>
            </CardHeader>
            <CardContent>
              <HBarList
                data={search.topQueries.map((item) => ({ label: item.query, value: item.count }))}
                emptyMessage="No searches recorded yet."
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top zero-result queries</CardTitle>
            </CardHeader>
            <CardContent>
              <HBarList
                data={search.topZeroResultQueries.map((item) => ({ label: item.query, value: item.count }))}
                emptyMessage="No zero-result searches."
              />
            </CardContent>
          </Card>
        </div>
      </TabsContent>
    </Tabs>
  );
}
