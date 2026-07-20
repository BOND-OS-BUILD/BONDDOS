import { z } from 'zod';

/**
 * Base query params for paginated/searchable/sortable list endpoints.
 * Entity-specific query schemas `.extend()` this with their own filters
 * (status, priority, etc.) and a narrowed `sortBy` enum.
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).optional(),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
