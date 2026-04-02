import express from 'express';
import { randomInt } from 'node:crypto';
import { db } from '../db/db.js';
import { products, orderItems, purchases } from '../db/schema.js';
import { and, asc, desc, eq, ilike, ne, or, sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin, requireRole } from '../middleware/rbac.js';
import { asyncHandler, AppError } from '../utils/errors.js';
import { validate } from '../middleware/validate.js';
import { idParamSchema } from '../validators/common.js';
import { productPayloadSchema } from '../validators/entity.js';
import { buildPaginatedResponse, logPaginationDebug, parseListQuery } from '../utils/pagination.js';

const router = express.Router();
router.use(requireAuth);

const SKU_LENGTH = 13;
const SKU_CHARSET = '0123456789';

const normalizeSku = (value) => String(value || '').trim().toUpperCase();

const generateRandomSku = () => {
  let sku = '';
  for (let index = 0; index < SKU_LENGTH; index += 1) {
    const next = randomInt(SKU_CHARSET.length);
    sku += SKU_CHARSET[next];
  }
  return sku;
};

const ensureUniqueSku = async (candidateSku: string, excludeProductId?: number) => {
  const normalized = normalizeSku(candidateSku);

  const whereClause = typeof excludeProductId === 'number'
    ? and(eq(products.sku, normalized), ne(products.product_id, excludeProductId))
    : eq(products.sku, normalized);

  const existing = await db
    .select({ product_id: products.product_id })
    .from(products)
    .where(whereClause)
    .limit(1);

  return existing.length === 0;
};

const resolveSkuForCreate = async (requestedSku?: string) => {
  const normalizedRequested = normalizeSku(requestedSku);

  if (normalizedRequested) {
    const available = await ensureUniqueSku(normalizedRequested);
    if (!available) {
      throw new AppError(409, 'SKU already exists. Please choose a different SKU.');
    }
    return normalizedRequested;
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const generated = generateRandomSku();
    const available = await ensureUniqueSku(generated);
    if (available) {
      return generated;
    }
  }

  throw new AppError(500, 'Unable to generate a unique SKU. Please try again.');
};

router.get('/', requireRole('Admin', 'User'), asyncHandler(async (req, res) => {
  const { page, limit, offset, sort, search } = parseListQuery(req.query);
  const sortDirection = sort === 'asc' ? asc(products.product_id) : desc(products.product_id);
  const whereClause = search
    ? or(ilike(products.product_name, `%${search}%`), ilike(products.sku, `%${search}%`))
    : undefined;

  logPaginationDebug({
    route: 'products.list',
    query: req.query,
    parsed: { page, limit, offset, sort, search },
  });

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        product_id: products.product_id,
        sku: products.sku,
        product_name: products.product_name,
        quantity: products.quantity,
        price: products.price,
        status: products.status,
      })
      .from(products)
      .where(whereClause)
      .orderBy(sortDirection)
      .limit(limit)
      .offset(offset),
    db.select({ count: sql`count(*)::int` }).from(products).where(whereClause),
  ]);

  res.json(buildPaginatedResponse({
    data: rows,
    total: Number(totalRows[0]?.count || 0),
    page,
    limit,
  }));
}));

router.get('/:id', requireRole('Admin', 'User'), validate(idParamSchema, 'params'), asyncHandler(async (req, res) => {
  const productId = Number(req.params.id);
  const product = await db.select().from(products).where(eq(products.product_id, productId));
  if (!product.length) {
    throw new AppError(404, 'Product not found.');
  }

  res.json(product[0]);
}));

router.post('/', requireAdmin, validate(productPayloadSchema), asyncHandler(async (req, res) => {
  const payload = req.body as {
    sku?: string;
    product_name: string;
    quantity?: number;
    price: number;
    status: string;
  };

  const sku = await resolveSkuForCreate(payload.sku);

  const [newProduct] = await db.insert(products).values({
    sku,
    product_name: payload.product_name,
    quantity: Number(payload.quantity ?? 0),
    price: payload.price,
    status: payload.status,
  }).returning();

  res.status(201).json(newProduct);
}));

router.put('/:id', requireAdmin, validate(idParamSchema, 'params'), validate(productPayloadSchema), asyncHandler(async (req, res) => {
  const productId = Number(req.params.id);
  const payload = req.body as {
    sku?: string;
    product_name: string;
    quantity?: number;
    price: number;
    status: string;
  };

  const existingRows = await db
    .select({ product_id: products.product_id, sku: products.sku, quantity: products.quantity })
    .from(products)
    .where(eq(products.product_id, productId))
    .limit(1);

  if (!existingRows.length) {
    throw new AppError(404, 'Product not found.');
  }

  const existing = existingRows[0];
  const normalizedSku = normalizeSku(payload.sku);

  let nextSku = existing.sku;
  if (normalizedSku && normalizedSku !== existing.sku) {
    const available = await ensureUniqueSku(normalizedSku, productId);
    if (!available) {
      throw new AppError(409, 'SKU already exists. Please choose a different SKU.');
    }
    nextSku = normalizedSku;
  }

  const [updatedProduct] = await db.update(products).set({
    sku: nextSku,
    product_name: payload.product_name,
    quantity: Number(payload.quantity ?? existing.quantity),
    price: payload.price,
    status: payload.status,
  }).where(eq(products.product_id, productId)).returning();

  res.json(updatedProduct);
}));

router.delete('/:id', requireAdmin, validate(idParamSchema, 'params'), asyncHandler(async (req, res) => {
  const productId = Number(req.params.id);

  const [inOrderItems, inPurchases] = await Promise.all([
    db.select({ order_item_id: orderItems.order_item_id }).from(orderItems).where(eq(orderItems.product_id, productId)).limit(1),
    db.select({ purchase_id: purchases.purchase_id }).from(purchases).where(eq(purchases.product_id, productId)).limit(1),
  ]);

  if (inOrderItems.length || inPurchases.length) {
    throw new AppError(409, 'This record cannot be deleted because it is used in other records.');
  }

  await db.delete(products).where(eq(products.product_id, productId));
  res.json({ success: true });
}));

export default router;
