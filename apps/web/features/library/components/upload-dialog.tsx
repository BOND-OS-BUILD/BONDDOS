'use client';

import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import type { FolderNode, TagSummary } from '@bond-os/database';
import {
  createKnowledgeDocumentMetadataSchema,
  LIBRARY_ENTITY_TYPES,
  type CreateKnowledgeDocumentMetadataInput,
} from '@bond-os/shared';
import {
  Button,
  Checkbox,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Label,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from '@bond-os/ui';
import { useRouter } from 'next/navigation';

export interface UploadDialogProps {
  trigger: React.ReactNode;
  folders: FolderNode[];
  tags: TagSummary[];
  defaultEntityType?: 'DOCUMENT' | 'FILE';
}

/** Backs both the "Documents" and "Files" tabs on /library — same upload flow, different default entityType. */
export function UploadDialog({ trigger, folders, tags, defaultEntityType = 'DOCUMENT' }: UploadDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);

  const form = useForm<CreateKnowledgeDocumentMetadataInput>({
    resolver: zodResolver(createKnowledgeDocumentMetadataSchema),
    defaultValues: {
      title: '',
      description: '',
      entityType: defaultEntityType,
      folderId: null,
      tagIds: [],
    },
  });

  async function onSubmit(values: CreateKnowledgeDocumentMetadataInput) {
    if (!file) {
      setFileError('A file is required.');
      return;
    }
    setFileError(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', values.title);
    if (values.description) formData.append('description', values.description);
    formData.append('entityType', values.entityType);
    if (values.folderId) formData.append('folderId', values.folderId);
    for (const tagId of values.tagIds) formData.append('tagIds', tagId);

    const response = await fetch('/api/library/documents', { method: 'POST', body: formData });
    const result = await response.json();

    if (!result.success) {
      toast.error(result.error.message);
      return;
    }

    toast.success('Upload complete.');
    setOpen(false);
    form.reset();
    setFile(null);
    router.refresh();
  }

  return (
    <Modal open={open} onOpenChange={setOpen}>
      <ModalTrigger asChild>{trigger}</ModalTrigger>
      <ModalContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <ModalHeader>
          <ModalTitle>Upload to Library</ModalTitle>
          <ModalDescription>
            PDF, DOCX, TXT, Markdown, CSV, and images are supported. Text-based files are parsed and chunked
            automatically.
          </ModalDescription>
        </ModalHeader>
        <Form {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <div className="space-y-2">
              <Label htmlFor="library-file">File</Label>
              <Input
                id="library-file"
                type="file"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setFileError(null);
                }}
              />
              {fileError ? <p className="text-sm font-medium text-destructive">{fileError}</p> : null}
            </div>
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="Q3 roadmap deck" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea rows={3} placeholder="What is this?" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="entityType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Kind</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {LIBRARY_ENTITY_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type === 'DOCUMENT' ? 'Document' : 'File'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="folderId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Folder</FormLabel>
                    <Select value={field.value ?? 'NONE'} onValueChange={(v) => field.onChange(v === 'NONE' ? null : v)}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="No folder" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="NONE">No folder</SelectItem>
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
            </div>
            {tags.length > 0 ? (
              <FormField
                control={form.control}
                name="tagIds"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tags</FormLabel>
                    <div className="flex flex-wrap gap-3 rounded-md border border-input p-3">
                      {tags.map((tag) => {
                        const checked = field.value.includes(tag.id);
                        return (
                          <div key={tag.id} className="flex items-center gap-2">
                            <Checkbox
                              id={`tag-${tag.id}`}
                              checked={checked}
                              onCheckedChange={(next) => {
                                field.onChange(
                                  next ? [...field.value, tag.id] : field.value.filter((id) => id !== tag.id),
                                );
                              }}
                            />
                            <Label htmlFor={`tag-${tag.id}`} className="cursor-pointer font-normal">
                              {tag.name}
                            </Label>
                          </div>
                        );
                      })}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}
            <ModalFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Uploading…' : 'Upload'}
              </Button>
            </ModalFooter>
          </form>
        </Form>
      </ModalContent>
    </Modal>
  );
}
