-- Add discount and delivery_fee columns to ims_orders
ALTER TABLE ims_orders
ADD COLUMN discount double precision NOT NULL DEFAULT 0,
ADD COLUMN delivery_fee double precision NOT NULL DEFAULT 0;