import { requireRole } from '@bond-os/auth';
import {
  createKnowledgeDocument as createKnowledgeDocumentRow,
  deleteKnowledgeDocument as deleteKnowledgeDocumentRow,
  getKnowledgeDocumentById,
  listChunks,
  listKnowledgeDocuments,
  prisma,
  replaceChunks,
  updateKnowledgeDocument as updateKnowledgeDocumentRow,
  updateParseResult,
  type KnowledgeDocumentDetail,
  type KnowledgeDocumentListItem,
} from '@bond-os/database';
import { chunkText, defaultParserRegistry } from '@bond-os/parsers';
import {
  NotFoundError,
  ROLES,
  ValidationError,
  type CreateKnowledgeDocumentMetadataInput,
  type KnowledgeDocumentQuery,
  type PaginatedResult,
  type UpdateKnowledgeDocumentInput,
} from '@bond-os/shared';
import { getQueue, getVirusScanner, logger } from '@bond-os/shared/server';

import { embedDocumentChunks } from '@/features/embeddings/services/embedding-pipeline.service';
import { runSmartLinkingForDocument } from '@/features/graph/services/extraction-pipeline.service';
import { deletePublicFile, uploadPublicFile } from '@/lib/supabase';

const log = logger.child('library');

const MAX_FILE_SIZE = 25 * 1024 * 1024;

/** Matches the spec's "Supported formats: PDF, DOCX, TXT, Markdown, Images, CSV" for storage — parsing support is narrower (no OCR for images). */
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/csv',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot) : '';
}

export async function listKnowledgeDocumentsService(
  organizationId: string,
  query: KnowledgeDocumentQuery,
): Promise<PaginatedResult<KnowledgeDocumentListItem>> {
  await requireRole(organizationId, ROLES.MEMBER);
  return listKnowledgeDocuments({ organizationId, ...query });
}

export async function getKnowledgeDocumentService(
  organizationId: string,
  id: string,
): Promise<KnowledgeDocumentDetail> {
  await requireRole(organizationId, ROLES.MEMBER);
  const doc = await getKnowledgeDocumentById(id, organizationId);
  if (!doc) throw new NotFoundError('Document not found.');
  return doc;
}

async function assertFolderInOrg(organizationId: string, folderId: string) {
  const folder = await prisma.folder.findFirst({ where: { id: folderId, organizationId } });
  if (!folder) throw new NotFoundError('Folder not found.');
}

/** Every tagId must belong to the caller's org — without this, `updateKnowledgeDocumentRow` would attach (and later expose, via GET) any organization's tag id supplied by the caller. */
async function assertTagsInOrg(organizationId: string, tagIds: string[]) {
  if (tagIds.length === 0) return;
  const count = await prisma.tag.count({ where: { id: { in: tagIds }, organizationId } });
  if (count !== new Set(tagIds).size) throw new NotFoundError('One or more tags were not found.');
}

/**
 * Uploads, persists, and — synchronously, since there's no background
 * worker in this phase — parses and chunks the file, all within one
 * request. `getQueue().enqueue(...)` is also called to demonstrate the
 * queue architecture even though nothing consumes it yet.
 */
