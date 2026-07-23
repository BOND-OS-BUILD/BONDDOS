import { requireRole } from '@bond-os/auth';
import {
  createProject,
  createTemplate,
  createWorkflowDefinition,
  deleteTemplate,
  getTemplateById,
  getWorkflowDefinitionById,
  listVisibleTemplates,
  updateTemplate,
  type Prisma,
  type TemplateRecord,
} from '@bond-os/database';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ROLES,
  ValidationError,
  type CreateTemplateInput,
  type TemplateTypeName,
  type UpdateTemplateInput,
  type UseTemplateInput,
} from '@bond-os/shared';

import { requireActiveOrganizationId } from '@/lib/organization';

/**
 * Phase 11 — template marketplace + import/export. Creating/exporting templates
 * is ADMIN; browsing and using (importing) them is MEMBER. "Using" a template
 * instantiates a live resource where that is safe and well-defined (workflows
 * become DRAFT definitions, projects become projects); other types return their
 * content for the client to apply. Exported templates are JSON — the same shape
 * accepted by create, so export/import round-trips.
 */

export interface TemplateView {
  id: string;
  key: string;
  type: TemplateTypeName;
  name: string;
  description: string | null;
  author: string | null;
  version: string;
  isPublic: boolean;
  isOwn: boolean;
  createdAt: string;
}

export interface TemplateDetail extends TemplateView {
  content: unknown;
}

function toView(record: TemplateRecord, organizationId: string): TemplateView {
  return {
    id: record.id,
    key: record.key,
    type: record.type,
    name: record.name,
    description: record.description,
    author: record.author,
    version: record.version,
    isPublic: record.isPublic,
    isOwn: record.organizationId === organizationId,
    createdAt: record.createdAt.toISOString(),
  };
}

async function requireAdminOrg(): Promise<string> {
  const organizationId = await requireActiveOrganizationId();
  await requireRole(organizationId, ROLES.ADMIN);
  return organizationId;
}

async function requireMemberOrg(): Promise<{ organizationId: string; userId: string }> {
  const organizationId = await requireActiveOrganizationId();
  const { session } = await requireRole(organizationId, ROLES.MEMBER);
  return { organizationId, userId: session.user.id };
}

export async function listTemplatesService(type?: TemplateTypeName): Promise<TemplateView[]> {
  const { organizationId } = await requireMemberOrg();
  const records = await listVisibleTemplates(organizationId, type);
  return records.map((record) => toView(record, organizationId));
}

/** A template is visible if it belongs to the caller's org or is public. */
async function loadVisible(id: string, organizationId: string): Promise<TemplateRecord> {
  const record = await getTemplateById(id);
  if (!record || (record.organizationId !== organizationId && !record.isPublic)) {
    throw new NotFoundError('Template not found.');
  }
  return record;
}

export async function getTemplateService(id: string): Promise<TemplateDetail> {
  const { organizationId } = await requireMemberOrg();
  const record = await loadVisible(id, organizationId);
  return { ...toView(record, organizationId), content: record.content };
}

export async function createTemplateService(input: CreateTemplateInput): Promise<TemplateDetail> {
  const organizationId = await requireAdminOrg();
  const existing = (await listVisibleTemplates(organizationId, input.type)).find(
    (template) => template.organizationId === organizationId && template.key === input.key,
  );
  if (existing) throw new ConflictError(`A ${input.type} template with key "${input.key}" already exists.`);

  const record = await createTemplate({
    organizationId,
    type: input.type,
    key: input.key,
    name: input.name,
    description: input.description ?? null,
    content: (input.content ?? {}) as Prisma.InputJsonValue,
    isPublic: input.isPublic,
    version: input.version,
  });
  return { ...toView(record, organizationId), content: record.content };
}

export async function updateTemplateService(id: string, input: UpdateTemplateInput): Promise<TemplateDetail> {
  const organizationId = await requireAdminOrg();
  const record = await getTemplateById(id);
  if (!record || record.organizationId !== organizationId) throw new NotFoundError('Template not found.');
  const updated = await updateTemplate(id, {
    name: input.name,
    description: input.description ?? undefined,
    content: input.content === undefined ? undefined : ((input.content ?? {}) as Prisma.InputJsonValue),
    isPublic: input.isPublic,
  });
  return { ...toView(updated, organizationId), content: updated.content };
}

export async function deleteTemplateService(id: string): Promise<void> {
  const organizationId = await requireAdminOrg();
  const record = await getTemplateById(id);
  if (!record || record.organizationId !== organizationId) throw new NotFoundError('Template not found.');
  await deleteTemplate(id);
}

// ── Use (import/instantiate) ───────────────────────────────────────────────

