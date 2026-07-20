import { KeyRound } from 'lucide-react';

import { Card, CardContent } from '@bond-os/ui';

export default function ApiKeysSettingsPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <KeyRound className="h-11 w-11 text-muted-foreground" />
          <h1 className="text-lg font-semibold">API Keys</h1>
          <p className="text-sm text-muted-foreground">Coming soon.</p>
        </CardContent>
      </Card>
    </div>
  );
}
