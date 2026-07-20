/**
 * Dev-only data seed. Creates a demo organization with a full, realistic
 * Knowledge Graph — 10 users, 8 projects, 40 tasks, 25 documents, 12
 * meetings, 20 customers, 40 emails — all cross-linked, so every page has
 * something real to render immediately after `pnpm db:seed`.
 *
 * Phase 3 additively seeds a small hand-built knowledge graph (Person/
 * Company/Product/Event entities + Relationships + TimelineEvents) so
 * `/graph` isn't empty on first load — the same shape the extraction
 * pipeline produces automatically from a real document upload, just
 * hand-authored instead of regex-extracted. See docs/knowledge-graph.md.
 *
 * Phase 4 additively embeds a handful of the seeded meetings/emails via the
 * zero-config local embedding provider, so `/ai/embeddings` and `/memory`
 * aren't empty either. CHUNK embeddings aren't seeded here — they're only
 * ever produced by the real Library upload pipeline, which needs an actual
 * file; seed data has no KnowledgeDocument/Chunk rows to embed. See
 * docs/embeddings.md.
 *
 * This does NOT create login-ready passwords/Account rows — Better Auth
 * owns password hashing end-to-end, and replicating its hash format here
 * would be fragile. To actually log in, sign up for real via `/signup`
 * (see docs/Setup.md); the first organization you create there becomes
 * your workspace, following the exact same code path production traffic
 * uses (`createOrganizationWithWorkspace`).
 */
/* eslint-disable no-console -- this is a CLI script; console output is its intended UX */
import { createEmbeddingProvider } from '@bond-os/embeddings';

import { PrismaClient, type RelationshipType, type Role } from '../src/generated/index.js';
import { createOrganizationWithWorkspace } from '../src/queries/organizations';
import { upsertEmbedding } from '../src/repositories/embeddings';

const prisma = new PrismaClient();

function pick<T>(items: readonly T[], index: number): T {
  return items[index % items.length]!;
}

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

interface SeedUser {
  name: string;
  email: string;
  firstName: string;
  lastName: string;
  title: string;
  department: string;
  phone: string;
  timezone: string;
  role: Role;
}

const TEAM: SeedUser[] = [
  {
    name: 'Harman Salgotra',
    email: 'demo@bondos.dev',
    firstName: 'Harman',
    lastName: 'Salgotra',
    title: 'Founder & CEO',
    department: 'Leadership',
    phone: '+1-415-555-0101',
    timezone: 'America/Los_Angeles',
    role: 'OWNER',
  },
  {
    name: 'Priya Sharma',
    email: 'priya@bondos.dev',
    firstName: 'Priya',
    lastName: 'Sharma',
    title: 'Engineering Manager',
    department: 'Engineering',
    phone: '+1-415-555-0102',
    timezone: 'America/Los_Angeles',
    role: 'ADMIN',
  },
  {
    name: 'Alex Chen',
    email: 'alex@bondos.dev',
    firstName: 'Alex',
    lastName: 'Chen',
    title: 'Head of Product',
    department: 'Product',
    phone: '+1-415-555-0103',
    timezone: 'America/New_York',
    role: 'ADMIN',
  },
  {
    name: 'Jordan Lee',
    email: 'jordan@bondos.dev',
    firstName: 'Jordan',
    lastName: 'Lee',
    title: 'Senior Software Engineer',
    department: 'Engineering',
    phone: '+1-415-555-0104',
    timezone: 'America/Los_Angeles',
    role: 'MEMBER',
  },
  {
    name: 'Sam Patel',
    email: 'sam@bondos.dev',
    firstName: 'Sam',
    lastName: 'Patel',
    title: 'Software Engineer',
    department: 'Engineering',
    phone: '+1-415-555-0105',
    timezone: 'America/Chicago',
    role: 'MEMBER',
  },
  {
    name: 'Taylor Kim',
    email: 'taylor@bondos.dev',
    firstName: 'Taylor',
    lastName: 'Kim',
    title: 'Product Designer',
    department: 'Design',
    phone: '+1-415-555-0106',
    timezone: 'America/Los_Angeles',
    role: 'MEMBER',
  },
  {
    name: 'Morgan Davis',
    email: 'morgan@bondos.dev',
    firstName: 'Morgan',
    lastName: 'Davis',
    title: 'Account Executive',
    department: 'Sales',
    phone: '+1-415-555-0107',
    timezone: 'America/New_York',
    role: 'MEMBER',
  },
  {
    name: 'Casey Wilson',
    email: 'casey@bondos.dev',
    firstName: 'Casey',
    lastName: 'Wilson',
    title: 'Marketing Manager',
    department: 'Marketing',
    phone: '+1-415-555-0108',
    timezone: 'America/Denver',
    role: 'MEMBER',
  },
  {
    name: 'Riley Brown',
    email: 'riley@bondos.dev',
    firstName: 'Riley',
    lastName: 'Brown',
    title: 'QA Engineer',
    department: 'Engineering',
    phone: '+1-415-555-0109',
    timezone: 'America/Los_Angeles',
    role: 'MEMBER',
  },
  {
    name: 'Jamie Garcia',
    email: 'jamie@bondos.dev',
    firstName: 'Jamie',
    lastName: 'Garcia',
    title: 'Customer Success Manager',
    department: 'Customer Success',
    phone: '+1-415-555-0110',
    timezone: 'America/Chicago',
    role: 'MEMBER',
  },
];

