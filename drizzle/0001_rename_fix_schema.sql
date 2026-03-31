-- Migration: Refactor database schema for proper relational design
-- Date: 2026-03-31

-- 1. Rename cust_id to customer_id in customers table
ALTER TABLE ims_customers RENAME COLUMN cust_id TO customer_id;

-- 2. Update orders table structure - remove product_id and quantity, add proper FK
ALTER TABLE ims_orders 
  DROP COLUMN IF EXISTS product_id,
  DROP COLUMN IF EXISTS quantity;

-- 3. Create new order_items table for order line items
CREATE TABLE IF NOT EXISTS ims_order_items (
  order_item_id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES ims_orders(order_id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES ims_products(product_id),
  quantity INTEGER NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  CONSTRAINT order_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT order_items_price_positive CHECK (price >= 0)
);

-- 4. Add FK constraint for orders.customer_id if not exists
ALTER TABLE ims_orders
  ADD CONSTRAINT orders_customer_id_fk 
    FOREIGN KEY (customer_id) REFERENCES ims_customers(customer_id) ON DELETE RESTRICT;

-- 5. Update purchases table - ensure product_id is integer and has FK
ALTER TABLE ims_purchases
  ALTER COLUMN product_id TYPE INTEGER;

ALTER TABLE ims_purchases
  ADD CONSTRAINT purchases_product_id_fk 
    FOREIGN KEY (product_id) REFERENCES ims_products(product_id);

-- 6. Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON ims_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON ims_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON ims_order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_purchases_product_id ON ims_purchases(product_id);
