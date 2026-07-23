import { z } from 'zod';

import { exportWorkflowAsTemplateService } from '@/features/templates/services/template.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

type Context = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  isPublic: z.boolean().optional(),
});

/** Phase 11 — export an existing workflow definition as a reusable template. */
export const dynamic = 'force-dynamic';

export const POST = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const body = await parseJsonBody(request, bodySchema);
  return apiSuccess(await exportWorkflowAsTemplateService(id, body), { status: 201 });
});
