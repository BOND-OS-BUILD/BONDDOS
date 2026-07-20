'use client';

import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import type { CustomerDetail, CustomerListItem } from '@bond-os/database';
import { createCustomerSchema, CUSTOMER_STATUSES, type CreateCustomerInput } from '@bond-os/shared';
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

export interface CustomerFormDialogProps {
  trigger: React.ReactNode;
  projects: Array<{ id: string; title: string }>;
  customer?: CustomerDetail | CustomerListItem;
}

/** Handles both create (no `customer` prop) and edit (`customer` provided). */
export function CustomerFormDialog({ trigger, projects, customer }: CustomerFormDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const isEdit = Boolean(customer);

  const existingProjectIds = customer && 'projects' in customer ? customer.projects.map((project) => project.id) : [];

  const form = useForm<CreateCustomerInput>({
    resolver: zodResolver(createCustomerSchema),
    defaultValues: {
      name: customer?.name ?? '',
      company: customer?.company ?? null,
      email: customer?.email ?? null,
      phone: customer?.phone ?? null,
      website: customer?.website ?? null,
      status: customer?.status ?? 'LEAD',
      notes: customer?.notes ?? null,
      projectIds: existingProjectIds,
    },
  });

  async function onSubmit(values: CreateCustomerInput) {
    const url = isEdit ? `/api/customers/${customer!.id}` : '/api/customers';
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

    toast.success(isEdit ? 'Customer updated.' : 'Customer created.');
    setOpen(false);
    form.reset();
    router.refresh();
  }

  return (
    <Modal open={open} onOpenChange={setOpen}>
      <ModalTrigger asChild>{trigger}</ModalTrigger>
      <ModalContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <ModalHeader>
          <ModalTitle>{isEdit ? 'Edit customer' : 'New customer'}</ModalTitle>
          <ModalDescription>
            {isEdit ? 'Update the customer details.' : 'Add a new customer to your organization.'}
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
                    <Input placeholder="Jane Cooper" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="company"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Company</FormLabel>
                  <FormControl>
                    <Input placeholder="Acme Inc." {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="jane@acme.com"
                        value={field.value ?? ''}
                        onChange={(event) => field.onChange(event.target.value === '' ? null : event.target.value)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input placeholder="+1 (555) 000-0000" {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="website"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Website</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="https://acme.com"
                      value={field.value ?? ''}
                      onChange={(event) => field.onChange(event.target.value === '' ? null : event.target.value)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {CUSTOMER_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {status.charAt(0) + status.slice(1).toLowerCase()}
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
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea rows={3} placeholder="Anything worth remembering about this customer?" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="projectIds"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Projects</FormLabel>
                  <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border border-input p-3">
                    {projects.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No projects yet.</p>
                    ) : (
                      projects.map((project) => {
                        const checked = field.value.includes(project.id);
                        return (
                          <div key={project.id} className="flex items-center gap-2">
                            <Checkbox
                              id={`project-${project.id}`}
                              checked={checked}
                              onCheckedChange={(next) => {
                                field.onChange(
                                  next
                                    ? [...field.value, project.id]
                                    : field.value.filter((id) => id !== project.id),
                                );
                              }}
                            />
                            <Label htmlFor={`project-${project.id}`} className="cursor-pointer font-normal">
                              {project.title}
                            </Label>
                          </div>
                        );
                      })
                    )}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <ModalFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create customer'}
              </Button>
            </ModalFooter>
          </form>
        </Form>
      </ModalContent>
    </Modal>
  );
}
