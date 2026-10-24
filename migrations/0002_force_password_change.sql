-- Force a password rotation before the administrator can use the vault.
ALTER TABLE admin_credentials ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 1;
-- Existing installations also need to rotate the credentials they already have.
UPDATE admin_credentials SET must_change_password = 1 WHERE id = 1;
