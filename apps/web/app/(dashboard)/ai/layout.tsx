import type { ReactNode } from 'react';

import { Separator } from '@bond-os/ui';

import { AiNav } from './ai-nav';

export default function AiLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">AI</h1>
        <p className="text-sm text-muted-foreground">
          Provider configuration, embeddings, retrieval, and memory status.
        </p>
      </div>
      <Separator className="mb-6" />
      <div className="flex flex-col gap-8 lg:flex-row">
        <AiNav />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
