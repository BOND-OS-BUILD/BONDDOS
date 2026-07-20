import {
  requireRole,
} from '@bond-os/auth';
import {
  searchEntities,
  type CustomerListItem,
  type DocumentListItem,
  type EntitySearchResult,
  type MeetingListItem,
  type ProjectListItem,
  type TaskListItem,
} from '@bond-os/database';
import { ROLES } from '@bond-os/shared';

import { listCustomersService } from '@/features/customers/services/customer.service';
import { listDocumentsService } from '@/features/documents/services/document.service';
import { listMeetingsService } from '@/features/meetings/services/meeting.service';
import { listProjectsService } from '@/features/projects/services/project.service';
import { listTasksService } from '@/features/tasks/services/task.service';

const RESULTS_PER_TYPE = 5;

export interface SearchResults {
  projects: ProjectListItem[];
  tasks: TaskListItem[];
  documents: DocumentListItem[];
  meetings: MeetingListItem[];
  customers: CustomerListItem[];
  /**
   * Phase 2's Universal Entity System (Library documents, Contacts,
   * Websites, and future connector-sourced content) via real PostgreSQL
   * full-text search (`packages/database/src/repositories/search.ts`) —
   * title/snippet/score, not the simple `contains` filter the five Phase 1
   * sections above use. Additive only: nothing above this comment changed.
   */
  library: EntitySearchResult[];
}

/**
 * Metadata-only search — fans out to each entity's own `list*Service` with
 * `search: q` and a small page size, top N per type. No AI/embeddings/
 * semantic matching, just each repository's existing `contains`/insensitive
 * filter (Phase 1 types) or Postgres full-text search (Phase 2 `Entity`
 * types), reused rather than reimplemented.
 */
export async function searchService(organizationId: string, q: string): Promise<SearchResults> {
  await requireRole(organizationId, ROLES.MEMBER);
  const pageArgs = { page: 1, pageSize: RESULTS_PER_TYPE, search: q, sortDir: 'desc' as const };

  const [projects, tasks, documents, meetings, customers, library] = await Promise.all([
    listProjectsService(organizationId, { ...pageArgs, sortBy: 'createdAt' }),
    listTasksService(organizationId, { ...pageArgs, sortBy: 'createdAt' }),
    listDocumentsService(organizationId, { ...pageArgs, sortBy: 'createdAt' }),
    listMeetingsService(organizationId, { ...pageArgs, sortBy: 'meetingDate' }),
    listCustomersService(organizationId, { ...pageArgs, sortBy: 'createdAt' }),
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
