-- Remove obsolete inventory quantity column from products.
-- Safe to run after inventory feature retirement.

ALTER TABLE IF EXISTS ims_products
  DROP CONSTRAINT IF EXISTS ims_products_quantity_check;

ALTER TABLE IF EXISTS ims_products
  DROP COLUMN IF EXISTS quantity;
