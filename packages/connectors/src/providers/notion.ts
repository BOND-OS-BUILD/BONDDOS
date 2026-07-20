import { BaseConnector } from '../base-connector';
import type { ConnectorProviderId } from '../types';

/** Architecture-only placeholder — no Notion OAuth/API integration yet. */
export class NotionConnector extends BaseConnector {
  readonly provider: ConnectorProviderId = 'NOTION';
}
