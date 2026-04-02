import { z } from 'zod';
import { accountStatusSchema, accountTypeSchema } from './common.js';

const passwordPolicyRegex = /^(?=.*[a-zA-Z])(?=.*\d).{8,}$/;

export const registerUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  username: z.string().trim().min(2).max(200),
  password: z.string().min(8).regex(passwordPolicyRegex, 'Password must be at least 8 characters and include letters and numbers.'),
  confirm_password: z.string().min(8),
  acc_type: accountTypeSchema.default('User'),
  status: accountStatusSchema.default('Active'),
}).refine((data) => data.password === data.confirm_password, {
  message: 'Passwords do not match.',
  path: ['confirm_password'],
});

export const updateProfileSchema = z.object({
  email: z.string().trim().toLowerCase().email().optional(),
  username: z.string().trim().min(2).max(200).optional(),
  password: z.string().min(1),
}).strict();

export const updateSessionTimeoutSchema = z.object({
  inactivity_timeout_minutes: z.coerce.number().int().min(10).max(480),
});

export const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8).regex(passwordPolicyRegex, 'Password must be at least 8 characters and include letters and numbers.'),
  confirm_password: z.string().min(8),
}).refine((data) => data.new_password === data.confirm_password, {
  message: 'New password and confirm password do not match.',
  path: ['confirm_password'],
});

export const updateUserByAdminSchema = z.object({
  username: z.string().trim().min(2).max(200).optional(),
  acc_type: accountTypeSchema.optional(),
  status: accountStatusSchema.optional(),
  inactivity_timeout_minutes: z.coerce.number().int().min(10).max(480).optional(),
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'Provide at least one field to update.',
});
