import { z } from 'zod';

export const CONNECTOR_PROVIDERS = [
  'GOOGLE_DRIVE',
  'GMAIL',
  'NOTION',
  'SLACK',
  'GITHUB',
  'GOOGLE_CALENDAR',
  'ONEDRIVE',
] as const;
export const connectorProviderSchema = z.enum(CONNECTOR_PROVIDERS);

export const connectConnectorSchema = z.object({
  provider: connectorProviderSchema,
});
export type ConnectConnectorInput = z.infer<typeof connectConnectorSchema>;
