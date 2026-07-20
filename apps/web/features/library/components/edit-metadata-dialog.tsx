'use client';

import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import type { FolderNode, KnowledgeDocumentDetail, TagSummary } from '@bond-os/database';
import { updateKnowledgeDocumentSchema, type UpdateKnowledgeDocumentInput } from '@bond-os/shared';
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

export interface EditMetadataDialogProps {
  trigger: React.ReactNode;
  document: KnowledgeDocumentDetail;
  folders: FolderNode[];
  tags: TagSummary[];
}

export function EditMetadataDialog({ trigger, document, folders, tags }: EditMetadataDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  const form = useForm<UpdateKnowledgeDocumentInput>({
    resolver: zodResolver(updateKnowledgeDocumentSchema),
    defaultValues: {
      title: document.title,
      description: document.description,
      folderId: document.folder?.id ?? null,
      tagIds: document.tags.map((tag) => tag.id),
    },
  });

  async function onSubmit(values: UpdateKnowledgeDocumentInput) {
    const response = await fetch(`/api/library/documents/${document.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const result = await response.json();

    if (!result.success) {
      toast.error(result.error.message);
      return;
    }

    toast.success('Updated.');
    setOpen(false);
    router.refresh();
  }

  return (
    <Modal open={open} onOpenChange={setOpen}>
      <ModalTrigger asChild>{trigger}</ModalTrigger>
      <ModalContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <ModalHeader>
          <ModalTitle>Edit details</ModalTitle>
          <ModalDescription>Metadata only — re-upload to replace the file itself.</ModalDescription>
        </ModalHeader>
        <Form {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} />
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
                    <Textarea rows={3} {...field} value={field.value ?? ''} />
                  </FormControl>
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
            {tags.length > 0 ? (
              <FormField
                control={form.control}
                name="tagIds"
                render={({ field }) => {
                  const value = field.value ?? [];
                  return (
                    <FormItem>
                      <FormLabel>Tags</FormLabel>
                      <div className="flex flex-wrap gap-3 rounded-md border border-input p-3">
                        {tags.map((tag) => {
                          const checked = value.includes(tag.id);
                          return (
                            <div key={tag.id} className="flex items-center gap-2">
                              <Checkbox
                                id={`edit-tag-${tag.id}`}
                                checked={checked}
                                onCheckedChange={(next) => {
                                  field.onChange(next ? [...value, tag.id] : value.filter((id) => id !== tag.id));
                                }}
                              />
                              <Label htmlFor={`edit-tag-${tag.id}`} className="cursor-pointer font-normal">
                                {tag.name}
                              </Label>
                            </div>
                          );
                        })}
                      </div>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
            ) : null}
            <ModalFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Saving…' : 'Save changes'}
              </Button>
            </ModalFooter>
          </form>
        </Form>
      </ModalContent>
    </Modal>
  );
}
