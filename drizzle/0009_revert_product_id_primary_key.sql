-- Migration 0009: Revert products primary key back to product_id, sku becomes unique natural key
-- Current DB state: sku = PK, product_id = UNIQUE, order_items.product_id FK to products.product_id
-- Target DB state:  product_id = PK, sku = UNIQUE, order_items.product_id FK to products.product_id

-- 1. Temporarily drop the FK from order_items so we can swap the PK
ALTER TABLE ims_order_items
  DROP CONSTRAINT IF EXISTS ims_order_items_product_id_ims_products_product_id_fk;

-- 2. Drop the current primary key (on sku)
ALTER TABLE ims_products DROP CONSTRAINT IF EXISTS ims_products_pkey;

-- 3. Drop the unique index on product_id (no longer needed as a unique — it becomes the PK)
-- 3. Drop the unique constraint on product_id (no longer needed as a unique — it becomes the PK)
ALTER TABLE ims_products DROP CONSTRAINT IF EXISTS ims_products_product_id_unique;

-- 4. Make product_id the primary key
ALTER TABLE ims_products ADD PRIMARY KEY (product_id);

-- 5. Add unique constraint on sku (natural key)
ALTER TABLE ims_products ADD CONSTRAINT ims_products_sku_unique UNIQUE (sku);

-- 6. Re-add the FK from order_items.product_id to products.product_id
ALTER TABLE ims_order_items
  ADD CONSTRAINT ims_order_items_product_id_ims_products_product_id_fk
  FOREIGN KEY (product_id) REFERENCES ims_products (product_id);
