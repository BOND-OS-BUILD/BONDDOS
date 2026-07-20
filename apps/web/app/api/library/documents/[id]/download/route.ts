import { getKnowledgeDocumentService } from '@/features/library/services/library.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';
import { getSignedDownloadUrl } from '@/lib/supabase';

type Context = { params: Promise<{ id: string }> };

/** Returns a short-lived signed download URL rather than streaming the file through this route. */
export const GET = apiHandler<Context>(async (_request, { params }) => {
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  const document = await getKnowledgeDocumentService(organizationId, id);
  const url = await getSignedDownloadUrl(document.storagePath);
  return apiSuccess({ url });
});
