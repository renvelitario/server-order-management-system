import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AsyncRouteHandler } from '../types/http.js';

export class AppError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
  }
}

export const asyncHandler = (handler: AsyncRouteHandler): RequestHandler => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (error) {
    next(error);
  }
};

export const errorHandler = (error: unknown, req: Request, res: Response, _next: NextFunction): void => {
  const appError = error as Partial<AppError> | undefined;
  const statusCode = Number(appError?.statusCode) || 500;
  const safeError = error instanceof Error ? error : undefined;
  const clientMessage = statusCode >= 500 ? 'Internal server error.' : (safeError?.message || 'Request failed.');

  if (process.env.NODE_ENV !== 'production') {
    console.error('[API_ERROR]', {
      method: req.method,
      path: req.originalUrl,
      query: req.query,
      statusCode,
      message: safeError?.message,
      stack: safeError?.stack,
    });
  }

  res.status(statusCode).json({ error: clientMessage });
};
