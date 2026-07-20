import { BaseConnector } from '../base-connector';
import type { ConnectorProviderId } from '../types';

/** Architecture-only placeholder — no Google OAuth/Drive API integration yet. */
export class GoogleDriveConnector extends BaseConnector {
  readonly provider: ConnectorProviderId = 'GOOGLE_DRIVE';
}
