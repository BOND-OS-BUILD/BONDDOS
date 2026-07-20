'use client';

import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import type { FolderNode } from '@bond-os/database';
import { createFolderSchema, type CreateFolderInput } from '@bond-os/shared';
import {
  Button,
  ConfirmDialog,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Modal,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@bond-os/ui';
import { FolderPlus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

function buildTree(folders: FolderNode[]): Map<string | null, FolderNode[]> {
  const byParent = new Map<string | null, FolderNode[]>();
  for (const folder of folders) {
    const key = folder.parentFolderId;
    const list = byParent.get(key) ?? [];
    list.push(folder);
    byParent.set(key, list);
  }
  return byParent;
}

function CreateFolderDialog({ folders }: { folders: FolderNode[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  const form = useForm<CreateFolderInput>({
    resolver: zodResolver(createFolderSchema),
    defaultValues: { name: '', parentFolderId: null },
  });

  async function onSubmit(values: CreateFolderInput) {
    const response = await fetch('/api/library/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const result = await response.json();
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success('Folder created.');
    setOpen(false);
    form.reset();
    router.refresh();
  }

  return (
    <Modal open={open} onOpenChange={setOpen}>
      <ModalTrigger asChild>
        <Button>
          <FolderPlus className="mr-2 h-4 w-4" />
          New folder
        </Button>
      </ModalTrigger>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>New folder</ModalTitle>
        </ModalHeader>
        <Form {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Contracts" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="parentFolderId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Parent folder</FormLabel>
                  <Select value={field.value ?? 'NONE'} onValueChange={(v) => field.onChange(v === 'NONE' ? null : v)}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Top level" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="NONE">Top level</SelectItem>
                      {folders.map((folder) => (
                        <SelectItem key={folder.id} value={folder.id}>
                          {folder.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <ModalFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                Create
              </Button>
            </ModalFooter>
          </form>
        </Form>
      </ModalContent>
    </Modal>
  );
}

function FolderRow({ folder, depth, byParent }: { folder: FolderNode; depth: number; byParent: Map<string | null, FolderNode[]> }) {
  const router = useRouter();
  const children = byParent.get(folder.id) ?? [];

  async function handleDelete() {
    const response = await fetch(`/api/library/folders/${folder.id}`, { method: 'DELETE' });
    const result = await response.json();
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success('Folder deleted.');
    router.refresh();
  }

  return (
    <>
      <div
        className="flex items-center justify-between rounded-md border border-border p-3 text-sm"
        style={{ marginLeft: depth * 20 }}
      >
        <div>
          <p className="font-medium">{folder.name}</p>
          <p className="text-xs text-muted-foreground">{folder.documentCount} document(s)</p>
        </div>
        <ConfirmDialog
          trigger={
            <button
              type="button"
              className="rounded-sm p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
              aria-label={`Delete ${folder.name}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          }
          title={`Delete "${folder.name}"?`}
          description="Documents inside are not deleted — they just become unfiled. Sub-folders are deleted too."
          onConfirm={handleDelete}
        />
      </div>
      {children.map((child) => (
        <FolderRow key={child.id} folder={child} depth={depth + 1} byParent={byParent} />
      ))}
    </>
  );
}

export function FolderManager({ folders }: { folders: FolderNode[] }) {
  const byParent = buildTree(folders);
  const roots = byParent.get(null) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <CreateFolderDialog folders={folders} />
      </div>
      {folders.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">No folders yet.</p>
      ) : (
        <div className="space-y-2">
          {roots.map((folder) => (
            <FolderRow key={folder.id} folder={folder} depth={0} byParent={byParent} />
          ))}
        </div>
      )}
    </div>
  );
}
