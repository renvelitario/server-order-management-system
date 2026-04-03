-- Retire archived purchases feature tables/indexes from active schema.
-- Safe to run multiple times.

DROP INDEX IF EXISTS ims_purchases_purchase_date_idx;
DROP INDEX IF EXISTS idx_purchases_product_id;

DROP TABLE IF EXISTS ims_purchases;
