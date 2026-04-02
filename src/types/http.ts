import type { NextFunction, Request, Response } from 'express';

export type AsyncRouteHandler<
  Req extends Request = Request,
  Res extends Response = Response,
> = (req: Req, res: Res, next: NextFunction) => Promise<unknown>;

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
