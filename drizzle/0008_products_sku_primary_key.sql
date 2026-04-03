-- Promote sku to products primary key while preserving product_id uniqueness
-- so existing foreign keys that point to product_id remain valid.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ims_products_product_id_unique'
      AND conrelid = 'ims_products'::regclass
  ) THEN
    ALTER TABLE ims_products
      ADD CONSTRAINT ims_products_product_id_unique UNIQUE (product_id);
  END IF;
END $$;

DROP INDEX IF EXISTS ims_products_sku_unique;

ALTER TABLE IF EXISTS ims_order_items
  DROP CONSTRAINT IF EXISTS ims_order_items_product_id_ims_products_product_id_fk;

ALTER TABLE IF EXISTS ims_products
  DROP CONSTRAINT IF EXISTS ims_products_pkey;

ALTER TABLE IF EXISTS ims_products
  ADD CONSTRAINT ims_products_pkey PRIMARY KEY (sku);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ims_order_items_product_id_ims_products_product_id_fk'
      AND conrelid = 'ims_order_items'::regclass
  ) THEN
    ALTER TABLE ims_order_items
      ADD CONSTRAINT ims_order_items_product_id_ims_products_product_id_fk
      FOREIGN KEY (product_id)
      REFERENCES ims_products(product_id);
  END IF;
END $$;
