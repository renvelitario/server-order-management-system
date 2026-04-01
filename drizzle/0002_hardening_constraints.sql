-- Migration: hardening constraints for user identity and enums
-- Date: 2026-04-01

CREATE UNIQUE INDEX IF NOT EXISTS ims_users_email_unique ON ims_users(email);
CREATE UNIQUE INDEX IF NOT EXISTS ims_users_supabase_id_unique ON ims_users(supabase_id);

ALTER TABLE ims_users
  ALTER COLUMN supabase_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ims_users_acc_type_check'
  ) THEN
    ALTER TABLE ims_users
      ADD CONSTRAINT ims_users_acc_type_check CHECK (acc_type IN ('Admin', 'User'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ims_users_status_check'
  ) THEN
    ALTER TABLE ims_users
      ADD CONSTRAINT ims_users_status_check CHECK (status IN ('Active', 'Disabled', 'Suspended'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ims_users_inactivity_timeout_check'
  ) THEN
    ALTER TABLE ims_users
      ADD CONSTRAINT ims_users_inactivity_timeout_check CHECK (inactivity_timeout_minutes BETWEEN 10 AND 480);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ims_products_quantity_check'
  ) THEN
    ALTER TABLE ims_products
      ADD CONSTRAINT ims_products_quantity_check CHECK (quantity >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ims_products_price_check'
  ) THEN
    ALTER TABLE ims_products
      ADD CONSTRAINT ims_products_price_check CHECK (price >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ims_products_status_check'
  ) THEN
    ALTER TABLE ims_products
      ADD CONSTRAINT ims_products_status_check CHECK (status IN ('active', 'inactive'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ims_purchases_quantity_check'
  ) THEN
    ALTER TABLE ims_purchases
      ADD CONSTRAINT ims_purchases_quantity_check CHECK (quantity > 0);
  END IF;
END $$;
