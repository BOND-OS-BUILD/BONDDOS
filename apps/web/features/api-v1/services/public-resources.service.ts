import {
  getCustomerById,
  getDocumentById,
  getGraphAnalytics,
  getMeetingById,
  getProjectById,
  getTaskById,
  listCustomers,
  listDocuments,
  listMeetings,
  listNotificationsForUser,
  listProjects,
  listTasks,
  listWorkflowDefinitions,
  searchEntities,
  type CustomerDetail,
  type CustomerListItem,
  type DocumentDetail,
  type DocumentListItem,
  type EntitySearchResult,
  type GraphAnalytics,
  type MeetingDetail,
  type MeetingListItem,
  type NotificationData,
  type NotificationType,
  type ProjectDetail,
  type ProjectListItem,
  type TaskDetail,
  type TaskListItem,
} from '@bond-os/database';
import {
  NotFoundError,
  type CustomerQuery,
  type DocumentQuery,
  type MeetingQuery,
  type NotificationCategory,
  type PaginatedResult,
  type ProjectQuery,
  type TaskQuery,
} from '@bond-os/shared';

/**
 * Phase 11 — public API (`/api/v1`) read layer. Authentication and scope
 * authorization already happened in `apiV1Handler`; every function here is
 * strictly bound to a single `organizationId` and reuses the SAME repository
 * functions the dashboard does — no new query logic, no session/RBAC (that is
 * the API key's scope). This is deliberately read-only.
 */

const RESULTS_PER_TYPE = 5;

// ── Collections ───────────────────────────────────────────────────────────

export function listProjectsPublic(
  organizationId: string,
  query: ProjectQuery,
): Promise<PaginatedResult<ProjectListItem>> {
  return listProjects({ organizationId, ...query });
}

export function listTasksPublic(
  organizationId: string,
  query: TaskQuery,
): Promise<PaginatedResult<TaskListItem>> {
  return listTasks({ organizationId, ...query });
}

export function listDocumentsPublic(
  organizationId: string,
  query: DocumentQuery,
): Promise<PaginatedResult<DocumentListItem>> {
  return listDocuments({ organizationId, ...query });
}

export function listCustomersPublic(
  organizationId: string,
  query: CustomerQuery,
): Promise<PaginatedResult<CustomerListItem>> {
  return listCustomers({ organizationId, ...query });
}

export function listMeetingsPublic(
  organizationId: string,
  query: MeetingQuery,
): Promise<PaginatedResult<MeetingListItem>> {
  return listMeetings({ organizationId, ...query });
}

// ── Single resources (404 when absent or cross-org) ────────────────────────

export async function getProjectPublic(organizationId: string, id: string): Promise<ProjectDetail> {
  const project = await getProjectById(id, organizationId);
  if (!project) throw new NotFoundError('Project not found.');
  return project;
}

export async function getTaskPublic(organizationId: string, id: string): Promise<TaskDetail> {
  const task = await getTaskById(id, organizationId);
  if (!task) throw new NotFoundError('Task not found.');
  return task;
}

export async function getDocumentPublic(organizationId: string, id: string): Promise<DocumentDetail> {
  const document = await getDocumentById(id, organizationId);
  if (!document) throw new NotFoundError('Document not found.');
  return document;
}

export async function getCustomerPublic(organizationId: string, id: string): Promise<CustomerDetail> {
  const customer = await getCustomerById(id, organizationId);
  if (!customer) throw new NotFoundError('Customer not found.');
  return customer;
}

export async function getMeetingPublic(organizationId: string, id: string): Promise<MeetingDetail> {
  const meeting = await getMeetingById(id, organizationId);
  if (!meeting) throw new NotFoundError('Meeting not found.');
  return meeting;
}

// ── Search / graph / notifications ─────────────────────────────────────────

export interface PublicSearchResults {
  projects: ProjectListItem[];
  tasks: TaskListItem[];
  documents: DocumentListItem[];
  meetings: MeetingListItem[];
  customers: CustomerListItem[];
  library: EntitySearchResult[];
}

/** Metadata search across the org — mirrors the dashboard's fan-out, repo-direct. */
export async function searchPublic(organizationId: string, q: string): Promise<PublicSearchResults> {
  const pageArgs = { page: 1, pageSize: RESULTS_PER_TYPE, search: q, sortDir: 'desc' as const };
  const [projects, tasks, documents, meetings, customers, library] = await Promise.all([
    listProjects({ organizationId, ...pageArgs, sortBy: 'createdAt' }),
    listTasks({ organizationId, ...pageArgs, sortBy: 'createdAt' }),
    listDocuments({ organizationId, ...pageArgs, sortBy: 'createdAt' }),
    listMeetings({ organizationId, ...pageArgs, sortBy: 'meetingDate' }),
    listCustomers({ organizationId, ...pageArgs, sortBy: 'createdAt' }),
    searchEntities(organizationId, q, RESULTS_PER_TYPE),
  ]);
  return {
    projects: projects.items,
    tasks: tasks.items,
    documents: documents.items,
    meetings: meetings.items,
    customers: customers.items,
    library,
  };
}

export function graphAnalyticsPublic(organizationId: string): Promise<GraphAnalytics> {
  return getGraphAnalytics(organizationId);
}

export function listWorkflowsPublic(organizationId: string, query: { page?: number; pageSize?: number }) {
  return listWorkflowDefinitions({
    organizationId,
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 20,
  });
}

const CATEGORY_TYPES: Record<NotificationCategory, NotificationType[]> = {
  assigned: ['TASK_ASSIGNMENT'],
  mentions: ['MENTION'],
  approvals: ['APPROVAL_REQUEST'],
  ai_insights: ['AGENT_INSIGHT'],
  workflow_events: ['WORKFLOW_EVENT'],
  activity: ['PROJECT_UPDATE', 'MEETING_REMINDER', 'COMMENT', 'SYSTEM'],
};

export interface PublicNotificationsQuery {
  page: number;
  pageSize: number;
  read?: boolean;
  archived?: boolean;
  category?: NotificationCategory;
}

/** Personal notifications for the key's owner (requires a PERSONAL key → userId). */
export function listNotificationsPublic(
  organizationId: string,
  userId: string,
  query: PublicNotificationsQuery,
): Promise<PaginatedResult<NotificationData>> {
  return listNotificationsForUser({
    organizationId,
    userId,
    page: query.page,
    pageSize: query.pageSize,
    read: query.read,
    archived: query.archived,
    types: query.category ? CATEGORY_TYPES[query.category] : undefined,
  });
}
