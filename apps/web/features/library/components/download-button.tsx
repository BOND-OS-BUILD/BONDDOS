'use client';

import * as React from 'react';

import { Button, toast } from '@bond-os/ui';
import { Download } from 'lucide-react';

export function DownloadButton({ id }: { id: string }) {
  const [isLoading, setIsLoading] = React.useState(false);

  async function handleDownload() {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/library/documents/${id}/download`);
      const result = await response.json();
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      window.open(result.data.url, '_blank', 'noopener,noreferrer');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleDownload} disabled={isLoading}>
      <Download className="mr-2 h-4 w-4" />
      {isLoading ? 'Preparing…' : 'Download'}
    </Button>
  );
}
