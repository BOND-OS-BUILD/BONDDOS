import { BaseConnector } from '../base-connector';
import type { ConnectorProviderId } from '../types';

/** Architecture-only placeholder — no GitHub OAuth/API integration yet. */
export class GitHubConnector extends BaseConnector {
  readonly provider: ConnectorProviderId = 'GITHUB';
}
