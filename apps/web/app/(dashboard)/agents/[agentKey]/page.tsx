import { redirect } from 'next/navigation';

import { requireAuth } from '@bond-os/auth';
import { ROLES, ROUTES, roleSatisfies } from '@bond-os/shared';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from '@bond-os/ui';
import { Bot, FolderKanban, Handshake, Landmark, type LucideIcon, Network, Settings, UserSearch } from 'lucide-react';

import { StartAgentChatButton } from '@/features/agents/components/start-agent-chat-button';
import { getAgentService } from '@/features/agents/services/agent-discovery.service';
import { getActiveOrganization } from '@/lib/organization';

/**
 * Agent detail page — the full `AgentDescriptor` (spec fields: description,
 * capabilities, supportedTools, supportedKnowledge, minimumRole) in a Card,
 * same server-component conventions as `bond/[conversationId]/page.tsx` and
 * `execution/page.tsx`'s role gate. Read-only: it doesn't mount a chat
 * inline itself, since the chat experience needs a `Conversation` row to
 * exist first (same as Bond's own `/bond` -> `/bond/[conversationId]` two
 * step flow) — `StartAgentChatButton` creates one and navigates to
 * `/agents/[agentKey]/[conversationId]`, a client route where
 * `AgentChatThread` actually mounts, pinned to this agent.
 */

const AVATAR_ICON: Record<string, LucideIcon> = {
  Bot,
  FolderKanban,
  Handshake,
  Settings,
  Network,
  Landmark,
};

export default async function AgentDetailPage({ params }: { params: Promise<{ agentKey: string }> }) {
  const { agentKey } = await params;
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
          <CardTitle>Agent</CardTitle>
          <CardDescription>Organization members can view agent details.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const agent = await getAgentService(active.id, agentKey);

  if (!agent) {
    return (
      <EmptyState
        icon={UserSearch}
        title="Agent not found"
        description={`No agent is registered with the key "${agentKey}" in this workspace.`}
        className="min-h-[60vh]"
      />
    );
  }

  const Icon = AVATAR_ICON[agent.avatar] ?? Bot;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-accent">
            <Icon className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{agent.displayName}</h1>
            <p className="text-sm text-muted-foreground">
              {agent.category} · v{agent.version} · minimum role {agent.minimumRole}
            </p>
          </div>
        </div>
        <StartAgentChatButton agentKey={agent.agentKey} agentDisplayName={agent.displayName} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">About</CardTitle>
          <CardDescription>{agent.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Capabilities</p>
            {agent.capabilities.length === 0 ? (
              <p className="text-sm text-muted-foreground">None declared.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {agent.capabilities.map((capability) => (
                  <Badge key={capability} variant="secondary" className="font-normal">
                    {capability}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Tools</p>
            {agent.supportedTools.length === 0 ? (
              <p className="text-sm text-muted-foreground">None declared.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {agent.supportedTools.map((tool) => (
                  <Badge key={tool} variant="outline" className="font-normal">
                    {tool}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Knowledge sources</p>
            {agent.supportedKnowledge.length === 0 ? (
              <p className="text-sm text-muted-foreground">None declared.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {agent.supportedKnowledge.map((source) => (
                  <Badge key={source} variant="outline" className="font-normal">
                    {source}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
