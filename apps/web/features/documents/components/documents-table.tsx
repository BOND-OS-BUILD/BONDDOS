'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import type { DocumentListItem } from '@bond-os/database';
import {
  Avatar,
  AvatarFallback,
  Badge,
  ConfirmDialog,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@bond-os/ui';
import { Trash2 } from 'lucide-react';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex] ?? 'TB'}`;
}

export function DocumentsTable({ documents }: { documents: DocumentListItem[] }) {
  const router = useRouter();

  async function handleDelete(id: string) {
    const response = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
    const result = await response.json();
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success('Document deleted.');
    router.refresh();
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Project</TableHead>
          <TableHead>Uploaded by</TableHead>
          <TableHead>Size</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {documents.map((document) => (
          <TableRow key={document.id}>
            <TableCell className="font-medium">
              <Link href={`/documents/${document.id}`} className="hover:underline">
                {document.title}
              </Link>
            </TableCell>
            <TableCell>
              <Badge variant="outline">{document.type}</Badge>
            </TableCell>
            <TableCell>
              {document.project ? (
                <Link href={`/projects/${document.project.id}`} className="text-sm hover:underline">
                  {document.project.title}
                </Link>
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell>
              {document.uploadedBy ? (
                <div className="flex items-center gap-2">
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="text-xs">{document.uploadedBy.name.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm">{document.uploadedBy.name}</span>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">{formatBytes(document.size)}</TableCell>
            <TableCell>
              <ConfirmDialog
                trigger={
                  <button
                    type="button"
                    className="rounded-sm p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                    aria-label={`Delete ${document.title}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                }
                title={`Delete "${document.title}"?`}
                description="This permanently deletes the document and its file. This can't be undone."
                onConfirm={() => handleDelete(document.id)}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
