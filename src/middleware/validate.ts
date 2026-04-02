import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';
import { AppError } from '../utils/errors.js';

type ValidationTarget = 'body' | 'params' | 'query';

export const validate = (schema: ZodTypeAny, target: ValidationTarget = 'body'): RequestHandler => (req, _res, next) => {
  const payload = req[target];
  const result = schema.safeParse(payload);

  if (!result.success) {
    const message = result.error.issues[0]?.message || 'Invalid request payload.';
    throw new AppError(400, message);
  }

  req[target] = result.data;
  next();
};
