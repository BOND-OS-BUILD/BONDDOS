import { requireRole } from '@bond-os/auth';
import {
  getObjectDefinitionByKey,
  listCustomers,
  listCustomRecords,
  listDocuments,
  listFieldDefinitions,
  listMeetings,
  listObjectDefinitions,
  listProjects,
  listTasks,
} from '@bond-os/database';
import { NotFoundError, ROLES } from '@bond-os/shared';

import { requireActiveOrganizationId } from '@/lib/organization';

/**
 * Phase 11 — organization data export (ADMIN). Produces a portable JSON bundle
 * by reusing the existing list repositories (capped per resource). The output
 * is deliberately plain data — no secrets, no internal ids beyond the rows'
 * own — so it can be archived, migrated, or re-imported.
 */

const EXPORT_CAP = 500;

export type ExportResource = 'projects' | 'tasks' | 'documents' | 'customers' | 'meetings' | 'custom-objects';

const ALL_RESOURCES: ExportResource[] = ['projects', 'tasks', 'documents', 'customers', 'meetings', 'custom-objects'];

export interface OrganizationExport {
  version: string;
  exportedAt: string;
  organizationId: string;
  resources: Record<string, unknown>;
}

export async function exportOrganizationDataService(
  requested: ExportResource[],
  exportedAtIso: string,
): Promise<OrganizationExport> {
  const organizationId = await requireActiveOrganizationId();
  await requireRole(organizationId, ROLES.ADMIN);

  const resources = requested.length > 0 ? requested : ALL_RESOURCES;
  const page = { page: 1, pageSize: EXPORT_CAP, sortDir: 'desc' as const };
  const out: Record<string, unknown> = {};

  if (resources.includes('projects')) out.projects = (await listProjects({ organizationId, ...page, sortBy: 'createdAt' })).items;
  if (resources.includes('tasks')) out.tasks = (await listTasks({ organizationId, ...page, sortBy: 'createdAt' })).items;
  if (resources.includes('documents')) out.documents = (await listDocuments({ organizationId, ...page, sortBy: 'createdAt' })).items;
  if (resources.includes('customers')) out.customers = (await listCustomers({ organizationId, ...page, sortBy: 'createdAt' })).items;
  if (resources.includes('meetings')) out.meetings = (await listMeetings({ organizationId, ...page, sortBy: 'meetingDate' })).items;

  if (resources.includes('custom-objects')) {
    const definitions = await listObjectDefinitions(organizationId);
    out.customObjects = await Promise.all(
      definitions.map(async (definition) => ({
        key: definition.key,
        name: definition.name,
        fields: (await listFieldDefinitions(definition.id)).map((field) => ({
          key: field.key,
          label: field.label,
          fieldType: field.fieldType,
          required: field.required,
          options: field.options,
        })),
        records: (await listCustomRecords({ organizationId, objectKey: definition.key, pageSize: EXPORT_CAP })).items.map(
          (record) => ({ id: record.id, title: record.title, values: record.values }),
        ),
      })),
    );
  }

  return { version: '1.0', exportedAt: exportedAtIso, organizationId, resources: out };
}

// ── CSV export for a custom object's records ───────────────────────────────

function csvEscape(value: unknown): string {
  if (value === undefined || value === null) return '';
  const text = Array.isArray(value) ? value.join('; ') : typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function exportCustomRecordsCsvService(objectKey: string): Promise<{ filename: string; csv: string }> {
  const organizationId = await requireActiveOrganizationId();
  await requireRole(organizationId, ROLES.MEMBER);

  const definition = await getObjectDefinitionByKey(organizationId, objectKey);
  if (!definition) throw new NotFoundError('Custom object not found.');
  const fields = await listFieldDefinitions(definition.id);
  const { items } = await listCustomRecords({ organizationId, objectKey, pageSize: EXPORT_CAP });

  const header = ['id', 'title', ...fields.map((field) => field.key)];
  const rows = items.map((record) => [
    record.id,
    record.title,
    ...fields.map((field) => csvEscape(record.values[field.key])),
  ]);
  const csv = [header.map(csvEscape).join(','), ...rows.map((row) => row.join(','))].join('\n');
  return { filename: `${objectKey}-records.csv`, csv };
}
