import { redirect } from 'next/navigation';

import { ROUTES } from '@bond-os/shared';

export default function SettingsIndexPage() {
  redirect(ROUTES.settingsProfile);
}
