import { AppError } from '../utils/errors.js';

export const validate = (schema, target = 'body') => (req, res, next) => {
  const payload = req[target];
  const result = schema.safeParse(payload);

  if (!result.success) {
    const message = result.error.issues[0]?.message || 'Invalid request payload.';
    throw new AppError(400, message);
  }

  req[target] = result.data;
  next();
};
