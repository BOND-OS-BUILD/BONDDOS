'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ROUTES } from '@bond-os/shared';
import { cn } from '@bond-os/ui';

interface AiNavItem {
  href: string;
  label: string;
}

const NAV_ITEMS: AiNavItem[] = [
  { href: ROUTES.ai, label: 'Settings' },
  { href: ROUTES.aiModels, label: 'Models' },
  { href: ROUTES.aiEmbeddings, label: 'Embeddings' },
  { href: ROUTES.aiRetrieval, label: 'Retrieval' },
  { href: ROUTES.aiCost, label: 'Cost' },
  { href: ROUTES.memory, label: 'Memory Status' },
];

export function AiNav() {
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
