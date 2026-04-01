export class AppError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
  }
}

export const asyncHandler = (handler) => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (error) {
    next(error);
  }
};

export const sanitizeErrorMessage = (statusCode, fallback = 'Something went wrong.') => {
  if (statusCode >= 500) {
    return fallback;
  }

  return fallback;
};

export const errorHandler = (error, req, res, next) => {
  const statusCode = Number(error?.statusCode) || 500;
  const clientMessage = statusCode >= 500 ? 'Internal server error.' : (error?.message || 'Request failed.');

  console.error('[API_ERROR]', {
    method: req.method,
    path: req.originalUrl,
    query: req.query,
    statusCode,
    message: error?.message,
    stack: error?.stack,
  });

  res.status(statusCode).json({ error: clientMessage });
};
