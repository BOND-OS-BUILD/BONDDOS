import Link from 'next/link';
import { BookOpen, Boxes, FileCode, KeyRound, Package, Puzzle, Webhook, Workflow } from 'lucide-react';

import { ROUTES } from '@bond-os/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@bond-os/ui';

/** Phase 11 — Developer Portal hub. Entry points to every extensibility surface. */
export const dynamic = 'force-dynamic';

const CARDS = [
  {
    href: '/api/v1/docs',
    external: true,
    icon: BookOpen,
    title: 'API Reference',
    description: 'Interactive Swagger UI for the public REST API. Authorize with an API key and try requests.',
  },
  {
    href: '/api/v1/openapi.json',
    external: true,
    icon: FileCode,
    title: 'OpenAPI Spec',
    description: 'The machine-readable OpenAPI 3.1 document — generate a typed client in any language.',
  },
  {
    href: ROUTES.settingsApiKeys,
    external: false,
    icon: KeyRound,
    title: 'API Keys',
    description: 'Create personal or organization keys with scoped access. Rotate and revoke anytime.',
  },
  {
    href: ROUTES.settingsWebhooks,
    external: false,
    icon: Webhook,
    title: 'Webhooks',
    description: 'Receive signed callbacks when events happen. Inspect deliveries and replay failures.',
  },
  {
    href: ROUTES.developerObjects,
    external: false,
    icon: Boxes,
    title: 'Custom Objects',
    description: 'Define your own entities and fields — stored in the Knowledge Graph, searchable for free.',
  },
  {
    href: ROUTES.developerForms,
    external: false,
    icon: FileCode,
    title: 'Dynamic Forms',
    description: 'Build validated forms that can feed custom objects. No code required.',
  },
  {
    href: ROUTES.developerPlugins,
    external: false,
    icon: Puzzle,
    title: 'Plugins',
    description: 'Install extensions that add routes, components, and event handlers within a permission sandbox.',
  },
  {
    href: ROUTES.developerTemplates,
    external: false,
    icon: Package,
    title: 'Templates',
    description: 'Import and export workflows, prompts, dashboards, and more from the template marketplace.',
  },
  {
    href: ROUTES.workflowBuilder,
    external: false,
    icon: Workflow,
    title: 'Automation Builder',
    description: 'Build visual automations on the Workflow Engine — triggered by the same events plugins hook into.',
  },
];

export default function DeveloperPortalPage() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Extension SDK</CardTitle>
          <CardDescription>
            The <code className="text-xs">@bond-os/sdk</code> package gives you a typed client, an event
            subscriber, and helpers for tools, workflows, AI, search, and the graph.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
            <code>{`import { createClient } from '@bond-os/sdk';

const bond = createClient({ apiKey: process.env.BOND_OS_API_KEY });
const projects = await bond.projects.list();`}</code>
          </pre>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {CARDS.map((card) => {
          const Icon = card.icon;
          const inner = (
            <Card className="h-full transition-colors hover:border-primary/50">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-base">{card.title}</CardTitle>
                </div>
                <CardDescription>{card.description}</CardDescription>
              </CardHeader>
            </Card>
          );
          return card.external ? (
            <a key={card.title} href={card.href} target="_blank" rel="noreferrer">
              {inner}
            </a>
          ) : (
            <Link key={card.title} href={card.href}>
              {inner}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
