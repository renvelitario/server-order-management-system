ALTER TABLE ims_customers
  ADD COLUMN IF NOT EXISTS student_number varchar(20);

UPDATE ims_customers
SET student_number = 'TEMP-' || customer_id::text
WHERE student_number IS NULL OR trim(student_number) = '';

ALTER TABLE ims_customers
  ALTER COLUMN student_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ims_customers_student_number_unique
  ON ims_customers (student_number);
