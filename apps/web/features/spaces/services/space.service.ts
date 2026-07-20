import { requireRole } from '@bond-os/auth';
import {
  addAgentToSpace,
  addKnowledgeDocumentToSpace,
  addProjectToSpace,
  addSpaceMember,
  addWorkflowToSpace,
  createSpace as createSpaceRow,
  deleteSpace as deleteSpaceRow,
  getKnowledgeDocumentById,
  getProjectById,
  getSpaceById,
  getWorkflowDefinitionById,
  listSpaces,
  removeAgentFromSpace,
  removeKnowledgeDocumentFromSpace,
  removeProjectFromSpace,
  removeSpaceMember,
  removeWorkflowFromSpace,
  updateSpace as updateSpaceRow,
  type SpaceData,
  type SpaceDetail,
} from '@bond-os/database';
import {
  ForbiddenError,
  NotFoundError,
  ROLES,
  roleSatisfies,
  ValidationError,
  type CreateSpaceInput,
  type PaginatedResult,
  type Role,
  type UpdateSpaceInput,
} from '@bond-os/shared';

/**
 * Team Spaces (Phase 9) — curation and grouping, NOT a parallel ACL. Every
 * read here is gated on organization role alone, exactly like every other
 * org-scoped read in this codebase; `SpaceMember` is never itself checked
 * as a content-visibility gate. See docs/spaces.md.
 */

async function getAgentRegistryService() {
  const { getAgentRegistryService } = await import('@/features/agents/lib/container');
  return getAgentRegistryService();
}

export async function listSpacesService(
  organizationId: string,
  callerId: string,
  page: number,
  pageSize: number,
  mineOnly?: boolean,
): Promise<PaginatedResult<SpaceData>> {
  await requireRole(organizationId, ROLES.MEMBER);
  return listSpaces({ organizationId, page, pageSize, memberUserId: mineOnly ? callerId : undefined });
}

export async function getSpaceService(organizationId: string, id: string): Promise<SpaceDetail> {
  await requireRole(organizationId, ROLES.MEMBER);
  const space = await getSpaceById(id, organizationId);
  if (!space) throw new NotFoundError('Space not found.');
  return space;
}

export async function createSpaceService(organizationId: string, callerId: string, input: CreateSpaceInput): Promise<SpaceDetail> {
  await requireRole(organizationId, ROLES.MEMBER);
  return createSpaceRow({ organizationId, name: input.name, description: input.description, createdById: callerId });
}

/** Rename/re-describe — the creator or an org ADMIN+, never a plain member (curation ownership, distinct from the org-role-only content-visibility rule above). */
async function assertCanManageSpace(callerId: string, callerRole: Role, space: SpaceDetail): Promise<void> {
  const isCreator = space.createdBy?.id === callerId;
  const isAdmin = roleSatisfies(callerRole, ROLES.ADMIN);
  if (!isCreator && !isAdmin) {
    throw new ForbiddenError('Only the space creator or an organization admin can manage this space.');
  }
}

export async function updateSpaceService(organizationId: string, callerId: string, id: string, input: UpdateSpaceInput): Promise<SpaceDetail> {
  const { membership } = await requireRole(organizationId, ROLES.MEMBER);
  const space = await getSpaceById(id, organizationId);
  if (!space) throw new NotFoundError('Space not found.');
  await assertCanManageSpace(callerId, membership.role, space);

  const updated = await updateSpaceRow(id, organizationId, input);
  if (!updated) throw new NotFoundError('Space not found.');
  return updated;
}

export async function deleteSpaceService(organizationId: string, callerId: string, id: string): Promise<void> {
  const { membership } = await requireRole(organizationId, ROLES.MEMBER);
  const space = await getSpaceById(id, organizationId);
  if (!space) throw new NotFoundError('Space not found.');
  await assertCanManageSpace(callerId, membership.role, space);

  const deleted = await deleteSpaceRow(id, organizationId);
  if (!deleted) throw new NotFoundError('Space not found.');
}

/** Joining is self-service — any org member can join any Space, matching "curation, not ACL." */
export async function joinSpaceService(organizationId: string, callerId: string, id: string): Promise<void> {
  await requireRole(organizationId, ROLES.MEMBER);
  const space = await getSpaceById(id, organizationId);
  if (!space) throw new NotFoundError('Space not found.');
  await addSpaceMember(id, callerId);
}

export async function leaveSpaceService(organizationId: string, callerId: string, id: string): Promise<void> {
  await requireRole(organizationId, ROLES.MEMBER);
  const removed = await removeSpaceMember(id, callerId);
  if (!removed) throw new NotFoundError('You are not a member of this space.');
}

