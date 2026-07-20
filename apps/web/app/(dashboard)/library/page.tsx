import Link from 'next/link';

import { listFolders, listTags } from '@bond-os/database';
import { knowledgeDocumentQuerySchema } from '@bond-os/shared';
import { Button, cn, EmptyState, Pagination, SearchInput } from '@bond-os/ui';
import { FolderOpen, Library as LibraryIcon, Upload } from 'lucide-react';

import { LibraryTable } from '@/features/library/components/library-table';
import { UploadDialog } from '@/features/library/components/upload-dialog';
import { listKnowledgeDocumentsService } from '@/features/library/services/library.service';
import { requireActiveOrganizationId } from '@/lib/organization';

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const organizationId = await requireActiveOrganizationId();
  const params = await searchParams;
  const activeTab = params.entityType === 'FILE' ? 'FILE' : 'DOCUMENT';
  const query = knowledgeDocumentQuerySchema.parse({ ...params, entityType: activeTab });

  const [result, folders, tags] = await Promise.all([
    listKnowledgeDocumentsService(organizationId, query),
    listFolders(organizationId),
    listTags(organizationId),
  ]);

  const makeHref = (page: number) => {
    const searchParamsOut = new URLSearchParams();
    searchParamsOut.set('entityType', activeTab);
    if (query.search) searchParamsOut.set('search', query.search);
    searchParamsOut.set('page', String(page));
    return `/library?${searchParamsOut.toString()}`;
  };

  const tabHref = (type: 'DOCUMENT' | 'FILE') => `/library?entityType=${type}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
          <p className="text-sm text-muted-foreground">Uploaded and ingested content, parsed and chunked for search.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/library/folders">
              <FolderOpen className="mr-2 h-4 w-4" />
              Manage folders
            </Link>
          </Button>
          <UploadDialog
            folders={folders}
            tags={tags}
            defaultEntityType={activeTab}
            trigger={
              <Button>
                <Upload className="mr-2 h-4 w-4" />
                Upload
              </Button>
            }
          />
        </div>
      </div>

      <div className="flex gap-1 border-b border-border">
        {(['DOCUMENT', 'FILE'] as const).map((type) => (
          <Link
            key={type}
            href={tabHref(type)}
            className={cn(
              'border-b-2 px-4 py-2 text-sm font-medium',
              activeTab === type
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {type === 'DOCUMENT' ? 'Documents' : 'Files'}
          </Link>
        ))}
      </div>

      <SearchInput placeholder="Search the library…" className="max-w-xs" />

      {result.items.length === 0 ? (
        <EmptyState
          icon={LibraryIcon}
          title={query.search ? 'No results' : 'Nothing here yet'}
          description={
            query.search ? 'Try a different search term.' : 'Upload a file to get started.'
          }
          action={
            !query.search ? (
              <UploadDialog
                folders={folders}
                tags={tags}
                defaultEntityType={activeTab}
                trigger={<Button variant="outline">Upload</Button>}
              />
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          <LibraryTable documents={result.items} />
          <Pagination page={result.page} totalPages={result.totalPages} makeHref={makeHref} />
        </div>
      )}
    </div>
  );
}
