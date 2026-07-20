import {
  appendTimelineEvent,
  createPersonEntity,
  createRelationship,
  createSimpleEntity,
  findEntityByExactTitle,
  mergeEntityMetadata,
  prisma,
  type EntityType,
  type RelationshipType,
} from '@bond-os/database';
import { extractCandidates, type TextMatch } from '@bond-os/extraction';
import { logger } from '@bond-os/shared/server';

import { resolvePersonName } from './resolution.service';

const log = logger.child('graph-extraction');

/**
 * "Smart Linking" (Phase 3 spec §11): on document upload, extract entities,
 * resolve duplicates, create nodes, create relationships, append timeline
 * events — fully automatic, fully deterministic (regex/heuristics only, see
 * `@bond-os/extraction`). Invoked additively from
 * `apps/web/features/library/services/library.service.ts` after parsing
 * succeeds; never throws — a failure here must not break the upload.
 */
export interface SmartLinkingInput {
  documentEntityId: string;
  organizationId: string;
  userId: string | null;
  text: string;
}

/** Same-paragraph-ish co-occurrence window for proximity-based detections (e.g. WORKS_AT). */
const PROXIMITY_CHARS = 200;

export async function runSmartLinkingForDocument(input: SmartLinkingInput): Promise<void> {
  const { documentEntityId, organizationId, userId, text } = input;
  if (!text.trim()) return;

  const candidates = extractCandidates(text);

  await appendTimelineEvent({
    organizationId,
    entityId: documentEntityId,
    eventType: 'UPLOADED',
    description: 'Document uploaded and parsed.',
  });

  const companies = await resolveOrCreateMany(
    organizationId,
    userId,
    'COMPANY',
    candidates.companyNames,
    documentEntityId,
  );
  const people = await resolvePeople(organizationId, userId, candidates.personNames, documentEntityId);
  const websites = await resolveOrCreateMany(
    organizationId,
    userId,
    'WEBSITE',
    candidates.urls,
    documentEntityId,
  );

  await detectWorksAt(organizationId, userId, people, companies);

  const projects = await resolveOrCreateMentions(
    organizationId,
    userId,
    documentEntityId,
    'PROJECT',
    'RELATED_TO',
    candidates.projectMentions,
  );
  const meetings = await resolveOrCreateMentions(
    organizationId,
    userId,
    documentEntityId,
    'MEETING',
    'PART_OF',
    candidates.meetingMentions,
  );

  await softLinkToPhase1Records(organizationId, projects, meetings);
  await detectAttended(organizationId, userId, people, meetings);
  await linkFileReferences(organizationId, userId, documentEntityId, candidates.fileReferences);

  log.info('Smart linking finished', {
    documentEntityId,
    people: people.length,
    companies: companies.length,
    websites: websites.length,
    projects: projects.length,
    meetings: meetings.length,
  });
}

interface ResolvedMention {
  id: string;
  offset: number;
}

/** Company/Website mentions: dedup by exact title, MENTIONED_IN the source document. */
async function resolveOrCreateMany(
  organizationId: string,
  userId: string | null,
  entityType: EntityType,
  matches: TextMatch[],
  documentEntityId: string,
): Promise<ResolvedMention[]> {
  const resolved: ResolvedMention[] = [];

  for (const match of matches) {
    const existing = await findEntityByExactTitle(organizationId, entityType, match.value);
    const entityId = existing
      ? existing.id
      : (await createSimpleEntity({ organizationId, creatorId: userId, entityType, title: match.value })).id;

    await appendTimelineEvent({
      organizationId,
      entityId,
      eventType: existing ? 'MENTIONED' : 'CREATED',
      description: existing ? 'Mentioned again in a document.' : 'Extracted from a document.',
    });

    await createRelationshipAndTrackTimeline(organizationId, userId, entityId, documentEntityId, 'MENTIONED_IN', 1);
    resolved.push({ id: entityId, offset: match.offset });
  }

  return resolved;
}

async function resolvePeople(
  organizationId: string,
  userId: string | null,
  matches: TextMatch[],
  documentEntityId: string,
): Promise<ResolvedMention[]> {
  const resolved: ResolvedMention[] = [];

  for (const match of matches) {
    const resolution = await resolvePersonName(organizationId, match.value);
    const entityId = resolution.matchedEntityId
      ? resolution.matchedEntityId
      : (await createPersonEntity({ organizationId, creatorId: userId, name: match.value })).id;

    await appendTimelineEvent({
      organizationId,
      entityId,
      eventType: resolution.matchedEntityId ? 'MENTIONED' : 'CREATED',
      description: resolution.matchedEntityId ? 'Mentioned again in a document.' : 'Extracted from a document.',
    });

    await createRelationshipAndTrackTimeline(organizationId, userId, entityId, documentEntityId, 'MENTIONED_IN', 1);
    resolved.push({ id: entityId, offset: match.offset });
  }

  return resolved;
}

