import { requireRole } from '@bond-os/auth';
import {
  createDocument as createDocumentRow,
  deleteDocument as deleteDocumentRow,
  getDocumentById,
  listDocuments,
  prisma,
  updateDocument as updateDocumentRow,
  type DocumentDetail,
  type DocumentListItem,
} from '@bond-os/database';
import {
  NotFoundError,
  ROLES,
  type CreateDocumentMetadataInput,
  type DocumentQuery,
  type PaginatedResult,
  type UpdateDocumentInput,
} from '@bond-os/shared';

import { uploadPublicFile } from '@/lib/supabase';

/** Dynamically imported, not statically — see the note in `apps/web/features/tasks/services/task.service.ts`; kept consistent across every curated `publishEvent()` call site. */
async function getPublishEvent() {
  const { publishEvent } = await import('@/features/workflows/services/event-bus.service');
  return publishEvent;
}

export async function listDocumentsService(
  organizationId: string,
  query: DocumentQuery,
): Promise<PaginatedResult<DocumentListItem>> {
  await requireRole(organizationId, ROLES.MEMBER);
  return listDocuments({ organizationId, ...query });
}

export async function getDocumentService(organizationId: string, id: string): Promise<DocumentDetail> {
  await requireRole(organizationId, ROLES.MEMBER);
  const document = await getDocumentById(id, organizationId);
  if (!document) throw new NotFoundError('Document not found.');
  return document;
}

async function assertProjectInOrg(organizationId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId } });
  if (!project) throw new NotFoundError('Project not found.');
}

async function assertMeetingInOrg(organizationId: string, meetingId: string) {
  const meeting = await prisma.meeting.findFirst({ where: { id: meetingId, organizationId } });
  if (!meeting) throw new NotFoundError('Meeting not found.');
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot) : '';
}

export async function createDocumentService(
  organizationId: string,
  userId: string,
  metadata: CreateDocumentMetadataInput,
  file: Blob & { name: string; type: string; size: number },
): Promise<DocumentDetail> {
  await requireRole(organizationId, ROLES.MEMBER);
  if (metadata.projectId) await assertProjectInOrg(organizationId, metadata.projectId);
  if (metadata.meetingId) await assertMeetingInOrg(organizationId, metadata.meetingId);

  const filename = `${crypto.randomUUID()}${extensionOf(file.name)}`;
  const uploaded = await uploadPublicFile('documents', filename, file);

  const created = await createDocumentRow({
    organizationId,
    title: metadata.title,
    description: metadata.description,
    type: metadata.type,
    fileName: file.name,
    mimeType: file.type,
    size: file.size,
    storagePath: uploaded.path,
    projectId: metadata.projectId,
    meetingId: metadata.meetingId,
    uploadedById: userId,
    taskIds: metadata.taskIds,
  });

  const publishEvent = await getPublishEvent();
  await publishEvent({
    organizationId,
    eventType: 'document.uploaded',
    source: 'DOCUMENT',
    payload: { documentId: created.id, title: created.title, projectId: created.project?.id ?? null },
    entityType: 'DOCUMENT',
    entityId: created.id,
  });

  return created;
}

export async function updateDocumentService(
  organizationId: string,
  id: string,
  input: UpdateDocumentInput,
): Promise<DocumentDetail> {
  await requireRole(organizationId, ROLES.MEMBER);
  if (input.projectId) await assertProjectInOrg(organizationId, input.projectId);
  if (input.meetingId) await assertMeetingInOrg(organizationId, input.meetingId);

  const updated = await updateDocumentRow(id, organizationId, input);
  if (!updated) throw new NotFoundError('Document not found.');
  return updated;
}

export async function deleteDocumentService(organizationId: string, id: string): Promise<void> {
  await requireRole(organizationId, ROLES.ADMIN);
  const deleted = await deleteDocumentRow(id, organizationId);
  if (!deleted) throw new NotFoundError('Document not found.');
}
