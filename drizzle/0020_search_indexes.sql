CREATE INDEX IF NOT EXISTS ims_products_name_idx
  ON ims_products (product_name);

CREATE INDEX IF NOT EXISTS ims_customers_name_idx
  ON ims_customers (name);

CREATE INDEX IF NOT EXISTS ims_customers_contact_idx
  ON ims_customers (contact_no);

CREATE INDEX IF NOT EXISTS ims_orders_order_date_idx
  ON ims_orders (order_date);

CREATE INDEX IF NOT EXISTS ims_orders_delivery_window_idx
  ON ims_orders (delivery_date, delivery_status);

CREATE INDEX IF NOT EXISTS ims_order_items_order_idx
  ON ims_order_items (order_id);