const PROJECTS = [
  {
    title: 'Website Redesign',
    description: 'Refresh the marketing site with the new brand system and improve conversion.',
    status: 'ACTIVE',
    priority: 'HIGH',
    startDate: daysFromNow(-30),
    dueDate: daysFromNow(15),
  },
  {
    title: 'Mobile App Launch',
    description: 'Ship v1 of the iOS/Android companion app.',
    status: 'PLANNING',
    priority: 'URGENT',
    startDate: daysFromNow(-5),
    dueDate: daysFromNow(60),
  },
  {
    title: 'API v2 Migration',
    description: 'Migrate all internal services from the v1 REST API to v2.',
    status: 'ACTIVE',
    priority: 'HIGH',
    startDate: daysFromNow(-45),
    dueDate: daysFromNow(20),
  },
  {
    title: 'Customer Portal',
    description: 'Self-service portal so customers can manage their own accounts.',
    status: 'ON_HOLD',
    priority: 'MEDIUM',
    startDate: daysFromNow(-60),
    dueDate: daysFromNow(90),
  },
  {
    title: 'Q3 Marketing Campaign',
    description: 'Multi-channel campaign for the Q3 product launch.',
    status: 'COMPLETED',
    priority: 'MEDIUM',
    startDate: daysFromNow(-120),
    dueDate: daysFromNow(-30),
  },
  {
    title: 'Infrastructure Upgrade',
    description: 'Move production workloads to the new Kubernetes cluster.',
    status: 'ACTIVE',
    priority: 'HIGH',
    startDate: daysFromNow(-20),
    dueDate: daysFromNow(40),
  },
  {
    title: 'Sales Enablement Tools',
    description: 'Give the sales team a proper deal room and proposal generator.',
    status: 'PLANNING',
    priority: 'LOW',
    startDate: daysFromNow(10),
    dueDate: daysFromNow(75),
  },
  {
    title: 'Data Analytics Platform',
    description: 'Internal analytics platform for product usage insights.',
    status: 'ARCHIVED',
    priority: 'MEDIUM',
    startDate: daysFromNow(-200),
    dueDate: daysFromNow(-90),
  },
] as const;

