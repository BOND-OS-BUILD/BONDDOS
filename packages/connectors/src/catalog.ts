import type { ConnectorProviderId } from './types';

export interface ConnectorCatalogEntry {
  provider: ConnectorProviderId;
  displayName: string;
  description: string;
}

/** UI-facing catalog of every connector this phase has architecture for. */
export const CONNECTOR_CATALOG: ConnectorCatalogEntry[] = [
  { provider: 'GOOGLE_DRIVE', displayName: 'Google Drive', description: 'Sync files and folders from Google Drive.' },
  { provider: 'GMAIL', displayName: 'Gmail', description: 'Sync emails from Gmail.' },
  { provider: 'NOTION', displayName: 'Notion', description: 'Sync pages and databases from Notion.' },
  { provider: 'SLACK', displayName: 'Slack', description: 'Sync messages and files from Slack channels.' },
  {
    provider: 'GITHUB',
    displayName: 'GitHub',
    description: 'Sync repositories, issues, and pull requests from GitHub.',
  },
  { provider: 'GOOGLE_CALENDAR', displayName: 'Google Calendar', description: 'Sync events from Google Calendar.' },
  { provider: 'ONEDRIVE', displayName: 'Microsoft OneDrive', description: 'Sync files from Microsoft OneDrive.' },
];
