'use client';

import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import type { DocumentDetail } from '@bond-os/database';
import { createDocumentMetadataSchema, DOCUMENT_TYPES, type CreateDocumentMetadataInput } from '@bond-os/shared';
import {
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
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

export interface DocumentEditDialogProps {
  trigger: React.ReactNode;
  document: DocumentDetail;
  projects: Array<{ id: string; title: string }>;
  meetings: Array<{ id: string; title: string }>;
}

/**
 * Metadata-only edit — re-uploading a new file means creating a new
 * document instead, so this reuses `createDocumentMetadataSchema` (rather
 * than the partial `updateDocumentSchema`) as the form resolver, the same
 * way `ProjectFormDialog` reuses its create schema for edit mode: every
 * field always has a concrete default from the existing document, and the
 * full object is sent on submit, which validates fine against the server's
 * partial update schema too.
 */
export function DocumentEditDialog({ trigger, document, projects, meetings }: DocumentEditDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  const form = useForm<CreateDocumentMetadataInput>({
    resolver: zodResolver(createDocumentMetadataSchema),
    defaultValues: {
      title: document.title,
      description: document.description ?? '',
      type: document.type,
      projectId: document.project?.id ?? null,
      meetingId: document.meeting?.id ?? null,
      taskIds: document.tasks.map((task) => task.id),
    },
  });

  async function onSubmit(values: CreateDocumentMetadataInput) {
    const response = await fetch(`/api/documents/${document.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const result = await response.json();

    if (!result.success) {
      toast.error(result.error.message);
      return;
    }

    toast.success('Document updated.');
    setOpen(false);
    router.refresh();
  }

  return (
    <Modal open={open} onOpenChange={setOpen}>
      <ModalTrigger asChild>{trigger}</ModalTrigger>
      <ModalContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <ModalHeader>
          <ModalTitle>Edit document</ModalTitle>
          <ModalDescription>Update the document metadata. To replace the file, upload a new document instead.</ModalDescription>
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
                    <Input {...field} />
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
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {DOCUMENT_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="projectId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project</FormLabel>
                    <Select value={field.value ?? 'NONE'} onValueChange={(v) => field.onChange(v === 'NONE' ? null : v)}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="No project" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="NONE">No project</SelectItem>
                        {projects.map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            {project.title}
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
                name="meetingId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Meeting</FormLabel>
                    <Select value={field.value ?? 'NONE'} onValueChange={(v) => field.onChange(v === 'NONE' ? null : v)}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="No meeting" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="NONE">No meeting</SelectItem>
                        {meetings.map((meeting) => (
                          <SelectItem key={meeting.id} value={meeting.id}>
                            {meeting.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
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
