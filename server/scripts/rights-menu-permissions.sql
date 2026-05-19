-- Allow menu-level permissions on the rights table.
-- Run once against each environment (local, staging, production).

ALTER TABLE rights DROP CONSTRAINT IF EXISTS rights_object_type_chk;

ALTER TABLE rights
  ADD CONSTRAINT rights_object_type_chk
  CHECK (
    object_type::text = ANY (
      ARRAY['TABLE', 'FIELD', 'MENU', 'SUBMENU']::text[]
    )
  );

-- Older schemas may require table.column shape and reject menu ids like "pos".
ALTER TABLE rights DROP CONSTRAINT IF EXISTS rights_object_name_check;
