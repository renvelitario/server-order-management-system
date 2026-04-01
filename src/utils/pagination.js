const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const DEFAULT_SORT = 'desc';

const toPositiveIntOrFallback = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
};

export const parsePagination = (query) => {
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

export const parseSortDirection = (value) => {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'asc' || normalized === 'desc') {
    return normalized;
  }

  return DEFAULT_SORT;
};

export const parseListQuery = (query) => {
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

export const buildPaginatedResponse = ({ data, total, page, limit }) => ({
  data,
  pagination: {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  },
});
