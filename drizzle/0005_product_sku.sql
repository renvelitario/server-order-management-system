-- Add SKU support for products archive/task update.
-- Existing products receive deterministic 13-digit numeric SKU from product_id.

ALTER TABLE ims_products ADD COLUMN IF NOT EXISTS sku varchar(32);

UPDATE ims_products
SET sku = LPAD(product_id::text, 13, '0')
WHERE sku IS NULL OR TRIM(sku) = '';

ALTER TABLE ims_products ALTER COLUMN sku SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'ims_products_sku_unique'
  ) THEN
    CREATE UNIQUE INDEX ims_products_sku_unique ON ims_products (sku);
  END IF;
END $$;
