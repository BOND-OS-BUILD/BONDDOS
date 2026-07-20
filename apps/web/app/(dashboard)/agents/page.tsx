import Link from 'next/link';
import { redirect } from 'next/navigation';

import { requireAuth } from '@bond-os/auth';
import { ROLES, ROUTES, roleSatisfies } from '@bond-os/shared';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from '@bond-os/ui';
import {
  Bot,
  FolderKanban,
  Handshake,
  Landmark,
  type LucideIcon,
  Network,
  Settings,
  UsersRound,
} from 'lucide-react';

import { listAgentsService, type AvailableAgent } from '@/features/agents/services/agent-discovery.service';
import { getActiveOrganization } from '@/lib/organization';

/**
 * Phase 7 "Multi-Agent Architecture" — the Agents directory: one card per
 * registered agent (Coordinator included), linking to its detail page
 * (`/agents/[agentKey]`). Same list-page-with-cards convention as
 * `execution/page.tsx`'s table (`requireAuth` + `getActiveOrganization` +
 * redirect-if-no-active-org, then a role gate before the data fetch —
 * `listAgentsService` itself also enforces `requireRole`, so this gate is
 * purely to render a friendlier fallback than a thrown `ForbiddenError`).
 */

const AVATAR_ICON: Record<string, LucideIcon> = {
  Bot,
  FolderKanban,
  Handshake,
  Settings,
  Network,
  Landmark,
};

function AgentCard({ agent }: { agent: AvailableAgent }) {
  const Icon = AVATAR_ICON[agent.avatar] ?? Bot;
  const extraCapabilityCount = Math.max(agent.capabilities.length - 4, 0);

  return (
    <Link href={`${ROUTES.agents}/${agent.agentKey}`} className="block h-full">
      <Card className="h-full transition-colors hover:border-primary/50">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent">
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <CardTitle className="truncate text-base">{agent.displayName}</CardTitle>
              <Badge variant="secondary" className="mt-1.5 font-normal">
                {agent.category}
              </Badge>
            </div>
          </div>
          <CardDescription className="line-clamp-3">{agent.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5">
            {agent.capabilities.slice(0, 4).map((capability) => (
              <Badge key={capability} variant="outline" className="font-normal">
                {capability}
              </Badge>
            ))}
            {extraCapabilityCount > 0 ? (
              <Badge variant="outline" className="font-normal">
                +{extraCapabilityCount} more
              </Badge>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default async function AgentsPage() {
  const session = await requireAuth();
  const { active } = await getActiveOrganization(session.user.id);

  if (!active) {
    redirect(ROUTES.dashboard);
  }

  const canView = roleSatisfies(active.role, ROLES.MEMBER);

  if (!canView) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Agents</CardTitle>
          <CardDescription>Organization members can view the agent directory.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const agents = await listAgentsService(active.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
        <p className="text-sm text-muted-foreground">
          The specialist agents behind Mr. Bond — each focused on one part of your workspace. Mr. Bond (the
          Coordinator) routes and delegates across them automatically, or you can talk to one directly.
        </p>
      </div>

      {agents.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="No agents registered"
          description="No agents are currently registered for this organization."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard key={agent.agentKey} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}
