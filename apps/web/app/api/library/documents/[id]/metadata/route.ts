import { getKnowledgeDocumentService } from '@/features/library/services/library.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

/** Exposes the Metadata Extractor's output for a document as its own sub-resource. */
export const GET = apiHandler<Context>(async (_request, { params }) => {
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  const document = await getKnowledgeDocumentService(organizationId, id);
  return apiSuccess({
    fileName: document.fileName,
    mimeType: document.mimeType,
    size: document.size,
    parseStatus: document.parseStatus,
    extracted: document.parsedMetadata,
  });
});