export interface UseTemplateResult {
  type: TemplateTypeName;
  /** Set when the template was instantiated into a live resource. */
  createdId: string | null;
  createdKind: 'workflow' | 'project' | null;
  /** For types that aren't auto-instantiated, the content to apply client-side. */
  content: unknown;
}

export async function useTemplateService(id: string, input: UseTemplateInput): Promise<UseTemplateResult> {
  const { organizationId, userId } = await requireMemberOrg();
  const record = await loadVisible(id, organizationId);
  const content = (record.content ?? {}) as Record<string, unknown>;

  if (record.type === 'WORKFLOW') {
    const createdId = await instantiateWorkflow(organizationId, userId, record, content, input.name);
    return { type: 'WORKFLOW', createdId, createdKind: 'workflow', content: null };
  }
  if (record.type === 'PROJECT') {
    const createdId = await instantiateProject(organizationId, userId, content, input.name ?? record.name);
    return { type: 'PROJECT', createdId, createdKind: 'project', content: null };
  }
  // AI_PROMPT / DOCUMENT / KNOWLEDGE_GRAPH_VIEW / DASHBOARD — return content.
  return { type: record.type, createdId: null, createdKind: null, content: record.content };
}

async function instantiateWorkflow(
  organizationId: string,
  userId: string,
  record: TemplateRecord,
  content: Record<string, unknown>,
  overrideName?: string,
): Promise<string> {
  if (!content.graph || !content.triggerType || !content.trigger) {
    throw new ValidationError('This workflow template is missing a graph, trigger type, or trigger.');
  }
  try {
    const created = await createWorkflowDefinition({
      organizationId,
      workflowKey: `${record.key}_${Date.now().toString(36)}`,
      version: '1.0.0',
      name: overrideName ?? record.name,
      description: typeof content.description === 'string' ? content.description : record.description ?? '',
      ownerId: userId,
      triggerType: content.triggerType as never,
      trigger: content.trigger as Prisma.InputJsonValue,
      conditions: content.conditions as Prisma.InputJsonValue | undefined,
      graph: content.graph as Prisma.InputJsonValue,
      retryPolicy: content.retryPolicy as Prisma.InputJsonValue | undefined,
      timeoutMs: typeof content.timeoutMs === 'number' ? content.timeoutMs : null,
      rollbackPolicy: content.rollbackPolicy as Prisma.InputJsonValue | undefined,
    });
    return created.id;
  } catch {
    throw new ValidationError('This workflow template could not be instantiated — its content is invalid.');
  }
}

async function instantiateProject(
  organizationId: string,
  userId: string,
  content: Record<string, unknown>,
  name: string,
): Promise<string> {
  const project = await createProject({
    organizationId,
    title: typeof content.title === 'string' ? content.title : name,
    description: typeof content.description === 'string' ? content.description : null,
    status: 'PLANNING',
    priority: 'MEDIUM',
    ownerId: userId,
    memberIds: [userId],
  });
  return project.id;
}

// ── Export ─────────────────────────────────────────────────────────────────

/** Package an existing workflow definition into a reusable WORKFLOW template. */
export async function exportWorkflowAsTemplateService(
  workflowId: string,
  options: { name?: string; isPublic?: boolean },
): Promise<TemplateDetail> {
  const organizationId = await requireAdminOrg();
  const workflow = await getWorkflowDefinitionById(workflowId, organizationId);
  if (!workflow) throw new NotFoundError('Workflow not found.');

  const content = {
    description: workflow.description,
    triggerType: workflow.triggerType,
    trigger: workflow.trigger,
    conditions: workflow.conditions,
    graph: workflow.graph,
    retryPolicy: workflow.retryPolicy,
    timeoutMs: workflow.timeoutMs,
    rollbackPolicy: workflow.rollbackPolicy,
  };
  const record = await createTemplate({
    organizationId,
    type: 'WORKFLOW',
    key: `${workflow.workflowKey}_tpl_${Date.now().toString(36)}`,
    name: options.name ?? `${workflow.name} template`,
    description: workflow.description,
    content: content as Prisma.InputJsonValue,
    isPublic: options.isPublic ?? false,
    author: null,
  });
  return { ...toView(record, organizationId), content: record.content };
}

/** Guard used by routes that only make sense for org admins (kept for symmetry). */
export function assertTemplateType(value: string): asserts value is TemplateTypeName {
  const valid = ['WORKFLOW', 'AI_PROMPT', 'PROJECT', 'DOCUMENT', 'KNOWLEDGE_GRAPH_VIEW', 'DASHBOARD'];
  if (!valid.includes(value)) throw new ForbiddenError('Unknown template type.');
}
