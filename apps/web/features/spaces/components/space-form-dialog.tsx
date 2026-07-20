'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { createSpaceSchema, type CreateSpaceInput } from '@bond-os/shared';
import {
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
  Textarea,
  Button,
  toast,
} from '@bond-os/ui';

export interface SpaceFormDialogProps {
  trigger: React.ReactNode;
  space?: { id: string; name: string; description: string | null };
}

/** Handles both create (no `space` prop) and edit (`space` provided). */
export function SpaceFormDialog({ trigger, space }: SpaceFormDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const isEdit = Boolean(space);

  const form = useForm<CreateSpaceInput>({
    resolver: zodResolver(createSpaceSchema),
    defaultValues: {
      name: space?.name ?? '',
      description: space?.description ?? null,
    },
  });

  async function onSubmit(values: CreateSpaceInput) {
    const url = isEdit ? `/api/spaces/${space!.id}` : '/api/spaces';
    const method = isEdit ? 'PATCH' : 'POST';

    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const result = await response.json();

    if (!result.success) {
      toast.error(result.error.message);
      return;
    }

    toast.success(isEdit ? 'Space updated.' : 'Space created.');
    setOpen(false);
    form.reset();
    router.refresh();
  }

  return (
    <Modal open={open} onOpenChange={setOpen}>
      <ModalTrigger asChild>{trigger}</ModalTrigger>
      <ModalContent className="sm:max-w-lg">
        <ModalHeader>
          <ModalTitle>{isEdit ? 'Edit space' : 'New space'}</ModalTitle>
          <ModalDescription>
            {isEdit
              ? 'Update this space\'s name and description.'
              : 'A space groups and curates projects, documents, workflows, and agents for a team — it doesn\'t restrict who can see them.'}
          </ModalDescription>
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
                    <Input placeholder="Engineering" {...field} />
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
                    <Textarea rows={3} placeholder="What this space is for" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <ModalFooter>
              <Button type="submit">{isEdit ? 'Save changes' : 'Create space'}</Button>
            </ModalFooter>
          </form>
        </Form>
      </ModalContent>
    </Modal>
  );
}
