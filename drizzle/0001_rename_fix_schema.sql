-- Migration: Refactor database schema for proper relational design
-- Date: 2026-03-31
-- Safe to re-run: all statements are idempotent

-- 1. Rename cust_id to customer_id in customers table (only if not already renamed)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'ims_customers' AND column_name = 'cust_id'
    ) THEN
        ALTER TABLE ims_customers RENAME COLUMN cust_id TO customer_id;
    END IF;
END $$;

-- 2. Fix purchases.product_id: varchar -> integer (requires USING for explicit cast)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'ims_purchases' AND column_name = 'product_id'
          AND data_type = 'character varying'
    ) THEN
        ALTER TABLE ims_purchases
            ALTER COLUMN product_id TYPE INTEGER USING product_id::integer;
    END IF;
END $$;

-- 3. Fix purchases.quantity: varchar -> integer (requires USING for explicit cast)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'ims_purchases' AND column_name = 'quantity'
          AND data_type = 'character varying'
    ) THEN
        ALTER TABLE ims_purchases
            ALTER COLUMN quantity TYPE INTEGER USING quantity::integer;
    END IF;
END $$;

-- 4. Drop stale columns from orders table
ALTER TABLE ims_orders DROP COLUMN IF EXISTS product_id;
ALTER TABLE ims_orders DROP COLUMN IF EXISTS quantity;

-- 5. Create order_items table (normalized line items per order)
CREATE TABLE IF NOT EXISTS ims_order_items (
    order_item_id SERIAL PRIMARY KEY,
    order_id      INTEGER NOT NULL REFERENCES ims_orders(order_id) ON DELETE CASCADE,
    product_id    INTEGER NOT NULL REFERENCES ims_products(product_id),
    quantity      INTEGER NOT NULL CHECK (quantity > 0),
    price         DOUBLE PRECISION NOT NULL CHECK (price >= 0)
);

-- 6. Add FK on orders.customer_id if it doesn't already exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'ims_orders' AND constraint_name = 'orders_customer_id_fk'
    ) THEN
        ALTER TABLE ims_orders
            ADD CONSTRAINT orders_customer_id_fk
                FOREIGN KEY (customer_id) REFERENCES ims_customers(customer_id) ON DELETE RESTRICT;
    END IF;
END $$;

-- 7. Add FK on purchases.product_id if it doesn't already exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'ims_purchases' AND constraint_name = 'purchases_product_id_fk'
    ) THEN
        ALTER TABLE ims_purchases
            ADD CONSTRAINT purchases_product_id_fk
                FOREIGN KEY (product_id) REFERENCES ims_products(product_id);
    END IF;
END $$;

-- 8. Performance indexes
CREATE INDEX IF NOT EXISTS idx_orders_customer_id      ON ims_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id    ON ims_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id  ON ims_order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_purchases_product_id    ON ims_purchases(product_id);

