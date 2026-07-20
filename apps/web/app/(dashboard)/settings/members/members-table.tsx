'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { MoreHorizontal } from 'lucide-react';

import { addMemberSchema, type AddMemberInput, type ApiResponse, ROLES, type Role } from '@bond-os/shared';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@bond-os/ui';

export interface MemberDto {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  avatar: string | null;
  role: Role;
  joinedAt: string;
}

interface MembersTableProps {
  organizationId: string;
  initialMembers: MemberDto[];
  canManage: boolean;
  callerRole: Role;
  currentUserId: string;
}

const ROLE_OPTIONS: Role[] = [ROLES.OWNER, ROLES.ADMIN, ROLES.MEMBER];

const ROLE_BADGE_VARIANT: Record<Role, 'default' | 'secondary' | 'outline'> = {
  OWNER: 'default',
  ADMIN: 'secondary',
  MEMBER: 'outline',
};

function formatRoleLabel(role: Role): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

function formatJoinedDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function MembersTable({ organizationId, initialMembers, canManage, callerRole, currentUserId }: MembersTableProps) {
  const router = useRouter();
  const [members, setMembers] = useState<MemberDto[]>(initialMembers);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  const callerIsOwner = callerRole === ROLES.OWNER;
  const ownerCount = members.filter((member) => member.role === ROLES.OWNER).length;

  const addForm = useForm<AddMemberInput>({
    resolver: zodResolver(addMemberSchema),
    defaultValues: { email: '', role: ROLES.MEMBER },
  });

  async function onAddMember(values: AddMemberInput) {
    setIsAdding(true);
    try {
      const response = await fetch(`/api/organization/${organizationId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const result = (await response.json()) as ApiResponse<MemberDto>;

      if (!result.success) {
        toast.error(result.error.message);
        return;
      }

      setMembers((current) => [...current, result.data]);
      toast.success('Member added.');
      addForm.reset({ email: '', role: ROLES.MEMBER });
      setIsAddOpen(false);
      router.refresh();
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setIsAdding(false);
    }
  }

  async function handleRoleChange(userId: string, role: Role) {
    setPendingUserId(userId);
    try {
      const response = await fetch(`/api/organization/${organizationId}/members/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const result = (await response.json()) as ApiResponse<MemberDto>;

      if (!result.success) {
        toast.error(result.error.message);
        return;
      }

      setMembers((current) => current.map((member) => (member.userId === userId ? result.data : member)));
      toast.success('Role updated.');
      router.refresh();
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setPendingUserId(null);
    }
  }

  async function handleRemove(userId: string) {
    setPendingUserId(userId);
    try {
      const response = await fetch(`/api/organization/${organizationId}/members/${userId}`, {
        method: 'DELETE',
      });
      const result = (await response.json()) as ApiResponse<{ removed: boolean }>;

      if (!result.success) {
        toast.error(result.error.message);
        return;
      }

      setMembers((current) => current.filter((member) => member.userId !== userId));
      toast.success('Member removed.');
      router.refresh();
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setPendingUserId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Members</h2>
          <p className="text-sm text-muted-foreground">
            {members.length} {members.length === 1 ? 'member' : 'members'} in this organization.
          </p>
        </div>
        {canManage && (
          <Modal open={isAddOpen} onOpenChange={setIsAddOpen}>
            <ModalTrigger asChild>
              <Button>Add member</Button>
            </ModalTrigger>
            <ModalContent>
              <ModalHeader>
                <ModalTitle>Add member</ModalTitle>
                <ModalDescription>Invite an existing BOND OS user to this organization by email.</ModalDescription>
              </ModalHeader>
              <Form {...addForm}>
                <form onSubmit={addForm.handleSubmit(onAddMember)} className="space-y-4">
                  <FormField
                    control={addForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="teammate@company.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={addForm.control}
                    name="role"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Role</FormLabel>
                        <FormControl>
                          <select
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            {...field}
                          >
                            <option value={ROLES.MEMBER}>Member</option>
                            <option value={ROLES.ADMIN}>Admin</option>
                            {callerIsOwner && <option value={ROLES.OWNER}>Owner</option>}
                          </select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <ModalFooter>
                    <Button type="submit" disabled={isAdding}>
                      {isAdding ? 'Adding…' : 'Add member'}
                    </Button>
                  </ModalFooter>
                </form>
              </Form>
            </ModalContent>
          </Modal>
        )}
      </div>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Joined</TableHead>
              {canManage && <TableHead className="w-12 text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => {
              const isOwnerRow = member.role === ROLES.OWNER;
              const isLastOwner = isOwnerRow && ownerCount <= 1;
              const canModifyRow = canManage && (!isOwnerRow || callerIsOwner);

              return (
                <TableRow key={member.membershipId}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        {member.avatar ? <AvatarImage src={member.avatar} alt="" /> : null}
                        <AvatarFallback className="text-xs">{member.name.charAt(0).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {member.name}
                          {member.userId === currentUserId && (
                            <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>
                          )}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={ROLE_BADGE_VARIANT[member.role]}>{member.role}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatJoinedDate(member.joinedAt)}</TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      {canModifyRow ? (
                        <Dropdown>
                          <DropdownTrigger asChild>
                            <Button variant="ghost" size="icon" disabled={pendingUserId === member.userId}>
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="sr-only">Member actions</span>
                            </Button>
                          </DropdownTrigger>
                          <DropdownContent align="end" className="w-48">
                            <DropdownLabel>Change role</DropdownLabel>
                            {ROLE_OPTIONS.filter((role) => role !== ROLES.OWNER || callerIsOwner).map((role) => (
                              <DropdownItem
                                key={role}
                                disabled={role === member.role || (isLastOwner && role !== ROLES.OWNER)}
                                onClick={() => handleRoleChange(member.userId, role)}
                                className="cursor-pointer"
                              >
                                {formatRoleLabel(role)}
                              </DropdownItem>
                            ))}
                            <DropdownSeparator />
                            <DropdownItem
                              disabled={isLastOwner}
                              onClick={() => handleRemove(member.userId)}
                              className="cursor-pointer text-destructive focus:text-destructive"
                            >
                              Remove member
                            </DropdownItem>
                          </DropdownContent>
                        </Dropdown>
                      ) : null}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
