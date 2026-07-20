'use client';

import { useEffect } from 'react';

import './globals.css';

/**
 * Catches errors thrown by the root layout itself, so it must render its
 * own <html>/<body> — it fully replaces app/layout.tsx when triggered.
 * Deliberately dependency-free (no @bond-os/ui, no ThemeProvider): whatever
 * broke the root layout may have broken those too.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="antialiased">
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center font-sans">
          <p className="text-sm font-medium text-gray-500">500</p>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Something went badly wrong</h1>
          <p className="max-w-sm text-sm text-gray-500">
            The application failed to load. Please try again.
          </p>
          <button
            onClick={() => reset()}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
