import { BaseConnector } from '../base-connector';
import type { ConnectorProviderId } from '../types';

/** Architecture-only placeholder — no Google OAuth/Gmail API integration yet. */
export class GmailConnector extends BaseConnector {
  readonly provider: ConnectorProviderId = 'GMAIL';
}
