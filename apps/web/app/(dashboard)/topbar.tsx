'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown } from 'lucide-react';

import { signOut } from '@bond-os/auth/client';
import { ROUTES, type OrganizationSummary } from '@bond-os/shared';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
  ThemeToggle,
} from '@bond-os/ui';

import { setActiveOrganization } from '@/app/(dashboard)/actions';
import { NotificationBell } from '@/features/notifications/components/notification-bell';

interface TopbarUser {
  name: string;
  email: string;
  avatar: string | null;
}

interface TopbarProps {
  organizations: OrganizationSummary[];
  active: OrganizationSummary;
  user: TopbarUser;
}

export function Topbar({ organizations, active, user }: TopbarProps) {
  const router = useRouter();

  async function handleSwitchOrganization(organizationId: string) {
    if (organizationId === active.id) {
      return;
    }
    await setActiveOrganization(organizationId);
    router.refresh();
  }

  function handleLogout() {
    void signOut({ fetchOptions: { onSuccess: () => router.push(ROUTES.login) } });
  }

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-border bg-background px-4">
      <Dropdown>
        <DropdownTrigger className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
          <Avatar className="h-7 w-7">
            {active.logo ? <AvatarImage src={active.logo} alt="" /> : null}
            <AvatarFallback className="text-xs">{active.name.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="max-w-[12rem] truncate">{active.name}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </DropdownTrigger>
        <DropdownContent align="start" className="w-64">
          <DropdownLabel>Organizations</DropdownLabel>
          <DropdownSeparator />
          {organizations.map((org) => (
            <DropdownItem
              key={org.id}
              onClick={() => handleSwitchOrganization(org.id)}
              className="flex cursor-pointer items-center gap-2"
            >
              <Avatar className="h-6 w-6">
                <AvatarFallback className="text-xs">{org.name.charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="flex-1 truncate">{org.name}</span>
              {org.id === active.id && <span className="text-xs text-muted-foreground">Current</span>}
            </DropdownItem>
          ))}
        </DropdownContent>
      </Dropdown>

      <div className="flex items-center gap-2">
        <NotificationBell />
        <ThemeToggle />
        <Dropdown>
          <DropdownTrigger className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Avatar className="h-8 w-8">
              {user.avatar ? <AvatarImage src={user.avatar} alt="" /> : null}
              <AvatarFallback>{user.name.charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
          </DropdownTrigger>
          <DropdownContent align="end" className="w-56">
            <DropdownLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="truncate text-sm font-medium">{user.name}</p>
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              </div>
            </DropdownLabel>
            <DropdownSeparator />
            <DropdownItem asChild className="cursor-pointer">
              <Link href={ROUTES.settingsProfile}>Profile</Link>
            </DropdownItem>
            <DropdownSeparator />
            <DropdownItem onClick={handleLogout} className="cursor-pointer">
              Log out
            </DropdownItem>
          </DropdownContent>
        </Dropdown>
      </div>
    </header>
  );
}
