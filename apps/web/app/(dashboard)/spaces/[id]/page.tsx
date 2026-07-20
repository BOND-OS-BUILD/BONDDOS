import { notFound } from 'next/navigation';
import Link from 'next/link';

import { requireAuth } from '@bond-os/auth';
import { getKnowledgeDocumentById, getProjectById, getWorkflowDefinitionById } from '@bond-os/database';
import { ROLES, roleSatisfies } from '@bond-os/shared';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@bond-os/ui';
import { FileText, LayoutGrid, Workflow as WorkflowIcon } from 'lucide-react';

import { getAgentRegistryService } from '@/features/agents/lib/container';
import { listKnowledgeDocumentsService } from '@/features/library/services/library.service';
import { listProjectsService } from '@/features/projects/services/project.service';
import { JoinLeaveButton } from '@/features/spaces/components/join-leave-button';
import { LinkContentForm } from '@/features/spaces/components/link-content-form';
import { SpaceDeleteButton } from '@/features/spaces/components/space-delete-button';
import { SpaceFormDialog } from '@/features/spaces/components/space-form-dialog';
import { UnlinkButton } from '@/features/spaces/components/unlink-button';
import { getSpaceService } from '@/features/spaces/services/space.service';
import { getWorkflowDefinitionService } from '@/features/workflows/lib/container';
import { requireActiveOrganizationId, getActiveOrganization } from '@/lib/organization';

interface ResolvedEntry<T> {
  id: string;
  item: T;
}

async function resolveTitles<T>(ids: string[], resolve: (id: string) => Promise<T | null>): Promise<Array<ResolvedEntry<T>>> {
  const resolved = await Promise.all(ids.map(async (id) => ({ id, item: await resolve(id) })));
  const entries: Array<ResolvedEntry<T>> = [];
  for (const entry of resolved) {
    if (entry.item !== null) entries.push({ id: entry.id, item: entry.item });
  }
  return entries;
}

