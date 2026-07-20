import { BaseConnector } from '../base-connector';
import type { ConnectorProviderId } from '../types';

/** Architecture-only placeholder — no Google OAuth/Calendar API integration yet. */
export class GoogleCalendarConnector extends BaseConnector {
  readonly provider: ConnectorProviderId = 'GOOGLE_CALENDAR';
}
