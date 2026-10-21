-- Creates the Super Admin (owner) and Admin accounts. Import in phpMyAdmin with the "beyondwires" database selected.
-- Logins:  owner@beyondwires.com / OwnerPass123   (Super Admin)
--          admin@beyondwires.com / AdminPass123   (Admin)
-- The passwords are stored as hashes. Change them after logging in (Settings > Change password).
-- Accounts that already exist are left untouched.
USE beyondwires;
INSERT IGNORE INTO users (first_name, last_name, email, password_hash, role) VALUES
('Owner', 'BeyondWires', 'owner@beyondwires.com', '$2y$10$dkaq2M0sSpin4YyafKgfj.2dz8JW.mEE.5WqI4DfM/srioQKScBzq', 'superadmin'),
('Admin', 'NOC',         'admin@beyondwires.com', '$2y$10$NrJiQv7toJpP12b0VoDXlOSkYhnp/8SFEov8lQRYBAeaipIanSLkq', 'admin');