/** Person + Company mentioned within ~one paragraph of each other → WORKS_AT (a proximity heuristic, not a certainty — lower confidence). */
async function detectWorksAt(
  organizationId: string,
  userId: string | null,
  people: ResolvedMention[],
  companies: ResolvedMention[],
): Promise<void> {
  for (const person of people) {
    for (const company of companies) {
      if (Math.abs(person.offset - company.offset) <= PROXIMITY_CHARS) {
        await createRelationshipAndTrackTimeline(organizationId, userId, person.id, company.id, 'WORKS_AT', 0.6);
      }
    }
  }
}

interface ResolvedRecordMention extends ResolvedMention {
  title: string;
  created: boolean;
}

/** Project/Meeting mentions: dedup by exact title, linked to the document via `relationshipType`. */
async function resolveOrCreateMentions(
  organizationId: string,
  userId: string | null,
  documentEntityId: string,
  entityType: EntityType,
  relationshipType: RelationshipType,
  matches: TextMatch[],
): Promise<ResolvedRecordMention[]> {
  const resolved: ResolvedRecordMention[] = [];

  for (const match of matches) {
    const existing = await findEntityByExactTitle(organizationId, entityType, match.value);
    const entityId = existing
      ? existing.id
      : (await createSimpleEntity({ organizationId, creatorId: userId, entityType, title: match.value })).id;

    await appendTimelineEvent({
      organizationId,
      entityId,
      eventType: existing ? 'MENTIONED' : 'CREATED',
      description: existing ? 'Mentioned again in a document.' : 'Extracted from a document.',
    });

    await createRelationshipAndTrackTimeline(
      organizationId,
      userId,
      documentEntityId,
      entityId,
      relationshipType,
      1,
    );
    resolved.push({ id: entityId, offset: match.offset, title: match.value, created: !existing });
  }

  return resolved;
}

/**
 * If an extracted PROJECT/MEETING mention's title exactly matches a real
 * Phase 1 `Project`/`Meeting` in the same org, store a soft (non-FK) link in
 * the extracted entity's metadata so the UI can point at the real record —
 * without coupling the graph schema to Phase 1's tables.
 */
async function softLinkToPhase1Records(
  organizationId: string,
  projects: ResolvedRecordMention[],
  meetings: ResolvedRecordMention[],
): Promise<void> {
  for (const project of projects) {
    const match = await prisma.project.findFirst({
      where: { organizationId, title: { equals: project.title, mode: 'insensitive' } },
      select: { id: true },
    });
    if (match) {
      await mergeEntityMetadata(project.id, organizationId, {
        linkedRecordType: 'PROJECT',
        linkedRecordId: match.id,
      });
    }
  }

  for (const meeting of meetings) {
    const match = await prisma.meeting.findFirst({
      where: { organizationId, title: { equals: meeting.title, mode: 'insensitive' } },
      select: { id: true },
    });
    if (match) {
      await mergeEntityMetadata(meeting.id, organizationId, {
        linkedRecordType: 'MEETING',
        linkedRecordId: match.id,
      });
    }
  }
}

/** Every extracted person mentioned alongside a meeting mention in the same document → ATTENDED (co-occurrence heuristic). */
async function detectAttended(
  organizationId: string,
  userId: string | null,
  people: ResolvedMention[],
  meetings: ResolvedRecordMention[],
): Promise<void> {
  for (const person of people) {
    for (const meeting of meetings) {
      await createRelationshipAndTrackTimeline(organizationId, userId, person.id, meeting.id, 'ATTENDED', 0.7);
    }
  }
}

/** An extracted filename matching another KnowledgeDocument's fileName in the org → REFERENCES. */
async function linkFileReferences(
  organizationId: string,
  userId: string | null,
  documentEntityId: string,
  fileReferences: TextMatch[],
): Promise<void> {
  for (const reference of fileReferences) {
    const match = await prisma.knowledgeDocument.findFirst({
      where: {
        organizationId,
        fileName: { equals: reference.value, mode: 'insensitive' },
        entityId: { not: documentEntityId },
      },
      select: { entityId: true },
    });
    if (!match) continue;

    await createRelationshipAndTrackTimeline(
      organizationId,
      userId,
      documentEntityId,
      match.entityId,
      'REFERENCES',
      0.8,
    );
  }
}

/** Creates a relationship and — only if it wasn't a no-op duplicate — appends a CONNECTED timeline event to both endpoints. */
async function createRelationshipAndTrackTimeline(
  organizationId: string,
  userId: string | null,
  sourceEntityId: string,
  targetEntityId: string,
  relationshipType: RelationshipType,
  confidence: number,
): Promise<void> {
  const created = await createRelationship({
    organizationId,
    sourceEntityId,
    targetEntityId,
    relationshipType,
    confidence,
    createdById: userId,
  });
  if (!created) return;

  await Promise.all([
    appendTimelineEvent({
      organizationId,
      entityId: sourceEntityId,
      eventType: 'CONNECTED',
      description: `Linked via ${relationshipType}.`,
    }),
    appendTimelineEvent({
      organizationId,
      entityId: targetEntityId,
      eventType: 'CONNECTED',
      description: `Linked via ${relationshipType}.`,
    }),
  ]);
}
