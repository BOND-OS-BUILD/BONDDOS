import { BaseConnector } from '../base-connector';
import type { ConnectorProviderId } from '../types';

/** Architecture-only placeholder — no Slack OAuth/API integration yet. */
export class SlackConnector extends BaseConnector {
  readonly provider: ConnectorProviderId = 'SLACK';
}
