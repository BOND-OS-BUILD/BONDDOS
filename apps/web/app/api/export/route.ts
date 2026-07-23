import { NextResponse } from 'next/server';

import { exportOrganizationDataService, type ExportResource } from '@/features/export/services/data-export.service';
import { apiHandler } from '@/lib/api-handler';

/**
 * Phase 11 — organization data export (ADMIN). Returns a downloadable JSON
 * bundle. `?types=projects,tasks,…` narrows the export; omit for everything.
 */
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (request) => {
  const typesParam = new URL(request.url).searchParams.get('types');
  const types = (typesParam ? typesParam.split(',').map((t) => t.trim()) : []) as ExportResource[];
  const bundle = await exportOrganizationDataService(types, new Date().toISOString());
  return NextResponse.json(bundle, {
    headers: { 'content-disposition': 'attachment; filename="bond-os-export.json"' },
  });
});
