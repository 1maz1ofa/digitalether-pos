-- Allow users with access to all branches (location_id NULL = ALL).
ALTER TABLE users ALTER COLUMN location_id DROP NOT NULL;
