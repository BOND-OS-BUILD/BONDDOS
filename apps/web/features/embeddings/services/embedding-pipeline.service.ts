import { requireRole } from '@bond-os/auth';
import {
  appendTimelineEvent,
  completeEmbeddingJob,
  createEmbeddingJob,
  deleteAllEmbeddings,
  deleteEmbeddingsForSource,
  listEmbeddingJobs,
  listFailedEmbeddingJobs,
  logAiRequest,
  markEmbeddingJobRetrying,
  prisma,
  upsertEmbedding,
  type EmbeddingJobListFilters,
  type EmbeddingJobSummary,
  type EmbeddingSourceType,
} from '@bond-os/database';
import { NotFoundError, ROLES, type PaginatedResult } from '@bond-os/shared';
import { getQueue, logger } from '@bond-os/shared/server';

import { getEmbeddingModelLabel, getEmbeddingProvider } from './embedding-provider.service';

const log = logger.child('embedding-pipeline');
const EMBEDDING_VERSION = '1';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Resolves the embeddable text for a NOTE/EMAIL/MEETING source — the only
 * content each has, per the Phase 4 plan: NOTE has no dedicated table
 * (Phase 2), so its content is `Entity.description`; EMAIL is metadata-only
 * (Phase 1), so its content is `subject`; MEETING embeds `agenda` + `notes`.
 * CHUNK sources go through `embedDocumentChunks` instead — its content is
 * already in hand there, no lookup needed.
 */
async function resolveSourceContent(
  organizationId: string,
  sourceType: Exclude<EmbeddingSourceType, 'CHUNK'>,
  sourceId: string,
): Promise<string | null> {
  if (sourceType === 'NOTE') {
    const entity = await prisma.entity.findFirst({
      where: { id: sourceId, organizationId, entityType: 'NOTE' },
      select: { description: true },
    });
    return entity?.description?.trim() || null;
  }

  if (sourceType === 'EMAIL') {
    const email = await prisma.email.findFirst({ where: { id: sourceId, organizationId }, select: { subject: true } });
    return email?.subject?.trim() || null;
  }

  const meeting = await prisma.meeting.findFirst({
    where: { id: sourceId, organizationId },
    select: { agenda: true, notes: true },
  });
  if (!meeting) return null;
  return [meeting.agenda, meeting.notes].filter(Boolean).join('\n\n').trim() || null;
}

/** The actual embed-and-store step, shared by every entry point below — deliberately does NOT manage job lifecycle, so callers (which do) never end up with two job rows tracking one attempt. */
async function embedOneSource(
  organizationId: string,
  sourceType: EmbeddingSourceType,
  sourceId: string,
  content: string,
): Promise<void> {
  const provider = getEmbeddingProvider();
  const vector = await provider.generateEmbedding(content);

  if (vector.length !== provider.dimensions()) {
    throw new Error(`Embedding dimension mismatch: provider returned ${vector.length}, expected ${provider.dimensions()}.`);
  }

  await upsertEmbedding({
    organizationId,
    sourceType,
    sourceId,
    content,
    embeddingModel: getEmbeddingModelLabel(),
    embeddingVersion: EMBEDDING_VERSION,
    vector,
  });
}

export interface EmbedChunksInput {
  organizationId: string;
  documentEntityId: string;
  chunks: Array<{ id: string; content: string }>;
}

/**
 * Batched: one real provider call for every chunk's embedding (Performance
 * §16's "batch embedding generation"), but one `EmbeddingJob` row PER chunk
 * (not one for the whole document) — so a single malformed vector in an
 * otherwise-successful batch can be retried individually instead of
 * re-embedding the whole document. Called from the one additive hook in
 * `library.service.ts`'s `parseAndChunk`; never throws in a way that would
 * reach the upload request — the caller wraps this in its own try/catch,
 * same as the Smart Linking hook it sits right next to.
 */
