import type {
  Connector,
  ConnectorConfig,
  ConnectorProviderId,
  ConnectorStatusInfo,
  SyncOptions,
  SyncResult,
} from './types';

export class ConnectorNotImplementedError extends Error {
  constructor(provider: string, method: string) {
    super(
      `${provider} connector does not implement ${method}() yet — this phase only builds the connector architecture, not real OAuth/network integrations.`,
    );
    this.name = 'ConnectorNotImplementedError';
  }
}

/**
 * Shared scaffolding for every provider stub: `status()` reflects whatever
 * `connect`/`disconnect` set, everything else throws
 * `ConnectorNotImplementedError` until a real implementation lands.
 */
export abstract class BaseConnector implements Connector {
  abstract readonly provider: ConnectorProviderId;

  protected connected = false;

  async connect(_config: ConnectorConfig): Promise<void> {
    throw new ConnectorNotImplementedError(this.provider, 'connect');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async sync(_options: SyncOptions): Promise<SyncResult> {
    throw new ConnectorNotImplementedError(this.provider, 'sync');
  }

  async status(): Promise<ConnectorStatusInfo> {
    return { status: this.connected ? 'CONNECTED' : 'DISCONNECTED' };
  }

  async webhook(_payload: unknown): Promise<void> {
    throw new ConnectorNotImplementedError(this.provider, 'webhook');
  }
}
