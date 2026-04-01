CREATE INDEX IF NOT EXISTS ims_order_items_order_id_idx ON ims_order_items (order_id);
CREATE INDEX IF NOT EXISTS ims_orders_customer_id_idx ON ims_orders (customer_id);
CREATE INDEX IF NOT EXISTS ims_orders_order_date_idx ON ims_orders (order_date DESC);
CREATE INDEX IF NOT EXISTS ims_orders_delivery_date_status_idx ON ims_orders (delivery_date, delivery_status);
CREATE INDEX IF NOT EXISTS ims_products_status_idx ON ims_products (status);
CREATE INDEX IF NOT EXISTS ims_purchases_purchase_date_idx ON ims_purchases (purchase_date DESC);