export async function embedDocumentChunks(input: EmbedChunksInput): Promise<void> {
  const { organizationId, documentEntityId, chunks } = input;
  if (chunks.length === 0) return;

  const provider = getEmbeddingProvider();
  await getQueue().enqueue('generate-embeddings', { organizationId, documentEntityId, chunkCount: chunks.length });

  const jobs = await Promise.all(
    chunks.map((chunk) =>
      createEmbeddingJob({
        organizationId,
        jobType: 'GENERATE',
        sourceType: 'CHUNK',
        sourceId: chunk.id,
        provider: provider.providerName(),
      }),
    ),
  );

  let vectors: number[][];
  try {
    vectors = await provider.generateEmbeddings(chunks.map((chunk) => chunk.content));
  } catch (error) {
    await Promise.all(
      jobs.map((job) => completeEmbeddingJob(job.id, organizationId, { status: 'FAILED', errorMessage: errorMessage(error) })),
    );
    log.error('Batch embedding generation failed', { organizationId, documentEntityId, message: errorMessage(error) });
    return;
  }

  let succeeded = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const job = jobs[index];
    const vector = vectors[index];
    if (!chunk || !job) continue;

    try {
      if (!vector || vector.length !== provider.dimensions()) {
        throw new Error(`Embedding dimension mismatch: got ${vector?.length ?? 0}, expected ${provider.dimensions()}.`);
      }
      await upsertEmbedding({
        organizationId,
        sourceType: 'CHUNK',
        sourceId: chunk.id,
        content: chunk.content,
        embeddingModel: getEmbeddingModelLabel(),
        embeddingVersion: EMBEDDING_VERSION,
        vector,
      });
      await completeEmbeddingJob(job.id, organizationId, { status: 'SUCCEEDED' });
      succeeded += 1;
    } catch (error) {
      await completeEmbeddingJob(job.id, organizationId, { status: 'FAILED', errorMessage: errorMessage(error) });
    }
  }

  await logAiRequest({
    organizationId,
    action: 'embedding.generate_chunks',
    provider: provider.providerName(),
    metadata: { documentEntityId, chunkCount: chunks.length, succeeded },
  });

  if (succeeded > 0) {
    await appendTimelineEvent({
      organizationId,
      entityId: documentEntityId,
      eventType: 'AI_ACTION',
      description: `Generated ${succeeded} of ${chunks.length} embedding(s) via ${provider.providerName()}.`,
    });
  }
}

export interface GenerateEmbeddingForSourceInput {
  sourceType: Exclude<EmbeddingSourceType, 'CHUNK'>;
  sourceId: string;
}

/** On-demand embedding for a NOTE/EMAIL/MEETING — see docs/embeddings.md for why these aren't hooked into their own (Phase 1) create paths automatically. */
export async function generateEmbeddingForSourceService(
  organizationId: string,
  input: GenerateEmbeddingForSourceInput,
): Promise<void> {
  await requireRole(organizationId, ROLES.MEMBER);

  const provider = getEmbeddingProvider();
  const job = await createEmbeddingJob({
    organizationId,
    jobType: 'GENERATE',
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    provider: provider.providerName(),
  });

  try {
    const content = await resolveSourceContent(organizationId, input.sourceType, input.sourceId);
    if (!content) throw new NotFoundError(`No embeddable content found for ${input.sourceType}:${input.sourceId}.`);

    await embedOneSource(organizationId, input.sourceType, input.sourceId, content);
    await completeEmbeddingJob(job.id, organizationId, { status: 'SUCCEEDED' });
    await logAiRequest({
      organizationId,
      action: 'embedding.generate_source',
      provider: provider.providerName(),
      metadata: { sourceType: input.sourceType, sourceId: input.sourceId },
    });
  } catch (error) {
    await completeEmbeddingJob(job.id, organizationId, { status: 'FAILED', errorMessage: errorMessage(error) });
    throw error;
  }
}

export interface RetryEmbeddingJobsResult {
  retried: number;
  succeeded: number;
  failed: number;
}

/** Finds every FAILED job in the org and re-attempts it — the "no real worker, triggered manually" pattern `docs/connectors.md` already documents for sync jobs. */
export async function retryFailedEmbeddingJobsService(organizationId: string): Promise<RetryEmbeddingJobsResult> {
  await requireRole(organizationId, ROLES.MEMBER);
  await getQueue().enqueue('retry-failed-embedding-jobs', { organizationId });

  const failedJobs = await listFailedEmbeddingJobs(organizationId);
  let succeeded = 0;
  let failed = 0;

  for (const job of failedJobs) {
    await markEmbeddingJobRetrying(job.id, organizationId);
    try {
      let content: string | null;
      if (job.sourceType === 'CHUNK') {
        const chunk = await prisma.chunk.findFirst({
          where: { id: job.sourceId, knowledgeDocument: { organizationId } },
          select: { content: true },
        });
        content = chunk?.content ?? null;
      } else {
        content = await resolveSourceContent(organizationId, job.sourceType, job.sourceId);
      }
      if (!content) throw new NotFoundError('Source no longer exists or has no embeddable content.');

      await embedOneSource(organizationId, job.sourceType, job.sourceId, content);
      await completeEmbeddingJob(job.id, organizationId, { status: 'SUCCEEDED' });
      succeeded += 1;
    } catch (error) {
      await completeEmbeddingJob(job.id, organizationId, { status: 'FAILED', errorMessage: errorMessage(error) });
      failed += 1;
    }
  }

  return { retried: failedJobs.length, succeeded, failed };
}

