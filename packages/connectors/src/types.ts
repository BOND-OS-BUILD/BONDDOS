/** Mirrors the Prisma `ConnectorProvider` enum in @bond-os/database. */
export type ConnectorProviderId =
  | 'GOOGLE_DRIVE'
  | 'GMAIL'
  | 'NOTION'
  | 'SLACK'
  | 'GITHUB'
  | 'GOOGLE_CALENDAR'
  | 'ONEDRIVE';

/** Mirrors the Prisma `ConnectorStatus` enum. */
export type ConnectorStatusValue = 'DISCONNECTED' | 'CONNECTED' | 'ERROR' | 'SYNCING';

/** Mirrors the Prisma `SyncTrigger` enum. */
export type SyncTriggerValue = 'MANUAL' | 'SCHEDULED' | 'WEBHOOK' | 'INCREMENTAL';

export interface ConnectorStatusInfo {
  status: ConnectorStatusValue;
  message?: string;
  lastSyncAt?: Date | null;
}

export interface SyncOptions {
  trigger: SyncTriggerValue;
  /** Opaque cursor from the previous sync, for incremental sync. */
  cursor?: string | null;
}

export interface SyncResult {
  itemsProcessed: number;
  itemsFailed: number;
  /** Opaque cursor to resume from on the next incremental sync. */
  cursor?: string | null;
}

/** Placeholder — no real OAuth tokens are handled in this phase. */
export type ConnectorConfig = Record<string, unknown>;

/**
 * The base contract every connector implements. No provider in this phase
 * performs real network/OAuth calls — this is architecture only, ready to
 * be filled in with a real implementation per provider later.
 */
export interface Connector {
  readonly provider: ConnectorProviderId;
  connect(config: ConnectorConfig): Promise<void>;
  disconnect(): Promise<void>;
  sync(options: SyncOptions): Promise<SyncResult>;
  status(): Promise<ConnectorStatusInfo>;
  /** Handles an inbound webhook payload from the provider (push-based sync). */
  webhook(payload: unknown): Promise<void>;
}
