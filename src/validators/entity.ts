import { z } from 'zod';
import { statusSchema } from './common.js';

const isValidDateOnly = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const candidate = new Date(year, month - 1, day);

  return candidate.getFullYear() === year
    && (candidate.getMonth() + 1) === month
    && candidate.getDate() === day;
};

const deliveryDateSchema = z.string().refine(isValidDateOnly, {
  message: 'Invalid delivery date. Use YYYY-MM-DD.',
});

const orderDateSchema = z.string().refine(isValidDateOnly, {
  message: 'Invalid order date. Use YYYY-MM-DD.',
});

export const productPayloadSchema = z.object({
  sku: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{8,32}$/, 'SKU must be 8-32 uppercase letters/numbers.').optional().or(z.literal('')),
  product_name: z.string().trim().min(2).max(300),
  price: z.coerce.number().min(0),
  status: statusSchema.default('active'),
});

export const customerPayloadSchema = z.object({
  student_number: z.string().trim().min(4, 'Student number must be at least 4 characters.').max(20, 'Student number must be at most 20 characters.'),
  name: z.string().trim().min(2, 'Customer name must be at least 2 characters.').max(200, 'Customer name must be at most 200 characters.'),
  address: z.string().trim().min(3, 'Address must be at least 3 characters.').max(500, 'Address must be at most 500 characters.'),
  contact_no: z.string().trim().min(7, 'Contact number must be at least 7 characters.').max(20, 'Contact number must be at most 20 characters.'),
});

export const orderPayloadSchema = z.object({
  customer_id: z.coerce.number().int().positive(),
  order_date: orderDateSchema,
  delivery_date: deliveryDateSchema.optional(),
  items_data: z.array(z.object({
    product_id: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().positive(),
    price: z.coerce.number().min(0),
  })).min(1),
  discount: z.coerce.number().min(0).default(0).optional(),
  delivery_fee: z.coerce.number().min(0).default(0).optional(),
});

export const deliveryStatusSchema = z.enum(['unassigned', 'pending', 'out_for_delivery', 'delivered', 'failed', 'cancelled']);

export const deliveryAssignmentSchema = z.object({
  delivery_date: deliveryDateSchema,
});

export const updateDeliveryStatusSchema = z.object({
  delivery_status: deliveryStatusSchema,
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
