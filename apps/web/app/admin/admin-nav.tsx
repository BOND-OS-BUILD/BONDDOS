'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@bond-os/ui';

const ITEMS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/organizations', label: 'Organizations' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/sessions', label: 'Active Sessions' },
  { href: '/admin/workflow-runs', label: 'Workflow Runs' },
  { href: '/admin/tool-executions', label: 'Tool Executions' },
  { href: '/admin/audit-logs', label: 'Audit Logs' },
  { href: '/admin/security', label: 'Security' },
  { href: '/admin/errors', label: 'Errors' },
  { href: '/admin/health', label: 'System Health' },
  { href: '/admin/feature-flags', label: 'Feature Flags' },
  { href: '/admin/rate-limits', label: 'Rate Limits' },
  { href: '/admin/system-config', label: 'System Config' },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto">
      {ITEMS.map((item) => {
        const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'block rounded-md px-3 py-2 text-sm font-medium transition-colors',
              active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            {item.label}
          </Link>
        );
      })}
      <Link
        href="/dashboard"
        className="mt-4 block rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        ← Back to app
      </Link>
    </nav>
  );
}
