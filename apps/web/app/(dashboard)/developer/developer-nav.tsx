'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ROUTES } from '@bond-os/shared';
import { cn } from '@bond-os/ui';

const NAV_ITEMS = [
  { href: ROUTES.developer, label: 'Portal' },
  { href: ROUTES.developerObjects, label: 'Custom Objects' },
  { href: ROUTES.developerForms, label: 'Forms' },
  { href: ROUTES.developerPlugins, label: 'Plugins' },
  { href: ROUTES.developerTemplates, label: 'Templates' },
];

export function DeveloperNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border pb-2">
      {NAV_ITEMS.map((item) => {
        const active = item.href === ROUTES.developer ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
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