export default async function SpaceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const { active } = await getActiveOrganization(user.id);

  const space = await getSpaceService(organizationId, id);
  if (!space) notFound();

  const isMember = space.members.some((member) => member.user.id === user.id);
  const isManager = space.createdBy?.id === user.id || (active ? roleSatisfies(active.role, ROLES.ADMIN) : false);

  const [projects, documents, workflows] = await Promise.all([
    resolveTitles(space.projectIds, (projectId) => getProjectById(projectId, organizationId)),
    resolveTitles(space.knowledgeDocumentIds, (docId) => getKnowledgeDocumentById(docId, organizationId)),
    resolveTitles(space.workflowDefinitionIds, (workflowId) => getWorkflowDefinitionById(workflowId, organizationId)),
  ]);
  const agentRegistry = getAgentRegistryService();
  const agents = space.agentKeys
    .map((agentKey) => ({ agentKey, definition: agentRegistry.get(agentKey) }))
    .filter((entry): entry is { agentKey: string; definition: NonNullable<ReturnType<typeof agentRegistry.get>> } => Boolean(entry.definition));

  let linkOptions: {
    projects: Array<{ value: string; label: string }>;
    documents: Array<{ value: string; label: string }>;
    workflows: Array<{ value: string; label: string }>;
    agents: Array<{ value: string; label: string }>;
  } = { projects: [], documents: [], workflows: [], agents: [] };

  if (isManager) {
    const [allProjects, allDocuments, allWorkflows] = await Promise.all([
      listProjectsService(organizationId, { page: 1, pageSize: 200, sortBy: 'title', sortDir: 'asc' }),
      listKnowledgeDocumentsService(organizationId, { page: 1, pageSize: 200, sortBy: 'title', sortDir: 'asc' }),
      getWorkflowDefinitionService().list({ organizationId, page: 1, pageSize: 200 }),
    ]);
    linkOptions = {
      projects: allProjects.items
        .filter((project) => !space.projectIds.includes(project.id))
        .map((project) => ({ value: project.id, label: project.title })),
      documents: allDocuments.items
        .filter((doc) => !space.knowledgeDocumentIds.includes(doc.id))
        .map((doc) => ({ value: doc.id, label: doc.title })),
      workflows: allWorkflows.items
        .filter((workflow) => !space.workflowDefinitionIds.includes(workflow.id))
        .map((workflow) => ({ value: workflow.id, label: workflow.name })),
      agents: agentRegistry
        .list()
        .filter((agent) => !space.agentKeys.includes(agent.descriptor.agentKey))
        .map((agent) => ({ value: agent.descriptor.agentKey, label: agent.descriptor.displayName })),
    };
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{space.name}</h1>
          {space.description && <p className="text-sm text-muted-foreground">{space.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          <JoinLeaveButton spaceId={space.id} isMember={isMember} userId={user.id} />
          {isManager && (
            <>
              <SpaceFormDialog
                space={space}
                trigger={
                  <button type="button" className="text-sm text-muted-foreground underline-offset-2 hover:underline">
                    Edit
                  </button>
                }
              />
              <SpaceDeleteButton id={space.id} name={space.name} />
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members ({space.memberCount})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {space.members.map((member) => (
            <Badge key={member.user.id} variant="secondary">
              {member.user.name}
            </Badge>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LayoutGrid className="h-4 w-4" /> Projects
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {projects.length === 0 && <p className="text-xs text-muted-foreground">No projects linked.</p>}
            {projects.map(({ id: projectId, item }) => (
              <div key={projectId} className="flex items-center justify-between gap-2">
                <Link href={`/projects/${projectId}`} className="truncate text-sm hover:underline">
                  {item.title}
                </Link>
                {isManager && <UnlinkButton url={`/api/spaces/${space.id}/projects/${projectId}`} />}
              </div>
            ))}
            {isManager && (
              <LinkContentForm
                spaceId={space.id}
                resource="projects"
                fieldName="projectId"
                options={linkOptions.projects}
                placeholder="Link a project…"
                emptyMessage="No more projects to link."
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" /> Documents
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {documents.length === 0 && <p className="text-xs text-muted-foreground">No documents linked.</p>}
            {documents.map(({ id: docId, item }) => (
              <div key={docId} className="flex items-center justify-between gap-2">
                <span className="truncate text-sm">{item.title}</span>
                {isManager && <UnlinkButton url={`/api/spaces/${space.id}/knowledge-documents/${docId}`} />}
              </div>
            ))}
            {isManager && (
              <LinkContentForm
                spaceId={space.id}
                resource="knowledge-documents"
                fieldName="knowledgeDocumentId"
                options={linkOptions.documents}
                placeholder="Link a document…"
                emptyMessage="No more documents to link."
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <WorkflowIcon className="h-4 w-4" /> Workflows
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {workflows.length === 0 && <p className="text-xs text-muted-foreground">No workflows linked.</p>}
            {workflows.map(({ id: workflowId, item }) => (
              <div key={workflowId} className="flex items-center justify-between gap-2">
                <span className="truncate text-sm">{item.name}</span>
                {isManager && <UnlinkButton url={`/api/spaces/${space.id}/workflows/${workflowId}`} />}
              </div>
            ))}
            {isManager && (
              <LinkContentForm
                spaceId={space.id}
                resource="workflows"
                fieldName="workflowDefinitionId"
                options={linkOptions.workflows}
                placeholder="Link a workflow…"
                emptyMessage="No more workflows to link."
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Agents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {agents.length === 0 && <p className="text-xs text-muted-foreground">No agents linked.</p>}
          <div className="flex flex-wrap gap-2">
            {agents.map(({ agentKey, definition }) => (
              <div key={agentKey} className="flex items-center gap-1 rounded-full border border-input px-2.5 py-0.5 text-xs">
                {definition.descriptor.displayName}
                {isManager && <UnlinkButton url={`/api/spaces/${space.id}/agents/${agentKey}`} />}
              </div>
            ))}
          </div>
          {isManager && (
            <LinkContentForm
              spaceId={space.id}
              resource="agents"
              fieldName="agentKey"
              options={linkOptions.agents}
              placeholder="Link an agent…"
              emptyMessage="No more agents to link."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
