import basePreset from '@bond-os/config/tailwind-preset';
import type { Config } from 'tailwindcss';

const config: Config = {
  presets: [basePreset],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
};

export default config;
