import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
  search: z.string().trim().max(120).optional(),
  sort: z.enum(['asc', 'desc']).optional(),
});

export const statusSchema = z.enum(['active', 'inactive']);
export const accountTypeSchema = z.enum(['Admin', 'User']);
export const accountStatusSchema = z.enum(['Active', 'Disabled', 'Suspended']);
