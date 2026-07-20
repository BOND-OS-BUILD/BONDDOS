import Link from 'next/link';

import { FolderManager } from '@/features/library/components/folder-manager';
import { listFoldersService } from '@/features/library/services/folder.service';
import { requireActiveOrganizationId } from '@/lib/organization';

export default async function LibraryFoldersPage() {
  const organizationId = await requireActiveOrganizationId();
  const folders = await listFoldersService(organizationId);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/library" className="text-sm text-muted-foreground hover:underline">
          ← Back to Library
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Folders</h1>
        <p className="text-sm text-muted-foreground">Organize Library documents into folders.</p>
      </div>
      <FolderManager folders={folders} />
    </div>
  );
}
