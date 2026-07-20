import { listFolders, listTags } from '@bond-os/database';
import { Badge, Card, CardContent, CardHeader, CardTitle, Separator } from '@bond-os/ui';
import { FileText, Layers } from 'lucide-react';

import { DocumentDeleteButton } from '@/features/library/components/document-delete-button';
import { DownloadButton } from '@/features/library/components/download-button';
import { EditMetadataDialog } from '@/features/library/components/edit-metadata-dialog';
import { getKnowledgeDocumentService } from '@/features/library/services/library.service';
import { requireActiveOrganizationId } from '@/lib/organization';

const PARSE_STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  PENDING: 'secondary',
  PARSED: 'outline',
  FAILED: 'destructive',
  UNSUPPORTED: 'secondary',
};

const CHUNK_TYPE_LABEL: Record<string, string> = {
  PARAGRAPH: 'Paragraph',
  HEADING: 'Heading',
  TABLE: 'Table',
  LIST: 'List',
  CODE_BLOCK: 'Code',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex] ?? 'GB'}`;
}

export default async function DocumentViewerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();

  const [document, folders, tags] = await Promise.all([
    getKnowledgeDocumentService(organizationId, id),
    listFolders(organizationId),
    listTags(organizationId),
  ]);

  const metadata = (document.parsedMetadata ?? {}) as Record<string, unknown>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{document.title}</h1>
            <Badge variant={PARSE_STATUS_VARIANT[document.parseStatus] ?? 'outline'}>{document.parseStatus}</Badge>
          </div>
          {document.description ? <p className="max-w-2xl text-sm text-muted-foreground">{document.description}</p> : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <DownloadButton id={document.id} />
          <EditMetadataDialog
            document={document}
            folders={folders}
            tags={tags}
            trigger={
              <button className="text-sm font-medium underline underline-offset-4" type="button">
                Edit
              </button>
            }
          />
          <DocumentDeleteButton id={document.id} title={document.title} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <p className="text-muted-foreground">File name</p>
          <p className="truncate font-medium">{document.fileName}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Size</p>
          <p className="font-medium">{formatBytes(document.size)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Uploaded by</p>
          <p className="font-medium">{document.uploadedBy?.name ?? 'Unknown'}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Folder</p>
          <p className="font-medium">{document.folder?.name ?? 'None'}</p>
        </div>
        {typeof metadata.author === 'string' ? (
          <div>
            <p className="text-muted-foreground">Author</p>
            <p className="font-medium">{metadata.author}</p>
          </div>
        ) : null}
        {typeof metadata.pageCount === 'number' ? (
          <div>
            <p className="text-muted-foreground">Pages</p>
            <p className="font-medium">{metadata.pageCount}</p>
          </div>
        ) : null}
      </div>

      {document.tags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {document.tags.map((tag) => (
            <Badge key={tag.id} variant="secondary">
              {tag.name}
            </Badge>
          ))}
        </div>
      ) : null}

      <Separator />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" /> Extracted text
            </CardTitle>
          </CardHeader>
          <CardContent>
            {document.parseStatus === 'PARSED' && document.parsedText ? (
              <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs text-muted-foreground">
                {document.parsedText.slice(0, 8000)}
                {document.parsedText.length > 8000 ? '\n…' : ''}
              </pre>
            ) : document.parseStatus === 'PENDING' ? (
              <p className="text-sm text-muted-foreground">Parsing hasn&apos;t run yet.</p>
            ) : document.parseStatus === 'FAILED' ? (
              <p className="text-sm text-muted-foreground">Parsing failed for this file.</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                No text extraction for this file type — it&apos;s stored, but not parsed or chunked.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4" /> Chunks ({document.chunkCount})
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-96 space-y-2 overflow-y-auto">
            {document.chunks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No chunks yet.</p>
            ) : (
              document.chunks.map((chunk) => (
                <div key={chunk.id} className="rounded-md border border-border p-2 text-sm">
                  <div className="mb-1 flex items-center gap-2">
                    <Badge variant="outline">{CHUNK_TYPE_LABEL[chunk.chunkType] ?? chunk.chunkType}</Badge>
                    <span className="text-xs text-muted-foreground">#{chunk.position}</span>
                  </div>
                  <p className="line-clamp-3 text-muted-foreground">{chunk.content}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
