import { requireRole } from '@bond-os/auth';
import { getEmbeddingStats, getGraphAnalytics, prisma } from '@bond-os/database';
import { NotFoundError, ROLES } from '@bond-os/shared';

import { getEntityDetailService, type EntityDetail } from '@/features/graph/services/graph.service';

/**
 * Memory Service (spec §8): deterministic long-term/entity/project/customer
 * memory — joins and aggregations over existing Phase 1/2/3 data. No
 * summarization, no generated text; "memory" means "everything already
 * known about X, pre-assembled," not an AI's recollection of it.
 */

/** Reuses Phase 3's Entity Viewer data wholesale — entity memory IS the entity's full graph detail, nothing new to compute. */
export async function getEntityMemoryService(organizationId: string, entityId: string): Promise<EntityDetail> {
  return getEntityDetailService(organizationId, entityId);
}

export interface ProjectMemory {
  project: { id: string; title: string; description: string | null; status: string };
  tasks: Array<{ id: string; title: string; status: string }>;
  meetings: Array<{ id: string; title: string; meetingDate: Date }>;
  documents: Array<{ id: string; title: string }>;
  emails: Array<{ id: string; subject: string; sentAt: Date }>;
  customers: Array<{ id: string; name: string }>;
}

export async function getProjectMemoryService(organizationId: string, projectId: string): Promise<ProjectMemory> {
  await requireRole(organizationId, ROLES.MEMBER);

  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      tasks: { select: { id: true, title: true, status: true } },
      meetings: { select: { id: true, title: true, meetingDate: true } },
      documents: { select: { id: true, title: true } },
      emails: { select: { id: true, subject: true, sentAt: true } },
      customers: { select: { id: true, name: true } },
    },
  });
  if (!project) throw new NotFoundError('Project not found.');

  const { tasks, meetings, documents, emails, customers, ...projectFields } = project;
  return { project: projectFields, tasks, meetings, documents, emails, customers };
}

export interface CustomerMemory {
  customer: { id: string; name: string; company: string | null; status: string };
  emails: Array<{ id: string; subject: string; sentAt: Date; direction: string }>;
  projects: Array<{ id: string; title: string }>;
}

export async function getCustomerMemoryService(organizationId: string, customerId: string): Promise<CustomerMemory> {
  await requireRole(organizationId, ROLES.MEMBER);

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, organizationId },
    select: {
      id: true,
      name: true,
      company: true,
      status: true,
      emails: { select: { id: true, subject: true, sentAt: true, direction: true } },
      projects: { select: { id: true, title: true } },
    },
  });
  if (!customer) throw new NotFoundError('Customer not found.');

  const { emails, projects, ...customerFields } = customer;
  return { customer: customerFields, emails, projects };
}

export interface OrganizationMemory {
  totalEntities: number;
  totalRelationships: number;
  totalEmbeddings: number;
  totalProjects: number;
  totalCustomers: number;
  recentlyAdded: Array<{ id: string; title: string; entityType: string; createdAt: Date }>;
}

/** "Long-term memory" — the org-wide, always-current snapshot; also backs the Memory Status page. */
export async function getOrganizationMemoryService(organizationId: string): Promise<OrganizationMemory> {
  await requireRole(organizationId, ROLES.MEMBER);

  const [graphAnalytics, embeddingStats, totalProjects, totalCustomers] = await Promise.all([
    getGraphAnalytics(organizationId),
    getEmbeddingStats(organizationId),
    prisma.project.count({ where: { organizationId } }),
    prisma.customer.count({ where: { organizationId } }),
  ]);

  return {
    totalEntities: graphAnalytics.totalEntities,
    totalRelationships: graphAnalytics.totalRelationships,
    totalEmbeddings: embeddingStats.total,
    totalProjects,
    totalCustomers,
    recentlyAdded: graphAnalytics.recentlyAdded,
  };
}
