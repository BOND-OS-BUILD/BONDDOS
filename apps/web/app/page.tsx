import { Button } from '@bond-os/ui';
import Link from 'next/link';

import { ROUTES } from '@bond-os/shared';

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">BOND OS</h1>
      <p className="max-w-md text-balance text-muted-foreground">
        The AI-native operating system for startups.
      </p>
      <div className="flex gap-3">
        <Button asChild>
          <Link href={ROUTES.signup}>Get started</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={ROUTES.login}>Log in</Link>
        </Button>
      </div>
    </div>
  );
}
