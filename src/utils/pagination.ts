import type { ParsedQs } from 'qs';
import type { PaginatedResult } from '../types/http.js';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const DEFAULT_SORT = 'desc';
type SortDirection = 'asc' | 'desc';

type ListQueryInput = ParsedQs & {
  page?: string | number;
  limit?: string | number;
  sort?: string;
  search?: string;
};

const toPositiveIntOrFallback = (value: unknown, fallback: number): number => {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
};

export const parsePagination = (query: ListQueryInput): { page: number; limit: number; offset: number } => {
  const safePage = toPositiveIntOrFallback(query.page, DEFAULT_PAGE);
  const rawLimit = toPositiveIntOrFallback(query.limit, DEFAULT_LIMIT);
  const safeLimit = Math.min(rawLimit, MAX_LIMIT);
  const offset = Math.max(0, (safePage - 1) * safeLimit);

  return {
    page: safePage,
    limit: safeLimit,
    offset,
  };
};

export const parseSortDirection = (value: unknown): SortDirection => {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'asc' || normalized === 'desc') {
    return normalized;
  }

  return DEFAULT_SORT;
};

export const parseListQuery = (query: ListQueryInput): { page: number; limit: number; offset: number; sort: SortDirection; search?: string } => {
  const { page, limit, offset } = parsePagination(query);
  const sort = parseSortDirection(query.sort);
  const search = typeof query.search === 'string' ? query.search.trim().slice(0, 120) : undefined;

  return {
    page,
    limit,
    offset,
    sort,
    search,
  };
};

export const logPaginationDebug = ({
  route,
  query,
  parsed,
  enabled = true,
}: {
  route: string;
  query: unknown;
  parsed: { page: number; limit: number; offset: number; sort: SortDirection; search?: string };
  enabled?: boolean;
}) => {
  if (!enabled) {
    return;
  }

  console.info('[DEBUG_PAGINATION]', {
    route,
    query,
    parsed,
  });
};

export const buildPaginatedResponse = <T>({ data, total, page, limit }: { data: T[]; total: number; page: number; limit: number }): PaginatedResult<T> => ({
  data,
  pagination: {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  },
});