export interface ReindexDocumentResult {
  chunksEmbedded: number;
}

/** Re-embeds every existing chunk of one KnowledgeDocument — for after switching embedding models, not for re-parsing (that's the upload pipeline's job, unchanged). */
export async function reindexDocumentService(organizationId: string, knowledgeDocumentId: string): Promise<ReindexDocumentResult> {
  await requireRole(organizationId, ROLES.MEMBER);

  const document = await prisma.knowledgeDocument.findFirst({
    where: { id: knowledgeDocumentId, organizationId },
    select: { entityId: true, chunks: { select: { id: true, content: true } } },
  });
  if (!document) throw new NotFoundError('Document not found.');

  await getQueue().enqueue('reindex-document', { organizationId, knowledgeDocumentId });
  await embedDocumentChunks({ organizationId, documentEntityId: document.entityId, chunks: document.chunks });

  return { chunksEmbedded: document.chunks.length };
}

export interface RebuildVectorsResult {
  deleted: number;
  chunksQueued: number;
  notesQueued: number;
  emailsQueued: number;
  meetingsQueued: number;
}

/** Deletes and regenerates every embedding in the org — the heavy, explicit "I changed providers/dimensions" operation. ADMIN-gated: destructive and expensive. */
export async function rebuildVectorsService(organizationId: string): Promise<RebuildVectorsResult> {
  await requireRole(organizationId, ROLES.ADMIN);
  await getQueue().enqueue('rebuild-vectors', { organizationId });

  const deleted = await deleteAllEmbeddings(organizationId);

  const [documents, notes, emails, meetings] = await Promise.all([
    prisma.knowledgeDocument.findMany({
      where: { organizationId },
      select: { entityId: true, chunks: { select: { id: true, content: true } } },
    }),
    prisma.entity.findMany({ where: { organizationId, entityType: 'NOTE' }, select: { id: true } }),
    prisma.email.findMany({ where: { organizationId }, select: { id: true } }),
    prisma.meeting.findMany({ where: { organizationId }, select: { id: true } }),
  ]);

  for (const document of documents) {
    if (document.chunks.length > 0) {
      await embedDocumentChunks({ organizationId, documentEntityId: document.entityId, chunks: document.chunks });
    }
  }
  for (const note of notes) {
    await generateEmbeddingForSourceService(organizationId, { sourceType: 'NOTE', sourceId: note.id }).catch((error) =>
      log.error('Failed to re-embed note during rebuild', { organizationId, noteId: note.id, message: errorMessage(error) }),
    );
  }
  for (const email of emails) {
    await generateEmbeddingForSourceService(organizationId, { sourceType: 'EMAIL', sourceId: email.id }).catch((error) =>
      log.error('Failed to re-embed email during rebuild', { organizationId, emailId: email.id, message: errorMessage(error) }),
    );
  }
  for (const meeting of meetings) {
    await generateEmbeddingForSourceService(organizationId, { sourceType: 'MEETING', sourceId: meeting.id }).catch((error) =>
      log.error('Failed to re-embed meeting during rebuild', { organizationId, meetingId: meeting.id, message: errorMessage(error) }),
    );
  }

  return {
    deleted,
    chunksQueued: documents.reduce((sum, document) => sum + document.chunks.length, 0),
    notesQueued: notes.length,
    emailsQueued: emails.length,
    meetingsQueued: meetings.length,
  };
}

export async function deleteEmbeddingForSourceService(
  organizationId: string,
  sourceType: EmbeddingSourceType,
  sourceId: string,
): Promise<void> {
  await requireRole(organizationId, ROLES.ADMIN);
  await getQueue().enqueue('delete-embeddings', { organizationId, sourceType, sourceId });
  const deleted = await deleteEmbeddingsForSource(organizationId, sourceType, sourceId);
  if (!deleted) throw new NotFoundError('Embedding not found.');
}

export async function listEmbeddingJobsService(
  organizationId: string,
  query: Omit<EmbeddingJobListFilters, 'organizationId'>,
): Promise<PaginatedResult<EmbeddingJobSummary>> {
  await requireRole(organizationId, ROLES.MEMBER);
  return listEmbeddingJobs({ organizationId, ...query });
}
