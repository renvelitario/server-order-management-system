ALTER TABLE ims_orders
  ALTER COLUMN delivery_date DROP NOT NULL,
  ALTER COLUMN delivery_date DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS delivery_user_id integer;

ALTER TABLE ims_orders
  DROP CONSTRAINT IF EXISTS ims_orders_delivery_status_check;

UPDATE ims_orders
SET delivery_status = CASE
  WHEN delivery_status = 'pending' AND delivery_date IS NULL THEN 'unassigned'
  WHEN delivery_status = 'pending' THEN 'scheduled'
  WHEN delivery_status = 'failed_delivery' THEN 'failed'
  ELSE delivery_status
END;

ALTER TABLE ims_orders
  ALTER COLUMN delivery_status SET DEFAULT 'unassigned';

ALTER TABLE ims_orders
  ADD CONSTRAINT ims_orders_delivery_user_fk
  FOREIGN KEY (delivery_user_id) REFERENCES ims_users(user_id);

ALTER TABLE ims_orders
  ADD CONSTRAINT ims_orders_delivery_status_check
  CHECK (delivery_status IN ('unassigned', 'scheduled', 'out_for_delivery', 'delivered', 'failed', 'cancelled'));