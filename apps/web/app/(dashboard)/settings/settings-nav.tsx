'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ROUTES } from '@bond-os/shared';
import { cn } from '@bond-os/ui';

interface SettingsNavItem {
  href: string;
  label: string;
}

const NAV_ITEMS: SettingsNavItem[] = [
  { href: ROUTES.settingsProfile, label: 'Profile' },
  { href: ROUTES.settingsOrganization, label: 'Organization' },
  { href: ROUTES.settingsMembers, label: 'Members' },
  { href: ROUTES.settingsBilling, label: 'Billing' },
  { href: ROUTES.settingsApiKeys, label: 'API Keys' },
  { href: ROUTES.settingsPreferences, label: 'Preferences' },
];

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto pb-1 lg:w-48 lg:shrink-0 lg:flex-col lg:overflow-visible lg:pb-0">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'shrink-0 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
