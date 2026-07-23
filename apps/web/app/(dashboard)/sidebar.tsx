'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  BarChart3,
  Bot,
  Brain,
  Building2,
  Cable,
  Code2,
  Contact,
  FileText,
  FolderKanban,
  Gauge,
  History,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  Library,
  ListTodo,
  type LucideIcon,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  UsersRound,
  Video,
  Workflow,
} from 'lucide-react';

import { ROUTES } from '@bond-os/shared';
import { cn } from '@bond-os/ui';

import { useUiStore } from '@/store/ui-store';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { href: ROUTES.dashboard, label: 'Dashboard', icon: LayoutDashboard },
  { href: ROUTES.inbox, label: 'Inbox', icon: Inbox },
  { href: ROUTES.search, label: 'Search', icon: Search },
  { href: ROUTES.memory, label: 'Memory', icon: Brain },
  { href: ROUTES.company, label: 'Company', icon: Building2 },
  { href: ROUTES.projects, label: 'Projects', icon: FolderKanban },
  { href: ROUTES.tasks, label: 'Tasks', icon: ListTodo },
  { href: ROUTES.documents, label: 'Documents', icon: FileText },
  { href: ROUTES.meetings, label: 'Meetings', icon: Video },
  { href: ROUTES.customers, label: 'Customers', icon: Contact },
  { href: ROUTES.library, label: 'Library', icon: Library },
  { href: ROUTES.connectors, label: 'Connectors', icon: Cable },
  { href: ROUTES.sync, label: 'Sync', icon: RefreshCw },
  { href: ROUTES.graph, label: 'Knowledge Graph', icon: Network },
  { href: ROUTES.ai, label: 'AI', icon: Sparkles },
  { href: ROUTES.bond, label: 'Mr. Bond', icon: Bot },
  { href: ROUTES.agents, label: 'Agents', icon: UsersRound },
  { href: ROUTES.workflows, label: 'Workflows', icon: Workflow },
  { href: ROUTES.executionHistory, label: 'Execution History', icon: History },
  { href: ROUTES.spaces, label: 'Spaces', icon: LayoutGrid },
  { href: ROUTES.activity, label: 'Activity', icon: Activity },
  { href: ROUTES.teamDashboard, label: 'Team Dashboard', icon: Gauge },
  { href: ROUTES.people, label: 'People', icon: Users },
  { href: ROUTES.integrations, label: 'Integrations', icon: Plug },
  { href: ROUTES.analytics, label: 'Analytics', icon: BarChart3 },
  { href: ROUTES.developer, label: 'Developer', icon: Code2 },
  { href: ROUTES.settings, label: 'Settings', icon: Settings },
];

function isNavItemActive(pathname: string, href: string): boolean {
  if (
    href === ROUTES.settings ||
    href === ROUTES.library ||
    href === ROUTES.graph ||
    href === ROUTES.ai ||
    href === ROUTES.bond ||
    href === ROUTES.agents ||
    href === ROUTES.workflows ||
    href === ROUTES.spaces ||
    href === ROUTES.developer ||
    href === ROUTES.admin
  ) {
    return pathname.startsWith(href);
  }
  return pathname === href;
}

export function Sidebar({ isPlatformAdmin = false }: { isPlatformAdmin?: boolean }) {
  const pathname = usePathname();
  const { sidebarCollapsed, toggleSidebar } = useUiStore();

  const navItems = isPlatformAdmin
    ? [...NAV_ITEMS, { href: ROUTES.admin, label: 'Admin', icon: ShieldCheck }]
    : NAV_ITEMS;

  return (
    <aside
      className={cn(
        'sticky top-0 flex h-screen shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200',
        sidebarCollapsed ? 'w-16' : 'w-56',
      )}
    >
      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {navItems.map((item) => {
          const active = isNavItemActive(pathname, item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              title={sidebarCollapsed ? item.label : undefined}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                sidebarCollapsed && 'justify-center px-0',
              )}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-2">
        <button
          type="button"
          onClick={toggleSidebar}
          className={cn(
            'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground',
            sidebarCollapsed && 'justify-center px-0',
          )}
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen className="h-5 w-5 shrink-0" />
          ) : (
            <PanelLeftClose className="h-5 w-5 shrink-0" />
          )}
          {!sidebarCollapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
