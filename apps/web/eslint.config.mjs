import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

// Deliberately does NOT spread @bond-os/config's shared `baseConfig` here —
// `next/typescript` (below) already registers the `@typescript-eslint`
// plugin + recommended rules, and ESLint 9's flat config throws
// "Cannot redefine plugin" if the same plugin is registered twice.
const eslintConfig = [
  { ignores: ['.next/**', 'next-env.d.ts'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // Server Components/Route Handlers commonly need console.error for
      // unexpected failures; the shared logger is preferred but this keeps
      // ad-hoc debugging from failing lint.
      'no-console': 'off',
    },
  },
];

export default eslintConfig;
