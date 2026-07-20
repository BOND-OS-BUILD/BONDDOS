import { z } from 'zod';

import { paginationQuerySchema } from './query';

export const syncJobQuerySchema = paginationQuerySchema.extend({
  connectorId: z.string().min(1).optional(),
});
export type SyncJobQuery = z.infer<typeof syncJobQuerySchema>;