export async function removeSpaceMemberService(organizationId: string, callerId: string, id: string, userId: string): Promise<void> {
  const { membership } = await requireRole(organizationId, ROLES.MEMBER);
  const space = await getSpaceById(id, organizationId);
  if (!space) throw new NotFoundError('Space not found.');
  if (userId !== callerId) {
    await assertCanManageSpace(callerId, membership.role, space);
  }
  const removed = await removeSpaceMember(id, userId);
  if (!removed) throw new NotFoundError('That user is not a member of this space.');
}

/** Despite the name, this checks MANAGE permission (creator or ADMIN+), not mere membership — content link/unlink is a management action, matching rename/delete, not something any space member can do. */
async function assertCanManageSpaceById(organizationId: string, callerId: string, callerRole: Role, spaceId: string): Promise<SpaceDetail> {
  const space = await getSpaceById(spaceId, organizationId);
  if (!space) throw new NotFoundError('Space not found.');
  await assertCanManageSpace(callerId, callerRole, space);
  return space;
}

export async function linkProjectToSpaceService(organizationId: string, callerId: string, spaceId: string, projectId: string): Promise<void> {
  const { membership } = await requireRole(organizationId, ROLES.MEMBER);
  await assertCanManageSpaceById(organizationId, callerId, membership.role, spaceId);
  if (!(await getProjectById(projectId, organizationId))) throw new ValidationError('Project not found in your organization.');
  await addProjectToSpace(spaceId, projectId);
}

export async function unlinkProjectFromSpaceService(organizationId: string, callerId: string, spaceId: string, projectId: string): Promise<void> {
  const { membership } = await requireRole(organizationId, ROLES.MEMBER);
  await assertCanManageSpaceById(organizationId, callerId, membership.role, spaceId);
  await removeProjectFromSpace(spaceId, projectId);
}

export async function linkKnowledgeDocumentToSpaceService(organizationId: string, callerId: string, spaceId: string, knowledgeDocumentId: string): Promise<void> {
  const { membership } = await requireRole(organizationId, ROLES.MEMBER);
  await assertCanManageSpaceById(organizationId, callerId, membership.role, spaceId);
  if (!(await getKnowledgeDocumentById(knowledgeDocumentId, organizationId))) throw new ValidationError('Knowledge document not found in your organization.');
  await addKnowledgeDocumentToSpace(spaceId, knowledgeDocumentId);
}

export async function unlinkKnowledgeDocumentFromSpaceService(organizationId: string, callerId: string, spaceId: string, knowledgeDocumentId: string): Promise<void> {
  const { membership } = await requireRole(organizationId, ROLES.MEMBER);
  await assertCanManageSpaceById(organizationId, callerId, membership.role, spaceId);
  await removeKnowledgeDocumentFromSpace(spaceId, knowledgeDocumentId);
}

export async function linkWorkflowToSpaceService(organizationId: string, callerId: string, spaceId: string, workflowDefinitionId: string): Promise<void> {
  const { membership } = await requireRole(organizationId, ROLES.MEMBER);
  await assertCanManageSpaceById(organizationId, callerId, membership.role, spaceId);
  if (!(await getWorkflowDefinitionById(workflowDefinitionId, organizationId))) throw new ValidationError('Workflow not found in your organization.');
  await addWorkflowToSpace(spaceId, workflowDefinitionId);
}

export async function unlinkWorkflowFromSpaceService(organizationId: string, callerId: string, spaceId: string, workflowDefinitionId: string): Promise<void> {
  const { membership } = await requireRole(organizationId, ROLES.MEMBER);
  await assertCanManageSpaceById(organizationId, callerId, membership.role, spaceId);
  await removeWorkflowFromSpace(spaceId, workflowDefinitionId);
}

export async function linkAgentToSpaceService(organizationId: string, callerId: string, spaceId: string, agentKey: string): Promise<void> {
  const { membership } = await requireRole(organizationId, ROLES.MEMBER);
  await assertCanManageSpaceById(organizationId, callerId, membership.role, spaceId);
  const registry = await getAgentRegistryService();
  if (!registry.get(agentKey)) throw new ValidationError(`Unknown agent: ${agentKey}`);
  await addAgentToSpace(spaceId, agentKey);
}

export async function unlinkAgentFromSpaceService(organizationId: string, callerId: string, spaceId: string, agentKey: string): Promise<void> {
  const { membership } = await requireRole(organizationId, ROLES.MEMBER);
  await assertCanManageSpaceById(organizationId, callerId, membership.role, spaceId);
  await removeAgentFromSpace(spaceId, agentKey);
}
