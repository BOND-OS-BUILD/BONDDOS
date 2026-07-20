import { requireRole } from '@bond-os/auth';
import { findConnectedEntities, getTimeline, prisma } from '@bond-os/database';
import { ROLES } from '@bond-os/shared';
import { getEnv } from '@bond-os/shared/server';

import { countTokensService } from '@/features/ai/services/ai.service';

import { retrieve } from './retrieval.service';
import type { HybridSearchResult } from './hybrid-search.service';

/**
 * Context Builder (spec §6): question in, an assembled, token-budgeted
 * bundle of documents/chunks/connected entities/timeline events/projects/
 * customers/meetings out. Greedy, rank-ordered inclusion — highest-scored
 * `retrieve()` results are added first, stopping the moment the next item
 * would exceed the budget (deterministic: same inputs always produce the
 * same cutoff). Connected entities/timeline are only fetched for the
 * highest-ranked items (Performance §16's "lazy context loading"), not
 * every included item.
 */

const TOP_ITEMS_FOR_EXPANSION = 5;

export interface ContextItem {
  key: string;
  kind: HybridSearchResult['kind'];
  title: string;
  content: string;
  score: number;
  tokens: number;
}

export interface LinkedRecordRef {
  id: string;
  title: string;
}

export interface AssembledContext {
  question: string;
  documents: LinkedRecordRef[];
  chunks: ContextItem[];
  entities: ContextItem[];
  connectedEntities: Array<{ id: string; title: string; entityType: string; depth: number }>;
  timelineEvents: Array<{ id: string; description: string; eventType: string; entityTitle: string }>;
  projects: LinkedRecordRef[];
  customers: LinkedRecordRef[];
  meetings: LinkedRecordRef[];
  totalTokens: number;
  tokenBudget: number;
  truncated: boolean;
  /** The `retrieve()` results this context was built from — Phase 5's `buildPrompt`/citation callers need these for `buildCitations`, and returning them here avoids a second, wasted `retrieve()` call. Unused by any Phase 4 caller. */
  rawResults: HybridSearchResult[];
}

interface ContentInfo {
  content: string;
  documentId?: string;
  documentTitle?: string;
}

/** One batched pass to resolve full content for every candidate — org-scoped even though the candidate ids already came from org-scoped queries upstream (defense in depth, not just trust-the-caller). */
async function resolveContent(organizationId: string, results: HybridSearchResult[]): Promise<Map<string, ContentInfo>> {
  const map = new Map<string, ContentInfo>();

  const chunkIds = results.filter((result) => result.kind === 'CHUNK').map((result) => result.id);
  const entityIds = results.filter((result) => result.kind === 'ENTITY').map((result) => result.id);

  const [chunks, entities] = await Promise.all([
    chunkIds.length > 0
      ? prisma.chunk.findMany({
          where: { id: { in: chunkIds }, knowledgeDocument: { organizationId } },
          select: { id: true, content: true, knowledgeDocument: { select: { id: true, entity: { select: { title: true } } } } },
        })
      : Promise.resolve([]),
    entityIds.length > 0
      ? prisma.entity.findMany({ where: { id: { in: entityIds }, organizationId }, select: { id: true, title: true, description: true } })
      : Promise.resolve([]),
  ]);

  for (const chunk of chunks) {
    map.set(`CHUNK:${chunk.id}`, {
      content: chunk.content,
      documentId: chunk.knowledgeDocument.id,
      documentTitle: chunk.knowledgeDocument.entity.title,
    });
  }
  for (const entity of entities) {
    map.set(`ENTITY:${entity.id}`, { content: [entity.title, entity.description].filter(Boolean).join('\n\n') });
  }

  return map;
}

