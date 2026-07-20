import { BaseConnector } from '../base-connector';
import type { ConnectorProviderId } from '../types';

/** Architecture-only placeholder — no Microsoft OAuth/Graph API integration yet. */
export class OneDriveConnector extends BaseConnector {
  readonly provider: ConnectorProviderId = 'ONEDRIVE';
}
