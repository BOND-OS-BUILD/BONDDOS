import { GitHubConnector } from './providers/github';
import { GmailConnector } from './providers/gmail';
import { GoogleCalendarConnector } from './providers/google-calendar';
import { GoogleDriveConnector } from './providers/google-drive';
import { NotionConnector } from './providers/notion';
import { OneDriveConnector } from './providers/onedrive';
import { SlackConnector } from './providers/slack';
import type { Connector, ConnectorProviderId } from './types';

type ConnectorFactory = () => Connector;

const FACTORIES: Record<ConnectorProviderId, ConnectorFactory> = {
  GOOGLE_DRIVE: () => new GoogleDriveConnector(),
  GMAIL: () => new GmailConnector(),
  NOTION: () => new NotionConnector(),
  SLACK: () => new SlackConnector(),
  GITHUB: () => new GitHubConnector(),
  GOOGLE_CALENDAR: () => new GoogleCalendarConnector(),
  ONEDRIVE: () => new OneDriveConnector(),
};

/** Instantiates the connector implementation for a given provider. */
export function createConnector(provider: ConnectorProviderId): Connector {
  return FACTORIES[provider]();
}
