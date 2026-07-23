import type { ReactNode } from 'react';

import { DeveloperNav } from './developer-nav';

/** Phase 11 — Developer Portal shell: shared header + section nav. */
export default function DeveloperLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Developer</h1>
        <p className="text-sm text-muted-foreground">
          Extend BOND OS — build custom objects, forms, plugins, and integrations on the public API.
        </p>
      </div>
      <DeveloperNav />
      {children}
    </div>
  );
}