const TASK_VERBS = ['Design', 'Implement', 'Fix', 'Review', 'Write tests for', 'Deploy', 'Document', 'Refactor'];
const TASK_NOUNS = [
  'the login flow',
  'the checkout page',
  'the onboarding email',
  'the settings screen',
  'the API rate limiter',
  'the notification system',
  'the search index',
  'the billing integration',
  'the dashboard charts',
  'the mobile navigation',
];
const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED'] as const;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

const DOCUMENT_TITLES = [
  { title: 'Project Brief', type: 'PDF', ext: 'pdf', mime: 'application/pdf' },
  { title: 'Requirements Spec', type: 'DOCX', ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { title: 'Kickoff Deck', type: 'PPT', ext: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  { title: 'Budget Tracker', type: 'SPREADSHEET', ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { title: 'Meeting Notes', type: 'NOTE', ext: 'md', mime: 'text/markdown' },
  { title: 'Design Mockups', type: 'PDF', ext: 'pdf', mime: 'application/pdf' },
  { title: 'Technical Architecture', type: 'DOCX', ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { title: 'Launch Checklist', type: 'NOTE', ext: 'md', mime: 'text/markdown' },
] as const;

const CUSTOMER_STATUSES = ['LEAD', 'ACTIVE', 'CHURNED', 'ARCHIVED'] as const;
const CUSTOMER_COMPANIES = [
  'Northwind Traders',
  'Contoso Ltd',
  'Globex Corporation',
  'Initech',
  'Umbrella Group',
  'Stark Industries',
  'Wayne Enterprises',
  'Wonka Industries',
  'Hooli',
  'Pied Piper',
  'Aperture Labs',
  'Soylent Corp',
  'Cyberdyne Systems',
  'Massive Dynamic',
  'Gringotts Financial',
  'Dunder Mifflin',
  'Oscorp',
  'Tyrell Corporation',
  'Acme Co',
  'Vandelay Industries',
];
const CUSTOMER_FIRST_NAMES = [
  'Olivia',
  'Liam',
  'Emma',
  'Noah',
  'Ava',
  'Ethan',
  'Sophia',
  'Mason',
  'Isabella',
  'Lucas',
  'Mia',
  'Henry',
  'Amelia',
  'Elijah',
  'Harper',
  'James',
  'Evelyn',
  'Benjamin',
  'Abigail',
  'Daniel',
];
const CUSTOMER_LAST_NAMES = [
  'Reed',
  'Foster',
  'Bennett',
  'Coleman',
  'Hayes',
  'Price',
  'Sanders',
  'Wallace',
  'Fisher',
  'Simmons',
];

const EMAIL_SUBJECTS = [
  'Re: Contract renewal',
  'Onboarding kickoff',
  'Question about pricing',
  'Feature request',
  'Quarterly check-in',
  'Invoice attached',
  'Follow-up from our call',
  'Welcome to BOND OS',
  'Support ticket update',
  'Proposal for Q3',
];

async function main() {
  console.log('Seeding BOND OS demo data…');

  const users = [];
  for (const member of TEAM) {
    const user = await prisma.user.upsert({
      where: { email: member.email },
      update: {},
      create: {
        name: member.name,
        email: member.email,
        emailVerified: true,
        firstName: member.firstName,
        lastName: member.lastName,
        title: member.title,
        department: member.department,
        phone: member.phone,
        timezone: member.timezone,
        status: 'ACTIVE',
      },
    });
    users.push({ ...user, seedRole: member.role });
  }
  console.log(`Seeded ${users.length} users.`);

  const owner = users[0]!;
  let organizationId: string;

  const existingMembership = await prisma.membership.findFirst({ where: { userId: owner.id } });
  if (existingMembership) {
    organizationId = existingMembership.organizationId;
    console.log('Demo owner already has an organization — reusing it.');
  } else {
    const organization = await createOrganizationWithWorkspace({
      name: 'Salgotra Industries',
      slug: 'salgotra-industries',
      ownerId: owner.id,
    });
    organizationId = organization.id;
    await prisma.organization.update({
      where: { id: organization.id },
      data: {
        description: 'BOND OS is the AI-native operating system for startups — this is our own dogfood workspace.',
        website: 'https://bondos.dev',
        industry: 'Software',
        size: '11-50 employees',
      },
    });
    console.log(`Seeded organization "${organization.name}".`);

    for (const member of users.slice(1)) {
      await prisma.membership.create({
        data: { userId: member.id, organizationId, role: member.seedRole },
      });
    }
    console.log(`Seeded ${users.length - 1} memberships.`);
  }

  const existingProjects = await prisma.project.count({ where: { organizationId } });
  if (existingProjects > 0) {
    console.log('Organization already has Knowledge Graph data — skipping (delete the DB to reseed from scratch).');
    return;
  }

  const projects = [];
  for (const [index, projectSeed] of PROJECTS.entries()) {
    const owner2 = pick(users, index + 1);
    const memberPool = users.filter((u) => u.id !== owner2.id);
    const members = [pick(memberPool, index), pick(memberPool, index + 3), pick(memberPool, index + 5)];

    const project = await prisma.project.create({
      data: {
        organizationId,
        title: projectSeed.title,
        description: projectSeed.description,
        status: projectSeed.status,
        priority: projectSeed.priority,
        startDate: projectSeed.startDate,
        dueDate: projectSeed.dueDate,
        ownerId: owner2.id,
        members: {
          create: Array.from(new Set(members.map((m) => m.id))).map((userId) => ({ userId })),
        },
      },
    });
    projects.push(project);
  }
  console.log(`Seeded ${projects.length} projects.`);

  let taskCount = 0;
  const TASKS_PER_PROJECT = 5;
  for (const [projectIndex, project] of projects.entries()) {
    for (let i = 0; i < TASKS_PER_PROJECT; i++) {
      const globalIndex = projectIndex * TASKS_PER_PROJECT + i;
      const status = pick(TASK_STATUSES, globalIndex);
      await prisma.task.create({
        data: {
          organizationId,
          projectId: project.id,
          title: `${pick(TASK_VERBS, globalIndex)} ${pick(TASK_NOUNS, globalIndex + i)}`,
          description: `Part of the "${project.title}" project.`,
          status,
          priority: pick(PRIORITIES, globalIndex + 1),
          dueDate: daysFromNow(-10 + globalIndex),
          completedAt: status === 'DONE' ? daysFromNow(-5 + (globalIndex % 10)) : null,
          assigneeId: pick(users, globalIndex + 2).id,
        },
      });
      taskCount += 1;
    }
  }
  console.log(`Seeded ${taskCount} tasks.`);

  let meetingCount = 0;
  const MEETINGS_PER_PROJECT = [2, 2, 2, 1, 1, 2, 1, 1];
  const meetingsByProject: Record<string, string[]> = {};
  for (const [projectIndex, project] of projects.entries()) {
    const count = MEETINGS_PER_PROJECT[projectIndex] ?? 1;
    meetingsByProject[project.id] = [];
    for (let i = 0; i < count; i++) {
      const globalIndex = meetingCount;
      const attendees = [pick(users, globalIndex), pick(users, globalIndex + 2), pick(users, globalIndex + 4)];
      const meeting = await prisma.meeting.create({
        data: {
          organizationId,
          projectId: project.id,
          title: i === 0 ? `${project.title} kickoff` : `${project.title} sync #${i}`,
          agenda: 'Review status, blockers, and next steps.',
          notes: i === 0 ? 'Aligned on scope and timeline.' : null,
          location: pick(['Zoom', 'Conference Room A', 'Conference Room B', 'Google Meet'], globalIndex),
          meetingDate: daysFromNow(-40 + globalIndex * 7),
          duration: pick([30, 45, 60], globalIndex),
          attendees: {
            create: Array.from(new Set(attendees.map((a) => a.id))).map((userId) => ({ userId })),
          },
        },
      });
      meetingsByProject[project.id]!.push(meeting.id);
      meetingCount += 1;
    }
  }
  console.log(`Seeded ${meetingCount} meetings.`);

  let documentCount = 0;
  const DOCUMENTS_TOTAL = 25;
  const allMeetingIds = Object.values(meetingsByProject).flat();
  for (let i = 0; i < DOCUMENTS_TOTAL; i++) {
    const doc = pick(DOCUMENT_TITLES, i);
    const project = pick(projects, i);
    const attachToMeeting = i % 4 === 0 && allMeetingIds.length > 0;
    await prisma.document.create({
      data: {
        organizationId,
        title: `${project.title} — ${doc.title}`,
        description: `${doc.title} for ${project.title}.`,
        type: doc.type,
        fileName: `${doc.title.toLowerCase().replace(/\s+/g, '-')}-${i + 1}.${doc.ext}`,
        mimeType: doc.mime,
        size: 50_000 + i * 37_451,
        storagePath: `documents/seed/${project.id}-${i + 1}.${doc.ext}`,
        projectId: project.id,
        meetingId: attachToMeeting ? pick(allMeetingIds, i) : null,
        uploadedById: pick(users, i + 1).id,
      },
    });
    documentCount += 1;
  }
  console.log(`Seeded ${documentCount} documents.`);

  const customers = [];
  for (let i = 0; i < 20; i++) {
    const first = pick(CUSTOMER_FIRST_NAMES, i);
    const last = pick(CUSTOMER_LAST_NAMES, i + 3);
    const company = pick(CUSTOMER_COMPANIES, i);
    const linkedProjects = [pick(projects, i), pick(projects, i + 4)];

    const customer = await prisma.customer.create({
      data: {
        organizationId,
        name: `${first} ${last}`,
        company,
        email: `${first.toLowerCase()}.${last.toLowerCase()}@${company.toLowerCase().replace(/[^a-z0-9]+/g, '')}.com`,
        phone: `+1-212-555-${String(1000 + i).slice(-4)}`,
        website: `https://${company.toLowerCase().replace(/[^a-z0-9]+/g, '')}.com`,
        status: pick(CUSTOMER_STATUSES, i),
        notes: `Primary contact at ${company}.`,
        projects: {
          connect: Array.from(new Set(linkedProjects.map((p) => p.id))).map((id) => ({ id })),
        },
      },
    });
    customers.push(customer);
  }
  console.log(`Seeded ${customers.length} customers.`);

  let emailCount = 0;
  for (let i = 0; i < 40; i++) {
    const customer = pick(customers, i);
    const direction = i % 2 === 0 ? 'OUTGOING' : 'INCOMING';
    const fromUs = pick(users, i + 1).email;
    await prisma.email.create({
      data: {
        organizationId,
        customerId: customer.id,
        projectId: i % 3 === 0 ? pick(projects, i).id : null,
        subject: pick(EMAIL_SUBJECTS, i),
        sender: direction === 'OUTGOING' ? fromUs : customer.email ?? 'unknown@example.com',
        recipient: direction === 'OUTGOING' ? customer.email ?? 'unknown@example.com' : fromUs,
        sentAt: daysFromNow(-60 + i * 2),
        direction,
      },
    });
    emailCount += 1;
  }
  console.log(`Seeded ${emailCount} emails.`);

  // ── Phase 3: Knowledge Graph demo data ──────────────────────────────────
  // Hand-authored Person/Company/Product/Event entities + Relationships +
  // TimelineEvents — the same shape `runSmartLinkingForDocument` produces
  // automatically from a real document upload, seeded directly here so
  // /graph isn't empty on first load. See docs/knowledge-graph.md.
  const seedCreatorId = owner.id;

  const SEED_COMPANIES = [
    'Nimbus Analytics Inc',
    'Brightline Logistics LLC',
    'Cascade Robotics Corp',
    'Ferrous Metals Group',
  ] as const;

  const companyEntities: Record<string, string> = {};
  for (const title of SEED_COMPANIES) {
    const entity = await prisma.entity.create({
      data: { organizationId, creatorId: seedCreatorId, entityType: 'COMPANY', title },
    });
    companyEntities[title] = entity.id;
    await prisma.timelineEvent.create({
      data: { organizationId, entityId: entity.id, eventType: 'CREATED', description: 'Seeded demo entity.' },
    });
  }
  console.log(`Seeded ${SEED_COMPANIES.length} graph companies.`);

  const SEED_PEOPLE = [
    { name: 'Elena Whitfield', email: 'elena@nimbusanalytics.example', jobTitle: 'CEO', company: 'Nimbus Analytics Inc' },
    { name: 'Marcus Ionescu', email: 'marcus@nimbusanalytics.example', jobTitle: 'CTO', company: 'Nimbus Analytics Inc' },
    { name: 'Priyanka Rao', email: 'priyanka@brightlinelogistics.example', jobTitle: 'VP Operations', company: 'Brightline Logistics LLC' },
    { name: 'Derek Osei', email: 'derek@cascaderobotics.example', jobTitle: 'Founder', company: 'Cascade Robotics Corp' },
    { name: 'Sofia Almeida', email: 'sofia@ferrousmetals.example', jobTitle: 'Procurement Lead', company: 'Ferrous Metals Group' },
  ] as const;

  const personEntities: Record<string, string> = {};
  for (const person of SEED_PEOPLE) {
    const entity = await prisma.entity.create({
      data: {
        organizationId,
        creatorId: seedCreatorId,
        entityType: 'PERSON',
        title: person.name,
        contact: {
          create: {
            organizationId,
            name: person.name,
            email: person.email,
            company: person.company,
            jobTitle: person.jobTitle,
          },
        },
      },
    });
    personEntities[person.name] = entity.id;
    await prisma.timelineEvent.create({
      data: { organizationId, entityId: entity.id, eventType: 'CREATED', description: 'Seeded demo entity.' },
    });
  }
  console.log(`Seeded ${SEED_PEOPLE.length} graph people.`);

  const SEED_PRODUCTS = [
    { title: 'Nimbus Insight Platform', company: 'Nimbus Analytics Inc' },
    { title: 'Brightline TrackPro', company: 'Brightline Logistics LLC' },
    { title: 'Cascade ArmOS', company: 'Cascade Robotics Corp' },
  ] as const;

  const productEntities: Record<string, string> = {};
  for (const product of SEED_PRODUCTS) {
    const entity = await prisma.entity.create({
      data: { organizationId, creatorId: seedCreatorId, entityType: 'PRODUCT', title: product.title },
    });
    productEntities[product.title] = entity.id;
    await prisma.timelineEvent.create({
      data: { organizationId, entityId: entity.id, eventType: 'CREATED', description: 'Seeded demo entity.' },
    });
  }
  console.log(`Seeded ${SEED_PRODUCTS.length} graph products.`);

  const SEED_EVENTS = ['TechForward Summit 2026', 'Q3 Partner Kickoff'] as const;
  const eventEntities: Record<string, string> = {};
  for (const title of SEED_EVENTS) {
    const entity = await prisma.entity.create({
      data: { organizationId, creatorId: seedCreatorId, entityType: 'EVENT', title },
    });
    eventEntities[title] = entity.id;
    await prisma.timelineEvent.create({
      data: { organizationId, entityId: entity.id, eventType: 'CREATED', description: 'Seeded demo entity.' },
    });
  }
  console.log(`Seeded ${SEED_EVENTS.length} graph events.`);

  async function seedRelationship(
    sourceEntityId: string,
    targetEntityId: string,
    relationshipType: RelationshipType,
    confidence = 1,
  ): Promise<void> {
    await prisma.relationship.create({
      data: { organizationId, sourceEntityId, targetEntityId, relationshipType, confidence, createdById: seedCreatorId },
    });
    await prisma.timelineEvent.createMany({
      data: [
        { organizationId, entityId: sourceEntityId, eventType: 'CONNECTED', description: `Linked via ${relationshipType}.` },
        { organizationId, entityId: targetEntityId, eventType: 'CONNECTED', description: `Linked via ${relationshipType}.` },
      ],
    });
  }

  let graphRelationshipCount = 0;
  for (const person of SEED_PEOPLE) {
    await seedRelationship(personEntities[person.name]!, companyEntities[person.company]!, 'WORKS_AT');
    graphRelationshipCount += 1;
  }
  for (const product of SEED_PRODUCTS) {
    await seedRelationship(companyEntities[product.company]!, productEntities[product.title]!, 'OWNS');
    graphRelationshipCount += 1;
  }

  const summitId = eventEntities['TechForward Summit 2026']!;
  const kickoffId = eventEntities['Q3 Partner Kickoff']!;
  await seedRelationship(personEntities['Elena Whitfield']!, summitId, 'ATTENDED', 0.9);
  await seedRelationship(personEntities['Derek Osei']!, summitId, 'ATTENDED', 0.9);
  await seedRelationship(personEntities['Marcus Ionescu']!, kickoffId, 'ATTENDED', 0.9);
  await seedRelationship(personEntities['Priyanka Rao']!, kickoffId, 'ATTENDED', 0.9);
  graphRelationshipCount += 4;

  await seedRelationship(
    productEntities['Cascade ArmOS']!,
    productEntities['Nimbus Insight Platform']!,
    'RELATED_TO',
    0.7,
  );
  graphRelationshipCount += 1;

  console.log(`Seeded ${graphRelationshipCount} graph relationships.`);

  // ── Phase 4: AI Memory & Retrieval demo embeddings ────────────────────
  // A handful of real Embedding rows via the zero-config local provider —
  // demonstrates the MEETING/EMAIL source types end-to-end.
  const embeddingProvider = createEmbeddingProvider({ provider: 'LOCAL' });
  const EMBEDDING_MODEL_LABEL = 'local-hash-v1';
  const EMBEDDING_VERSION = '1';

  const meetingsToEmbed = await prisma.meeting.findMany({
    where: { organizationId },
    take: 5,
    select: { id: true, agenda: true, notes: true },
  });

  let embeddingCount = 0;
  for (const meetingToEmbed of meetingsToEmbed) {
    const content = [meetingToEmbed.agenda, meetingToEmbed.notes].filter(Boolean).join('\n\n').trim();
    if (!content) continue;

    const vector = await embeddingProvider.generateEmbedding(content);
    await upsertEmbedding({
      organizationId,
      sourceType: 'MEETING',
      sourceId: meetingToEmbed.id,
      content,
      embeddingModel: EMBEDDING_MODEL_LABEL,
      embeddingVersion: EMBEDDING_VERSION,
      vector,
    });
    embeddingCount += 1;
  }

  const emailsToEmbed = await prisma.email.findMany({
    where: { organizationId },
    take: 5,
    select: { id: true, subject: true },
  });

  for (const emailToEmbed of emailsToEmbed) {
    const vector = await embeddingProvider.generateEmbedding(emailToEmbed.subject);
    await upsertEmbedding({
      organizationId,
      sourceType: 'EMAIL',
      sourceId: emailToEmbed.id,
      content: emailToEmbed.subject,
      embeddingModel: EMBEDDING_MODEL_LABEL,
      embeddingVersion: EMBEDDING_VERSION,
      vector,
    });
    embeddingCount += 1;
  }

  console.log(`Seeded ${embeddingCount} embeddings (local provider).`);

  console.log('\nDone. Sign up via /signup and create/join this organization to explore the seeded data,');
  console.log('or point your own account at it once you have a real login (see docs/Setup.md).');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
