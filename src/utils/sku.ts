import { randomInt } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/db.js';
import { products } from '../db/schema.js';
import { AppError } from './errors.js';

const SKU_LENGTH = 13;
const SKU_CHARSET = '0123456789';

export const normalizeSku = (value: unknown): string => String(value || '').trim().toUpperCase();

const generateRandomSku = (): string => {
  let sku = '';
  for (let index = 0; index < SKU_LENGTH; index += 1) {
    const next = randomInt(SKU_CHARSET.length);
    sku += SKU_CHARSET[next];
  }
  return sku;
};

export const ensureUniqueSku = async (candidateSku: string): Promise<boolean> => {
  const normalized = normalizeSku(candidateSku);
  const existing = await db
    .select({ sku: products.sku })
    .from(products)
    .where(eq(products.sku, normalized))
    .limit(1);

  return existing.length === 0;
};

export const resolveSkuForCreate = async (requestedSku?: string): Promise<string> => {
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
