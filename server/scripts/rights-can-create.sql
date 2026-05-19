-- Add create permission flag to rights (table-level permissions).
ALTER TABLE rights ADD COLUMN IF NOT EXISTS can_create BOOLEAN NOT NULL DEFAULT false;