/** PROJECT/MEETING mentions carry a soft link (Phase 3's `metadata.linkedRecordType`) to the real Phase 1 record; CUSTOMER mentions have no soft-link mechanism, so an exact-title match against the real `Customer` table is used instead — the same deterministic "exact match, no fuzzy guessing" approach Phase 3 already established. */
async function resolveLinkedRecords(
  organizationId: string,
  entityIds: string[],
): Promise<{ projects: LinkedRecordRef[]; customers: LinkedRecordRef[]; meetings: LinkedRecordRef[] }> {
  if (entityIds.length === 0) return { projects: [], customers: [], meetings: [] };

  const entities = await prisma.entity.findMany({
    where: { id: { in: entityIds }, organizationId },
    select: { title: true, entityType: true, metadata: true },
  });

  const projectIds = new Set<string>();
  const meetingIds = new Set<string>();
  const customerNames = new Set<string>();

  for (const entity of entities) {
    const metadata = entity.metadata as Record<string, unknown> | null;
    if (metadata && typeof metadata === 'object') {
      if (metadata.linkedRecordType === 'PROJECT' && typeof metadata.linkedRecordId === 'string') {
        projectIds.add(metadata.linkedRecordId);
      }
      if (metadata.linkedRecordType === 'MEETING' && typeof metadata.linkedRecordId === 'string') {
        meetingIds.add(metadata.linkedRecordId);
      }
    }
    if (entity.entityType === 'CUSTOMER') customerNames.add(entity.title);
  }

  const [projects, meetings, customers] = await Promise.all([
    projectIds.size > 0
      ? prisma.project.findMany({ where: { id: { in: Array.from(projectIds) }, organizationId }, select: { id: true, title: true } })
      : Promise.resolve([]),
    meetingIds.size > 0
      ? prisma.meeting.findMany({ where: { id: { in: Array.from(meetingIds) }, organizationId }, select: { id: true, title: true } })
      : Promise.resolve([]),
    customerNames.size > 0
      ? prisma.customer.findMany({ where: { name: { in: Array.from(customerNames) }, organizationId }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);

  return {
    projects: projects.map((project) => ({ id: project.id, title: project.title })),
    meetings: meetings.map((meeting) => ({ id: meeting.id, title: meeting.title })),
    customers: customers.map((customer) => ({ id: customer.id, title: customer.name })),
  };
}

export async function buildContext(
  organizationId: string,
  question: string,
  tokenBudget?: number,
): Promise<AssembledContext> {
  await requireRole(organizationId, ROLES.MEMBER);

  const budget = tokenBudget ?? getEnv().CONTEXT_TOKEN_BUDGET;
  const results = await retrieve(organizationId, question, { limit: 30 });
  const contentByKey = await resolveContent(organizationId, results);

  const items: ContextItem[] = [];
  let totalTokens = countTokensService(question);
  let truncated = false;

  for (const result of results) {
    const info = contentByKey.get(result.key);
    const content = info?.content ?? result.snippet;
    const tokens = countTokensService(content);

    if (totalTokens + tokens > budget) {
      truncated = true;
      break;
    }

    items.push({ key: result.key, kind: result.kind, title: result.title, content, score: result.score, tokens });
    totalTokens += tokens;
  }

  const documentsById = new Map<string, string>();
  for (const result of results) {
    const info = contentByKey.get(result.key);
    if (info?.documentId && info.documentTitle) documentsById.set(info.documentId, info.documentTitle);
  }

  const topEntityIds = items
    .filter((item) => item.kind === 'ENTITY')
    .slice(0, TOP_ITEMS_FOR_EXPANSION)
    .map((item) => item.key.slice('ENTITY:'.length));

  const [connectedNested, timelineNested, linkedRecords] = await Promise.all([
    Promise.all(topEntityIds.map((id) => findConnectedEntities(id, organizationId, 1))),
    Promise.all(topEntityIds.map((id) => getTimeline(id, { organizationId, page: 1, pageSize: 5 }))),
    resolveLinkedRecords(organizationId, topEntityIds),
  ]);

  const connectedEntities = connectedNested
    .flat()
    .map((entity) => ({ id: entity.id, title: entity.title, entityType: entity.entityType, depth: entity.depth }));

  const timelineEvents = timelineNested
    .flatMap((page) => page.items)
    .map((event) => ({
      id: event.id,
      description: event.description,
      eventType: event.eventType,
      entityTitle: event.entity.title,
    }));

  return {
    question,
    documents: Array.from(documentsById.entries()).map(([id, title]) => ({ id, title })),
    chunks: items.filter((item) => item.kind === 'CHUNK'),
    entities: items.filter((item) => item.kind === 'ENTITY'),
    connectedEntities,
    timelineEvents,
    projects: linkedRecords.projects,
    customers: linkedRecords.customers,
    meetings: linkedRecords.meetings,
    totalTokens,
    tokenBudget: budget,
    truncated,
    rawResults: results,
  };
}
