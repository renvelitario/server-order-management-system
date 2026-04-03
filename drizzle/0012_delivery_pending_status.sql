ALTER TABLE ims_orders
  DROP CONSTRAINT IF EXISTS ims_orders_delivery_status_check;

UPDATE ims_orders
SET delivery_status = 'pending'
WHERE delivery_status = 'scheduled';

ALTER TABLE ims_orders
  ADD CONSTRAINT ims_orders_delivery_status_check
  CHECK (delivery_status IN ('unassigned', 'pending', 'out_for_delivery', 'delivered', 'failed', 'cancelled'));