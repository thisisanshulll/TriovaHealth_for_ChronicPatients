import { z } from 'zod';

export const paginationSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

export type Pagination = z.infer<typeof paginationSchema>;

export function parsePagination(q: Record<string, unknown>): Pagination {
  return paginationSchema.parse({
    limit: q.limit,
    offset: q.offset,
  });
}
