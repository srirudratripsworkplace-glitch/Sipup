-- Run only after reviewing and approving the import preview.
-- Existing data and stock values are preserved.
ALTER TABLE products ADD COLUMN catalogue_details JSON NULL;
