import { getKnowledgeDocumentService } from '@/features/library/services/library.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

/** Exposes the Chunking Engine's output for a document as its own sub-resource. */
export const GET = apiHandler<Context>(async (_request, { params }) => {
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  const document = await getKnowledgeDocumentService(organizationId, id);
  return apiSuccess({ chunkCount: document.chunkCount, chunks: document.chunks });
});
