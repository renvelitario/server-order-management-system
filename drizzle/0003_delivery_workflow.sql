-- Migration: add delivery workflow fields to orders
-- Date: 2026-04-01

ALTER TABLE ims_orders
  ADD COLUMN IF NOT EXISTS delivery_date timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS delivery_status varchar(50) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS delivered_at timestamp NULL,
  ADD COLUMN IF NOT EXISTS delivered_by integer NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ims_orders_delivery_status_check'
  ) THEN
    ALTER TABLE ims_orders
      ADD CONSTRAINT ims_orders_delivery_status_check CHECK (delivery_status IN ('pending', 'out_for_delivery', 'delivered', 'failed_delivery'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ims_orders_delivered_by_ims_users_user_id_fk'
  ) THEN
    ALTER TABLE ims_orders
      ADD CONSTRAINT ims_orders_delivered_by_ims_users_user_id_fk
      FOREIGN KEY (delivered_by) REFERENCES ims_users(user_id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ims_orders_delivery_date_idx ON ims_orders(delivery_date);
CREATE INDEX IF NOT EXISTS ims_orders_delivery_status_idx ON ims_orders(delivery_status);
