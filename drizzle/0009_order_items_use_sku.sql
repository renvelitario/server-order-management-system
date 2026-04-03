-- Step 1: Add sku column to order_items (nullable initially for data fill)
ALTER TABLE ims_order_items ADD COLUMN sku VARCHAR(32);

-- Step 2: Populate sku from products via existing product_id FK
UPDATE ims_order_items oi
SET sku = p.sku
FROM ims_products p
WHERE oi.product_id = p.product_id;

-- Step 3: Make sku NOT NULL now that data is filled
ALTER TABLE ims_order_items ALTER COLUMN sku SET NOT NULL;

-- Step 4: Drop the old product_id FK from order_items
ALTER TABLE ims_order_items DROP CONSTRAINT IF EXISTS ims_order_items_product_id_ims_products_product_id_fk;

-- Step 5: Drop the product_id column from order_items
ALTER TABLE ims_order_items DROP COLUMN product_id;

-- Step 6: Add FK on order_items.sku -> products.sku with cascade update
ALTER TABLE ims_order_items
  ADD CONSTRAINT ims_order_items_sku_ims_products_sku_fk
  FOREIGN KEY (sku) REFERENCES ims_products(sku) ON UPDATE CASCADE ON DELETE RESTRICT;

-- Step 7: Drop unique constraint on products.product_id
ALTER TABLE ims_products DROP CONSTRAINT IF EXISTS ims_products_product_id_unique;

-- Step 8: Drop product_id column from products
ALTER TABLE ims_products DROP COLUMN product_id;
