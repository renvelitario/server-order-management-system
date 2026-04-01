import { z } from 'zod';
import { statusSchema } from './common.js';

export const productPayloadSchema = z.object({
  product_name: z.string().trim().min(2).max(300),
  quantity: z.coerce.number().int().min(0),
  price: z.coerce.number().min(0),
  status: statusSchema.default('active'),
});

export const customerPayloadSchema = z.object({
  name: z.string().trim().min(2).max(200),
  address: z.string().trim().min(3).max(500),
  contact_no: z.string().trim().min(7).max(20),
});

export const purchasePayloadSchema = z.object({
  product_id: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().positive(),
});

export const orderPayloadSchema = z.object({
  customer_id: z.coerce.number().int().positive(),
  items_data: z.array(z.object({
    product_id: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().positive(),
  })).min(1),
});

export const dashboardQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
}).refine((data) => {
  if (!data.from || !data.to) {
    return true;
  }

  return new Date(data.from) <= new Date(data.to);
}, {
  message: 'Invalid date range.',
  path: ['to'],
});
