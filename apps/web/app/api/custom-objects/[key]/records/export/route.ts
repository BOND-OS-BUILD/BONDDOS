import { exportCustomRecordsCsvService } from '@/features/export/services/data-export.service';
import { apiHandler } from '@/lib/api-handler';

type Context = { params: Promise<{ key: string }> };

/** Phase 11 — export a custom object's records as CSV (MEMBER). */
export const dynamic = 'force-dynamic';

export const GET = apiHandler<Context>(async (_request, { params }) => {
  const { key } = await params;
  const { filename, csv } = await exportCustomRecordsCsvService(key);
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });
});