export async function createKnowledgeDocumentService(
  organizationId: string,
  userId: string,
  metadata: CreateKnowledgeDocumentMetadataInput,
  file: Blob & { name: string; type: string; size: number },
): Promise<KnowledgeDocumentDetail> {
  await requireRole(organizationId, ROLES.MEMBER);

  if (file.size > MAX_FILE_SIZE) {
    throw new ValidationError('File must be smaller than 25MB.');
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new ValidationError(`Unsupported file type: ${file.type || 'unknown'}.`);
  }
  if (metadata.folderId) {
    await assertFolderInOrg(organizationId, metadata.folderId);
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const scan = await getVirusScanner().scan(buffer, file.name);
  if (!scan.clean) {
    throw new ValidationError(`File failed the security scan: ${scan.reason ?? 'unknown reason'}.`);
  }

  const storageFilename = `${crypto.randomUUID()}${extensionOf(file.name)}`;
  const uploaded = await uploadPublicFile('knowledge', storageFilename, file);

  const created = await createKnowledgeDocumentRow({
    organizationId,
    creatorId: userId,
    entityType: metadata.entityType,
    title: metadata.title,
    description: metadata.description,
    fileName: file.name,
    mimeType: file.type,
    size: file.size,
    storagePath: uploaded.path,
    folderId: metadata.folderId,
    uploadedById: userId,
  });

  await getQueue().enqueue('parse-knowledge-document', { knowledgeDocumentId: created.id });

  const { publishEvent } = await import('@/features/workflows/services/event-bus.service');
  await publishEvent({
    organizationId,
    eventType: 'document.uploaded',
    source: 'KNOWLEDGE_GRAPH',
    payload: { knowledgeDocumentId: created.id, title: created.title, entityId: created.entityId },
    entityType: 'KNOWLEDGE_DOCUMENT',
    entityId: created.id,
  });

  return parseAndChunk(created.id, created.entityId, organizationId, userId, buffer, file.name, file.type);
}

async function parseAndChunk(
  id: string,
  entityId: string,
  organizationId: string,
  userId: string,
  buffer: Buffer,
  fileName: string,
  mimeType: string,
): Promise<KnowledgeDocumentDetail> {
  const parser = defaultParserRegistry.find(mimeType, fileName);

  if (!parser) {
    await updateParseResult(id, organizationId, { status: 'UNSUPPORTED' });
  } else {
    try {
      const result = await parser.parse(buffer, fileName);
      await updateParseResult(id, organizationId, {
        status: 'PARSED',
        text: result.text,
        pages: result.pages,
        metadata: result.metadata,
      });

      const chunks = chunkText(result.text);
      await replaceChunks(id, organizationId, chunks);

      // Phase 3 "Smart Linking" — extraction/resolution/relationship-detection
      // over the freshly parsed text. Never allowed to break the upload.
      try {
        await runSmartLinkingForDocument({ documentEntityId: entityId, organizationId, userId, text: result.text });
      } catch (error) {
        log.error('Smart linking failed', {
          id,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      // Phase 4 embedding pipeline — generate + store one embedding per
      // chunk. Never allowed to break the upload, same as Smart Linking.
      try {
        const storedChunks = await listChunks(id, organizationId);
        await embedDocumentChunks({
          organizationId,
          documentEntityId: entityId,
          chunks: storedChunks.map((chunk) => ({ id: chunk.id, content: chunk.content })),
        });
      } catch (error) {
        log.error('Embedding generation failed', {
          id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } catch (error) {
      log.error('Failed to parse knowledge document', {
        id,
        message: error instanceof Error ? error.message : String(error),
      });
      await updateParseResult(id, organizationId, { status: 'FAILED' });
    }
  }

  const detail = await getKnowledgeDocumentById(id, organizationId);
  if (!detail) throw new Error('Failed to load knowledge document after parsing.');
  return detail;
}

export async function updateKnowledgeDocumentService(
  organizationId: string,
  id: string,
  input: UpdateKnowledgeDocumentInput,
): Promise<KnowledgeDocumentDetail> {
  await requireRole(organizationId, ROLES.MEMBER);
  if (input.folderId) {
    await assertFolderInOrg(organizationId, input.folderId);
  }
  if (input.tagIds) {
    await assertTagsInOrg(organizationId, input.tagIds);
  }
  const updated = await updateKnowledgeDocumentRow(id, organizationId, input);
  if (!updated) throw new NotFoundError('Document not found.');
  return updated;
}

export async function deleteKnowledgeDocumentService(organizationId: string, id: string): Promise<void> {
  await requireRole(organizationId, ROLES.ADMIN);
  const result = await deleteKnowledgeDocumentRow(id, organizationId);
  if (!result.deleted) throw new NotFoundError('Document not found.');
  if (result.storagePath) {
    await deletePublicFile(result.storagePath);
  }
}
