-- =====================================================================
-- BeyondWires database update (October 2026)  |  update_2026_10.sql
-- Brings an EXISTING beyondwires database up to date for the new pages.
--
--   * Sections 1-9 are additive only: new columns and new tables. No table,
--     column or row is renamed or deleted. Existing data and relationships are kept.
--   * Section 10 (at the end) updates the product catalog: suppliers and pricelists.
--   * Safe to run more than once (IF NOT EXISTS / INSERT IGNORE).
--   * Written for MariaDB 10.3+ (the database that ships with XAMPP).
--
-- How to run (pick one):
--   a) phpMyAdmin > select the "beyondwires" database > Import > this file > Go
--   b) Command line:  C:\xampp\php\php.exe migrate.php
-- Back up first: phpMyAdmin > beyondwires > Export > Go.
-- =====================================================================
USE beyondwires;

-- ---------- 1. Catalog: packages, supplier, icon, price history ----------
ALTER TABLE products MODIFY item_type ENUM('product','service','package') NOT NULL DEFAULT 'product';
ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier VARCHAR(80) NULL AFTER specs;
ALTER TABLE products ADD COLUMN IF NOT EXISTS icon VARCHAR(40) NULL AFTER supplier;
ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at DATETIME NULL;

CREATE TABLE IF NOT EXISTS product_price_history (
  history_id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  old_price DECIMAL(12,2) NOT NULL,
  new_price DECIMAL(12,2) NOT NULL,
  note VARCHAR(120),
  changed_by INT NULL,
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
  FOREIGN KEY (changed_by) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------- 2. Inquiries: package option, budget, NCR rejection, multi-inquiry form ----------
ALTER TABLE service_inquiries MODIFY purchase_option ENUM('service','product','both','package') NOT NULL;
ALTER TABLE service_inquiries ADD COLUMN IF NOT EXISTS budget_range VARCHAR(60) NULL AFTER requirements;
ALTER TABLE service_inquiries ADD COLUMN IF NOT EXISTS submission_ref VARCHAR(24) NULL;
ALTER TABLE service_inquiries ADD COLUMN IF NOT EXISTS rejection_reason VARCHAR(120) NULL;
ALTER TABLE service_inquiries ADD COLUMN IF NOT EXISTS rejection_note VARCHAR(400) NULL;
ALTER TABLE service_inquiries ADD COLUMN IF NOT EXISTS rejected_at DATETIME NULL;

-- ---------- 3. Calendar: admin-published slots (any time, not only 4 fixed ones) ----------
-- time_slot was ENUM('8:00 AM','10:30 AM','1:00 PM','3:30 PM'); existing values stay valid.
ALTER TABLE installation_schedules MODIFY time_slot VARCHAR(10) NOT NULL;
ALTER TABLE installation_schedules ADD COLUMN IF NOT EXISTS previous_date DATE NULL;
ALTER TABLE installation_schedules ADD COLUMN IF NOT EXISTS previous_slot VARCHAR(10) NULL;
ALTER TABLE installation_schedules ADD COLUMN IF NOT EXISTS change_reason VARCHAR(255) NULL;
ALTER TABLE installation_schedules ADD COLUMN IF NOT EXISTS changed_at DATETIME NULL;

CREATE TABLE IF NOT EXISTS schedule_availability (     -- one row per published (date, time) slot
  available_date DATE NOT NULL,
  time_slot VARCHAR(10) NOT NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (available_date, time_slot),
  FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- First run only: publish the standard hours for the next 3 weeks (Sundays closed),
-- so customers can book right away. The admin edits these on the Schedules tab.
INSERT IGNORE INTO schedule_availability (available_date, time_slot)
SELECT d.x, t.s FROM (SELECT CURDATE() + INTERVAL n.n DAY x FROM (SELECT 1 n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12 UNION ALL SELECT 13 UNION ALL SELECT 14 UNION ALL SELECT 15 UNION ALL SELECT 16 UNION ALL SELECT 17 UNION ALL SELECT 18 UNION ALL SELECT 19 UNION ALL SELECT 20 UNION ALL SELECT 21) n) d
CROSS JOIN (SELECT '9:00 AM' s UNION ALL SELECT '10:30 AM' UNION ALL SELECT '1:00 PM' UNION ALL SELECT '3:30 PM') t
WHERE DAYOFWEEK(d.x) <> 1 AND NOT EXISTS (SELECT 1 FROM schedule_availability);
-- Every time that is already booked is published too, so existing bookings show on both calendars.
INSERT IGNORE INTO schedule_availability (available_date, time_slot)
SELECT scheduled_date, time_slot FROM installation_schedules WHERE status IN ('Requested','Confirmed');

-- ---------- 4. Quotations: labor, VAT and the details printed on the quotation ----------
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS labor_total DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER other_charges_total;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS vat_amount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER labor_total;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS no_labor TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS scope_of_work TEXT NULL;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS project_title VARCHAR(120) NULL;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS duration VARCHAR(60) NULL;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS site_address VARCHAR(160) NULL;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS project_incharge VARCHAR(60) NULL;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(120) NULL;

CREATE TABLE IF NOT EXISTS quotation_labor (           -- assigned workers: role x workers x days x daily rate
  labor_id INT AUTO_INCREMENT PRIMARY KEY,
  quotation_id INT NOT NULL,
  role VARCHAR(40) NOT NULL,
  workers INT NOT NULL,
  days INT NOT NULL,
  daily_rate DECIMAL(12,2) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  FOREIGN KEY (quotation_id) REFERENCES quotations(quotation_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS quotation_events (          -- the "Activity" list on a quotation
  event_id INT AUTO_INCREMENT PRIMARY KEY,
  quotation_id INT NOT NULL,
  event VARCHAR(160) NOT NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (quotation_id) REFERENCES quotations(quotation_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------- 5. Projects: installation progress, checklist, certificate ----------
ALTER TABLE projects ADD COLUMN IF NOT EXISTS install_status ENUM('Scheduled','In progress','Completed') NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS checklist TEXT NULL;            -- JSON [{label,state}]

-- projects created before this update: show their installation step correctly
UPDATE projects p SET p.install_status = 'Completed' WHERE p.install_status IS NULL AND p.status = 'Done';
UPDATE projects p SET p.install_status = 'Scheduled'
 WHERE p.install_status IS NULL AND p.status <> 'Done'
   AND EXISTS (SELECT 1 FROM quotations q JOIN installation_schedules s ON s.quotation_id = q.quotation_id
               WHERE q.project_id = p.project_id AND s.activity_type = 'Installation' AND s.status IN ('Requested','Confirmed'));

CREATE TABLE IF NOT EXISTS project_certificates (      -- installation certificate + accomplishment report
  project_id INT PRIMARY KEY,
  data MEDIUMTEXT NOT NULL,                            -- JSON of the certificate fields
  sent_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS certificate_photos (
  photo_id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  file_path VARCHAR(255) NOT NULL,
  caption VARCHAR(60),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------- 6. Receipts: "sent to customer" ----------
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS sent_at DATETIME NULL;
-- receipts issued before this update are treated as already sent (the old flow published them right away)
UPDATE receipts SET sent_at = issued_at WHERE sent_at IS NULL AND file_path IS NOT NULL;

-- ---------- 7. Notifications open the related record ----------
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link VARCHAR(60) NULL;     -- e.g. "quotation:12", "project:3"

-- ---------- 8. Customer primary contact (Settings > Contacts) ----------
ALTER TABLE customers ADD COLUMN IF NOT EXISTS contact_name VARCHAR(120) NULL;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS contact_role VARCHAR(50) NULL;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS contact_email VARCHAR(120) NULL;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(30) NULL;

-- ---------- 9. Sample packages (added once, only if the catalog has none) ----------
INSERT INTO products (name, description, category, item_type, specs, unit_price)
SELECT * FROM (
  SELECT '4-Camera Home CCTV Package' n, '4 cameras, 4-ch DVR, cabling and installation' d, 'CCTV Packages' c, 'package' t, NULL s, 18500.00 p UNION ALL
  SELECT '8-Camera Business CCTV Package', '8 IP cameras, 8-ch NVR, PoE, cabling and installation', 'CCTV Packages', 'package', NULL, 52000.00 UNION ALL
  SELECT '2-Door Access Control Package', '2 smart locks with access terminal and installation', 'Access Control Packages', 'package', NULL, 21500.00
) x WHERE NOT EXISTS (SELECT 1 FROM products WHERE item_type = 'package');

-- ---------- 10. Suppliers and supplier pricelists (added Oct 20, 2026) ----------
-- Your database already has sections 1-9, so apply ONLY this section:
--   phpMyAdmin > click "beyondwires" > SQL tab > paste everything from the
--   line above down to the end of the file > Go.  (Back up first: Export.)
-- * Adds the Hikvision kits (Nanotec Corp. pricelist), the Dahua kits (Dahua
--   pricelist 02.2024), the Dahua/Hikvision CCTV package pricelist (2 to 16
--   cameras) and the 2/3/4-Channel CCTV Packages from the package poster.
-- * Adds sample suppliers with their own products, and gives the existing
--   products a supplier (only where none is set yet).
-- * Services are not touched. "4-Camera Home CCTV Package" is ARCHIVED (not
--   deleted) because the poster's 4-Channel package replaces it. Existing
--   quotations keep their items and prices. Safe to run more than once.

DROP TEMPORARY TABLE IF EXISTS bw_import;
-- same column types and collation as the products table
CREATE TEMPORARY TABLE bw_import AS
  SELECT name, description, category, item_type, supplier, icon, unit_price FROM products WHERE 1 = 0;

INSERT INTO bw_import (name, description, category, item_type, supplier, icon, unit_price) VALUES
('500GB Surveillance HDD','3.5" surveillance-grade hard drive for DVR/NVR recording','Recorders & Storage','product','Northpoint Security Distribution','fa-database',2100.00),
('4-Channel DVR','4-channel 1080P hybrid DVR with mobile app viewing','Recorders & Storage','product','Northpoint Security Distribution','fa-hard-drive',3900.00),
('IP Camera 4MP (Turret)','4MP PoE turret camera, 30m IR night vision, IP67','Cameras','product','Northpoint Security Distribution','fa-video',3600.00),
('RG59 Siamese Cable (305m Box)','Coaxial video + power cable for analog/HD CCTV','Power & Cabling','product','Cablenet Electrical Supply','fa-network-wired',3200.00),
('BNC & DC Connector Set (10 pairs)','Twist-on BNC and DC male connectors','Power & Cabling','product','Cablenet Electrical Supply','fa-plug',450.00),
('12V 10A CCTV Power Supply Box','Centralized 9-output power supply for up to 8 cameras','Power & Cabling','product','Cablenet Electrical Supply','fa-car-battery',1450.00),
('Magnetic Door Lock 600lbs','Electromagnetic lock with mounting bracket','Access Control','product','Lockwise Access Systems','fa-door-closed',2800.00),
('Exit Push Button','Stainless request-to-exit button','Access Control','product','Lockwise Access Systems','fa-hand-pointer',350.00),
('Solar Streetlight 100W','All-in-one solar streetlight with motion sensor and remote','Solar & Lighting','product','Sunvolt Solar Trading','fa-solar-panel',24500.00),
('Hikvision 2MP 4CH HDTVI Combo Kit (TVI-4CH2D2B-2MP Eco 2.8mm)','DS-7204HGHI-M1 DVR, 2x DS-2CE76D0T-EXIPF turret, 2x DS-2CE16D0T-EXIPF bullet (2.8mm). 2-yr warranty','CCTV Kits','product','Nanotec Corp. (Hikvision)','fa-video',6110.00),
('Hikvision 2MP 8CH HDTVI Combo Kit (TVI-8CH4D4B-2MP Eco 2.8mm)','DS-7208HGHI-M1 DVR, 4x DS-2CE76D0T-EXIPF turret, 4x DS-2CE16D0T-EXIPF bullet (2.8mm). 2-yr warranty','CCTV Kits','product','Nanotec Corp. (Hikvision)','fa-video',10270.00),
('Hikvision 2MP 4CH Lite ColorVu Kit with Mic (2.8mm)','TVI-Lite-4CH2D2B-2MP-ColorVu(2.8): DS-7204HGHI-M1 DVR, 2x DS-2CE10DF3T-PFS, 2x DS-2CE70DF3T-PFS. Built-in mic. 2-yr warranty','CCTV Kits','product','Nanotec Corp. (Hikvision)','fa-video',9430.00),
('Hikvision 2MP 4CH Lite ColorVu Kit with Mic (3.6mm)','TVI-Lite-4CH2D2B-2MP-ColorVu: DS-7204HGHI-K1(S) DVR, 2x DS-2CE10DF3T-PFS, 2x DS-2CE70DF3T-PFS. Built-in mic. 2-yr warranty','CCTV Kits','product','Nanotec Corp. (Hikvision)','fa-video',9430.00),
('Hikvision 2MP 8CH Lite ColorVu Kit with Mic (2.8mm)','TVI-Lite-8CH4D4B-2MP-ColorVu(2.8): DS-7208HGHI-M1 DVR, 4x DS-2CE10DF3T-PFS, 4x DS-2CE70DF3T-PFS. Built-in mic. 2-yr warranty','CCTV Kits','product','Nanotec Corp. (Hikvision)','fa-video',16970.00),
('Hikvision 5MP 4CH HDTVI Combo Kit (TVI-4CH2D2B-5MP)','DS-7204HUHI-K1/E(S) DVR, 2x DS-2CE16H0T-ITPF(C) bullet, 2x DS-2CE76H0T-ITPF(C) turret. 2-yr warranty','CCTV Kits','product','Nanotec Corp. (Hikvision)','fa-video',10170.00),
('Hikvision 5MP 8CH HDTVI Combo Kit (TVI-8CH4D4B-5MP)','DS-7208HUHI-K1/E(S) DVR, 4x DS-2CE16H0T-ITPF(C) bullet, 4x DS-2CE76H0T-ITPF(C) turret. 2-yr warranty','CCTV Kits','product','Nanotec Corp. (Hikvision)','fa-video',18850.00),
('Hikvision 2MP 2CH Wi-Fi Kit, 2 Bullet (NKS422W0H)','DS-7104NI-S1/W NVR, 2x IPC-B120HA-LIDF/W bullet. 2-yr warranty','Wi-Fi CCTV Kits','product','Nanotec Corp. (Hikvision)','fa-wifi',3940.00),
('Hikvision 2MP 2CH Wi-Fi Kit, Bullet + Turret (NKS422W02H)','DS-7104NI-S1/W NVR, 1x IPC-B120HA-LIDF/W bullet, 1x IPC-F120-LIDF/W turret. 2-yr warranty','Wi-Fi CCTV Kits','product','Nanotec Corp. (Hikvision)','fa-wifi',4280.00),
('Hikvision 2MP 4CH Wi-Fi Combo Kit (NK42W0H(D))','DS-7104NI-K1/W/M(C) NVR, 4x DS-2CV1021G1-IDW (2.8mm). 2-yr warranty','Wi-Fi CCTV Kits','product','Nanotec Corp. (Hikvision)','fa-wifi',12460.00),
('Hikvision 4MP 4CH Wi-Fi Combo Kit (NK44W0H(D))','DS-7104NI-K1/W/M(C) NVR, 4x DS-2CV1041G1-IDW (2.8mm). 2-yr warranty','Wi-Fi CCTV Kits','product','Nanotec Corp. (Hikvision)','fa-wifi',16730.00),
('Dahua 2MP 4CH HDCVI Kit (DH-KIT1B04)','1x DH-XVR1B04 DVR, 2x HAC-B1A21N bullet, 2x HAC-T1A21N turret','CCTV Kits','product','Dahua Technology','fa-video',6210.00),
('Dahua 2MP 8CH HDCVI Kit (DH-KIT1B08)','1x DH-XVR1B08 DVR, 4x HAC-B1A21N bullet, 4x HAC-T1A21N turret','CCTV Kits','product','Dahua Technology','fa-video',10430.00),
('Dahua 2MP 4CH WizSense Kit (DH-KIT-CVI2MP2B2T-I)','1x XVR1B04-I DVR, 2x B1A21N-0360B bullet, 2x T1A21N-0360B turret','CCTV Kits','product','Dahua Technology','fa-video',6210.00),
('Dahua 2MP 8CH WizSense Kit (DH-KIT-CVI2MP4B4T-I)','1x XVR1B08-I DVR, 4x B1A21N-0360B bullet, 4x T1A21N-0360B turret','CCTV Kits','product','Dahua Technology','fa-video',10430.00),
('Dahua 2MP 4CH Full Color Kit (DH-KIT-CVI2MP2B2T-I)','1x XVR1B04-I DVR, 2x HFW1239CN-A-LED bullet, 2x HDW1239TLQN-A-LED turret','CCTV Kits','product','Dahua Technology','fa-video',11740.00),
('Dahua 2MP 8CH Full Color Kit (DH-KIT-CVI2MP4B4T-I)','1x XVR1B08-I DVR, 4x HFW1239CN-A-LED bullet, 4x HDW1239TLQN-A-LED turret','CCTV Kits','product','Dahua Technology','fa-video',21520.00),
('Dahua 2MP 4CH SDL Kit (DH-KIT-CVI2MP2B2T-SDL)','1x DH-XVR1B04-I DVR, 2x HFW1239TLMN-IL-A bullet, 2x HDW1239TLQN-IL-A turret, 4 video power cables, 1 power adapter','CCTV Kits','product','Dahua Technology','fa-video',13385.00),
('Dahua 2MP 8CH SDL Kit (DH-KIT-CVI2MP4B4T-SDL)','1x DH-XVR1B08-I DVR, 4x HFW1239TLMN-IL-A bullet, 4x HDW1239TLQN-IL-A turret, 8 video power cables, 2 power adapters','CCTV Kits','product','Dahua Technology','fa-video',24815.00),
('2-Channel CCTV Package','Perfect for small spaces. 2 cameras with built-in mic, 1 DVR, 1 500GB HDD, all accessories, free installation. 1-yr product, 90-day service warranty','CCTV Packages','package',NULL,'fa-box-open',8500.00),
('3-Channel CCTV Package','Ideal for homes & small businesses. 3 cameras with built-in mic, 1 DVR, 1 500GB HDD, all accessories, free installation. 1-yr product, 90-day service warranty','CCTV Packages','package',NULL,'fa-box-open',12500.00),
('4-Channel CCTV Package','Complete coverage for your property. 4 cameras with built-in mic, 1 DVR, 1 500GB HDD, all accessories, free installation. 1-yr product, 90-day service warranty','CCTV Packages','package',NULL,'fa-box-open',16500.00),
('2-Channel CCTV Set, 2MP/1080P Standard','2 cameras (2MP/1080P, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',7000.00),
('2-Channel CCTV Set, 2MP/1080P Full Color','2 cameras (2MP/1080P, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',9000.00),
('2-Channel CCTV Set, 2MP/1080P with Built-in Mic','2 cameras (2MP/1080P, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',8000.00),
('2-Channel CCTV Set, 2MP/1080P Full Color with Mic','2 cameras (2MP/1080P, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',10000.00),
('2-Channel CCTV Set, 5MP/3K Standard','2 cameras (5MP/3K, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',10000.00),
('2-Channel CCTV Set, 5MP/3K Full Color','2 cameras (5MP/3K, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',12000.00),
('2-Channel CCTV Set, 5MP/3K with Built-in Mic','2 cameras (5MP/3K, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',11000.00),
('2-Channel CCTV Set, 5MP/3K Full Color with Mic','2 cameras (5MP/3K, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',13000.00),
('3-Channel CCTV Set, 2MP/1080P Standard','3 cameras (2MP/1080P, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',10500.00),
('3-Channel CCTV Set, 2MP/1080P Full Color','3 cameras (2MP/1080P, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',13500.00),
('3-Channel CCTV Set, 2MP/1080P with Built-in Mic','3 cameras (2MP/1080P, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',12000.00),
('3-Channel CCTV Set, 2MP/1080P Full Color with Mic','3 cameras (2MP/1080P, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',15000.00),
('3-Channel CCTV Set, 5MP/3K Standard','3 cameras (5MP/3K, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',15000.00),
('3-Channel CCTV Set, 5MP/3K Full Color','3 cameras (5MP/3K, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',18000.00),
('3-Channel CCTV Set, 5MP/3K with Built-in Mic','3 cameras (5MP/3K, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',16500.00),
('3-Channel CCTV Set, 5MP/3K Full Color with Mic','3 cameras (5MP/3K, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',19500.00),
('4-Channel CCTV Set, 2MP/1080P Standard','4 cameras (2MP/1080P, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',14000.00),
('4-Channel CCTV Set, 2MP/1080P Full Color','4 cameras (2MP/1080P, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',18000.00),
('4-Channel CCTV Set, 2MP/1080P with Built-in Mic','4 cameras (2MP/1080P, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',16000.00),
('4-Channel CCTV Set, 2MP/1080P Full Color with Mic','4 cameras (2MP/1080P, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',20000.00),
('4-Channel CCTV Set, 5MP/3K Standard','4 cameras (5MP/3K, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',20000.00),
('4-Channel CCTV Set, 5MP/3K Full Color','4 cameras (5MP/3K, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',24000.00),
('4-Channel CCTV Set, 5MP/3K with Built-in Mic','4 cameras (5MP/3K, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',22000.00),
('4-Channel CCTV Set, 5MP/3K Full Color with Mic','4 cameras (5MP/3K, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',26000.00),
('5-Channel CCTV Set, 2MP/1080P Standard','5 cameras (2MP/1080P, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',17500.00),
('5-Channel CCTV Set, 2MP/1080P Full Color','5 cameras (2MP/1080P, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',22500.00),
('5-Channel CCTV Set, 2MP/1080P with Built-in Mic','5 cameras (2MP/1080P, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',20000.00),
('5-Channel CCTV Set, 2MP/1080P Full Color with Mic','5 cameras (2MP/1080P, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',25000.00),
('5-Channel CCTV Set, 5MP/3K Standard','5 cameras (5MP/3K, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',25000.00),
('5-Channel CCTV Set, 5MP/3K Full Color','5 cameras (5MP/3K, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',30000.00),
('5-Channel CCTV Set, 5MP/3K with Built-in Mic','5 cameras (5MP/3K, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',27500.00),
('5-Channel CCTV Set, 5MP/3K Full Color with Mic','5 cameras (5MP/3K, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',32500.00),
('6-Channel CCTV Set, 2MP/1080P Standard','6 cameras (2MP/1080P, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',21000.00),
('6-Channel CCTV Set, 2MP/1080P Full Color','6 cameras (2MP/1080P, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',27000.00),
('6-Channel CCTV Set, 2MP/1080P with Built-in Mic','6 cameras (2MP/1080P, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',24000.00),
('6-Channel CCTV Set, 2MP/1080P Full Color with Mic','6 cameras (2MP/1080P, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',30000.00),
('6-Channel CCTV Set, 5MP/3K Standard','6 cameras (5MP/3K, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',30000.00),
('6-Channel CCTV Set, 5MP/3K Full Color','6 cameras (5MP/3K, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',36000.00),
('6-Channel CCTV Set, 5MP/3K with Built-in Mic','6 cameras (5MP/3K, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',33000.00),
('6-Channel CCTV Set, 5MP/3K Full Color with Mic','6 cameras (5MP/3K, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',39000.00),
('7-Channel CCTV Set, 2MP/1080P Standard','7 cameras (2MP/1080P, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',24500.00),
('7-Channel CCTV Set, 2MP/1080P Full Color','7 cameras (2MP/1080P, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',31500.00),
('7-Channel CCTV Set, 2MP/1080P with Built-in Mic','7 cameras (2MP/1080P, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',28000.00),
('7-Channel CCTV Set, 2MP/1080P Full Color with Mic','7 cameras (2MP/1080P, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',35000.00),
('7-Channel CCTV Set, 5MP/3K Standard','7 cameras (5MP/3K, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',35000.00),
('7-Channel CCTV Set, 5MP/3K Full Color','7 cameras (5MP/3K, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',42000.00),
('7-Channel CCTV Set, 5MP/3K with Built-in Mic','7 cameras (5MP/3K, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',38500.00),
('7-Channel CCTV Set, 5MP/3K Full Color with Mic','7 cameras (5MP/3K, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',45500.00),
('8-Channel CCTV Set, 2MP/1080P Standard','8 cameras (2MP/1080P, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',28000.00),
('8-Channel CCTV Set, 2MP/1080P Full Color','8 cameras (2MP/1080P, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',36000.00),
('8-Channel CCTV Set, 2MP/1080P with Built-in Mic','8 cameras (2MP/1080P, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',32000.00),
('8-Channel CCTV Set, 2MP/1080P Full Color with Mic','8 cameras (2MP/1080P, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',40000.00),
('8-Channel CCTV Set, 5MP/3K Standard','8 cameras (5MP/3K, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',40000.00),
('8-Channel CCTV Set, 5MP/3K Full Color','8 cameras (5MP/3K, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',48000.00),
('8-Channel CCTV Set, 5MP/3K with Built-in Mic','8 cameras (5MP/3K, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',44000.00),
('8-Channel CCTV Set, 5MP/3K Full Color with Mic','8 cameras (5MP/3K, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',52000.00),
('9-Channel CCTV Set, 2MP/1080P Standard','9 cameras (2MP/1080P, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',31500.00),
('9-Channel CCTV Set, 2MP/1080P Full Color','9 cameras (2MP/1080P, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',40500.00),
('9-Channel CCTV Set, 2MP/1080P with Built-in Mic','9 cameras (2MP/1080P, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',36000.00),
('9-Channel CCTV Set, 2MP/1080P Full Color with Mic','9 cameras (2MP/1080P, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',45000.00),
('9-Channel CCTV Set, 5MP/3K Standard','9 cameras (5MP/3K, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',45000.00),
('9-Channel CCTV Set, 5MP/3K Full Color','9 cameras (5MP/3K, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',54000.00),
('9-Channel CCTV Set, 5MP/3K with Built-in Mic','9 cameras (5MP/3K, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',49500.00),
('9-Channel CCTV Set, 5MP/3K Full Color with Mic','9 cameras (5MP/3K, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',58500.00),
('10-Channel CCTV Set, 2MP/1080P Standard','10 cameras (2MP/1080P, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',35000.00),
('10-Channel CCTV Set, 2MP/1080P Full Color','10 cameras (2MP/1080P, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',45000.00),
('10-Channel CCTV Set, 2MP/1080P with Built-in Mic','10 cameras (2MP/1080P, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',40000.00),
('10-Channel CCTV Set, 2MP/1080P Full Color with Mic','10 cameras (2MP/1080P, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',50000.00),
('10-Channel CCTV Set, 5MP/3K Standard','10 cameras (5MP/3K, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',50000.00),
('10-Channel CCTV Set, 5MP/3K Full Color','10 cameras (5MP/3K, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',60000.00),
('10-Channel CCTV Set, 5MP/3K with Built-in Mic','10 cameras (5MP/3K, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',55000.00),
('10-Channel CCTV Set, 5MP/3K Full Color with Mic','10 cameras (5MP/3K, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',65000.00),
('11-Channel CCTV Set, 2MP/1080P Standard','11 cameras (2MP/1080P, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',38500.00),
('11-Channel CCTV Set, 2MP/1080P Full Color','11 cameras (2MP/1080P, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',49500.00),
('11-Channel CCTV Set, 2MP/1080P with Built-in Mic','11 cameras (2MP/1080P, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',44000.00),
('11-Channel CCTV Set, 2MP/1080P Full Color with Mic','11 cameras (2MP/1080P, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',55000.00),
('11-Channel CCTV Set, 5MP/3K Standard','11 cameras (5MP/3K, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',55000.00),
('11-Channel CCTV Set, 5MP/3K Full Color','11 cameras (5MP/3K, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',66000.00),
('11-Channel CCTV Set, 5MP/3K with Built-in Mic','11 cameras (5MP/3K, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',60500.00),
('11-Channel CCTV Set, 5MP/3K Full Color with Mic','11 cameras (5MP/3K, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',71500.00),
('12-Channel CCTV Set, 2MP/1080P Standard','12 cameras (2MP/1080P, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',42000.00),
('12-Channel CCTV Set, 2MP/1080P Full Color','12 cameras (2MP/1080P, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',54000.00),
('12-Channel CCTV Set, 2MP/1080P with Built-in Mic','12 cameras (2MP/1080P, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',48000.00),
('12-Channel CCTV Set, 2MP/1080P Full Color with Mic','12 cameras (2MP/1080P, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',60000.00),
('12-Channel CCTV Set, 5MP/3K Standard','12 cameras (5MP/3K, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',60000.00),
('12-Channel CCTV Set, 5MP/3K Full Color','12 cameras (5MP/3K, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',72000.00),
('12-Channel CCTV Set, 5MP/3K with Built-in Mic','12 cameras (5MP/3K, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',66000.00),
('12-Channel CCTV Set, 5MP/3K Full Color with Mic','12 cameras (5MP/3K, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',78000.00),
('13-Channel CCTV Set, 2MP/1080P Standard','13 cameras (2MP/1080P, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',45500.00),
('13-Channel CCTV Set, 2MP/1080P Full Color','13 cameras (2MP/1080P, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',58500.00),
('13-Channel CCTV Set, 2MP/1080P with Built-in Mic','13 cameras (2MP/1080P, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',52000.00),
('13-Channel CCTV Set, 2MP/1080P Full Color with Mic','13 cameras (2MP/1080P, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',65000.00),
('13-Channel CCTV Set, 5MP/3K Standard','13 cameras (5MP/3K, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',65000.00),
('13-Channel CCTV Set, 5MP/3K Full Color','13 cameras (5MP/3K, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',78000.00),
('13-Channel CCTV Set, 5MP/3K with Built-in Mic','13 cameras (5MP/3K, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',71500.00),
('13-Channel CCTV Set, 5MP/3K Full Color with Mic','13 cameras (5MP/3K, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',84500.00),
('14-Channel CCTV Set, 2MP/1080P Standard','14 cameras (2MP/1080P, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',49000.00),
('14-Channel CCTV Set, 2MP/1080P Full Color','14 cameras (2MP/1080P, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',63000.00),
('14-Channel CCTV Set, 2MP/1080P with Built-in Mic','14 cameras (2MP/1080P, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',56000.00),
('14-Channel CCTV Set, 2MP/1080P Full Color with Mic','14 cameras (2MP/1080P, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',70000.00),
('14-Channel CCTV Set, 5MP/3K Standard','14 cameras (5MP/3K, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',70000.00),
('14-Channel CCTV Set, 5MP/3K Full Color','14 cameras (5MP/3K, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',84000.00),
('14-Channel CCTV Set, 5MP/3K with Built-in Mic','14 cameras (5MP/3K, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',77000.00),
('14-Channel CCTV Set, 5MP/3K Full Color with Mic','14 cameras (5MP/3K, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',91000.00),
('15-Channel CCTV Set, 2MP/1080P Standard','15 cameras (2MP/1080P, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',52500.00),
('15-Channel CCTV Set, 2MP/1080P Full Color','15 cameras (2MP/1080P, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',67500.00),
('15-Channel CCTV Set, 2MP/1080P with Built-in Mic','15 cameras (2MP/1080P, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',60000.00),
('15-Channel CCTV Set, 2MP/1080P Full Color with Mic','15 cameras (2MP/1080P, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',75000.00),
('15-Channel CCTV Set, 5MP/3K Standard','15 cameras (5MP/3K, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',75000.00),
('15-Channel CCTV Set, 5MP/3K Full Color','15 cameras (5MP/3K, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',90000.00),
('15-Channel CCTV Set, 5MP/3K with Built-in Mic','15 cameras (5MP/3K, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',82500.00),
('15-Channel CCTV Set, 5MP/3K Full Color with Mic','15 cameras (5MP/3K, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',97500.00),
('16-Channel CCTV Set, 2MP/1080P Standard','16 cameras (2MP/1080P, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',56000.00),
('16-Channel CCTV Set, 2MP/1080P Full Color','16 cameras (2MP/1080P, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',72000.00),
('16-Channel CCTV Set, 2MP/1080P with Built-in Mic','16 cameras (2MP/1080P, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',64000.00),
('16-Channel CCTV Set, 2MP/1080P Full Color with Mic','16 cameras (2MP/1080P, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',80000.00),
('16-Channel CCTV Set, 5MP/3K Standard','16 cameras (5MP/3K, standard) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',80000.00),
('16-Channel CCTV Set, 5MP/3K Full Color','16 cameras (5MP/3K, full color) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',96000.00),
('16-Channel CCTV Set, 5MP/3K with Built-in Mic','16 cameras (5MP/3K, with built-in mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',88000.00),
('16-Channel CCTV Set, 5MP/3K Full Color with Mic','16 cameras (5MP/3K, full color with mic) with DVR. Dahua/Hikvision package pricelist','CCTV Package Sets','product','Dahua & Hikvision Package Pricelist','fa-layer-group',104000.00);

-- 10a. Items that already exist (same name): log any price change, then update them
INSERT INTO product_price_history (product_id, old_price, new_price, note)
SELECT p.product_id, p.unit_price, i.unit_price, 'Supplier pricelist update'
FROM products p JOIN bw_import i ON LOWER(p.name) = LOWER(i.name)
WHERE ABS(p.unit_price - i.unit_price) > 0.001;

UPDATE products p JOIN bw_import i ON LOWER(p.name) = LOWER(i.name)
SET p.description = i.description, p.category = i.category, p.item_type = i.item_type,
    p.supplier = i.supplier, p.icon = i.icon, p.unit_price = i.unit_price, p.is_active = 1, p.updated_at = NOW();

-- 10b. New items
INSERT INTO products (name, description, category, item_type, supplier, icon, unit_price, is_active, updated_at)
SELECT i.name, i.description, i.category, i.item_type, i.supplier, i.icon, i.unit_price, 1, NOW()
FROM bw_import i LEFT JOIN products p ON LOWER(p.name) = LOWER(i.name)
WHERE p.product_id IS NULL;

-- 10c. Give the existing products a supplier (only if they have none yet; names, prices and descriptions stay the same)
UPDATE products SET supplier = 'Northpoint Security Distribution', updated_at = NOW() WHERE LOWER(name) = LOWER('IP Camera (Dome)') AND (supplier IS NULL OR supplier = '');
UPDATE products SET supplier = 'Northpoint Security Distribution', updated_at = NOW() WHERE LOWER(name) = LOWER('IP Camera (Bullet)') AND (supplier IS NULL OR supplier = '');
UPDATE products SET supplier = 'Northpoint Security Distribution', updated_at = NOW() WHERE LOWER(name) = LOWER('PTZ Camera 4MP') AND (supplier IS NULL OR supplier = '');
UPDATE products SET supplier = 'Northpoint Security Distribution', updated_at = NOW() WHERE LOWER(name) = LOWER('Wi-Fi Indoor Camera') AND (supplier IS NULL OR supplier = '');
UPDATE products SET supplier = 'Northpoint Security Distribution', updated_at = NOW() WHERE LOWER(name) = LOWER('8-Channel DVR') AND (supplier IS NULL OR supplier = '');
UPDATE products SET supplier = 'Northpoint Security Distribution', updated_at = NOW() WHERE LOWER(name) = LOWER('16-Channel DVR') AND (supplier IS NULL OR supplier = '');
UPDATE products SET supplier = 'Northpoint Security Distribution', updated_at = NOW() WHERE LOWER(name) = LOWER('16-Channel NVR') AND (supplier IS NULL OR supplier = '');
UPDATE products SET supplier = 'Northpoint Security Distribution', updated_at = NOW() WHERE LOWER(name) = LOWER('1TB Surveillance HDD') AND (supplier IS NULL OR supplier = '');
UPDATE products SET supplier = 'Northpoint Security Distribution', updated_at = NOW() WHERE LOWER(name) = LOWER('2TB Surveillance HDD') AND (supplier IS NULL OR supplier = '');
UPDATE products SET supplier = 'Cablenet Electrical Supply', updated_at = NOW() WHERE LOWER(name) = LOWER('Power Adapter & Connectors') AND (supplier IS NULL OR supplier = '');
UPDATE products SET supplier = 'Cablenet Electrical Supply', updated_at = NOW() WHERE LOWER(name) = LOWER('Cat6 Cable (305m Box)') AND (supplier IS NULL OR supplier = '');
UPDATE products SET supplier = 'Cablenet Electrical Supply', updated_at = NOW() WHERE LOWER(name) = LOWER('PoE Switch 8-Port') AND (supplier IS NULL OR supplier = '');
UPDATE products SET supplier = 'Cablenet Electrical Supply', updated_at = NOW() WHERE LOWER(name) = LOWER('UPS 650VA') AND (supplier IS NULL OR supplier = '');
UPDATE products SET supplier = 'Lockwise Access Systems', updated_at = NOW() WHERE LOWER(name) = LOWER('Fingerprint Door Lock') AND (supplier IS NULL OR supplier = '');
UPDATE products SET supplier = 'Lockwise Access Systems', updated_at = NOW() WHERE LOWER(name) = LOWER('Video Doorbell') AND (supplier IS NULL OR supplier = '');
UPDATE products SET supplier = 'Lockwise Access Systems', updated_at = NOW() WHERE LOWER(name) = LOWER('Gate Access Controller') AND (supplier IS NULL OR supplier = '');
UPDATE products SET supplier = 'Sunvolt Solar Trading', updated_at = NOW() WHERE LOWER(name) = LOWER('Solar Streetlight 60W') AND (supplier IS NULL OR supplier = '');
UPDATE products SET supplier = 'Sunvolt Solar Trading', updated_at = NOW() WHERE LOWER(name) = LOWER('Solar Floodlight 100W') AND (supplier IS NULL OR supplier = '');

-- 10d. Replaced by the poster's 4-Channel CCTV Package (archived, can be restored under Products > Show: Archived)
UPDATE products SET is_active = 0, updated_at = NOW() WHERE name IN ('4-Camera Home CCTV Package');

DROP TEMPORARY TABLE IF EXISTS bw_import;

 ---------- 11. Installation address in parts (added Oct 21, 2026) ----------
-- Apply ONLY this section (your database already has 1-10):
--   phpMyAdmin > click "beyondwires" > SQL tab > paste from the line above to the end > Go.
-- * New inquiries save the city, district (Manila only), barangay and landmark separately,
--   so the admin can filter by city. installation_address still holds the full address.
-- * Older inquiries get their city filled in from the typed address where it can be found.
-- * Safe to run more than once.
ALTER TABLE service_inquiries ADD COLUMN IF NOT EXISTS city VARCHAR(40) NULL AFTER installation_address;
ALTER TABLE service_inquiries ADD COLUMN IF NOT EXISTS district VARCHAR(40) NULL AFTER city;
ALTER TABLE service_inquiries ADD COLUMN IF NOT EXISTS barangay VARCHAR(60) NULL AFTER district;
ALTER TABLE service_inquiries ADD COLUMN IF NOT EXISTS landmark VARCHAR(120) NULL AFTER barangay;
 
UPDATE service_inquiries SET city = CASE
    WHEN installation_address LIKE '%caloocan%'      THEN 'Caloocan City'
    WHEN installation_address LIKE '%las pi%as%'    THEN 'Las Piñas City'
    WHEN installation_address LIKE '%makati%'        THEN 'Makati City'
    WHEN installation_address LIKE '%malabon%'       THEN 'Malabon City'
    WHEN installation_address LIKE '%mandaluyong%'   THEN 'Mandaluyong City'
    WHEN installation_address LIKE '%marikina%'      THEN 'Marikina City'
    WHEN installation_address LIKE '%muntinlupa%'    THEN 'Muntinlupa City'
    WHEN installation_address LIKE '%navotas%'       THEN 'Navotas City'
    WHEN installation_address LIKE '%para%aque%'    THEN 'Parañaque City'
    WHEN installation_address LIKE '%pasay%'         THEN 'Pasay City'
    WHEN installation_address LIKE '%pasig%'         THEN 'Pasig City'
    WHEN installation_address LIKE '%pateros%'       THEN 'Pateros'
    WHEN installation_address LIKE '%quezon city%'   THEN 'Quezon City'
    WHEN installation_address LIKE '%san juan%'      THEN 'San Juan City'
    WHEN installation_address LIKE '%taguig%'        THEN 'Taguig City'
    WHEN installation_address LIKE '%valenzuela%'    THEN 'Valenzuela City'
    WHEN installation_address LIKE '%manila%'        THEN 'Manila'
  END
WHERE city IS NULL;
 

--------------SECTION 12-----------------------
CREATE TABLE IF NOT EXISTS login_attempts (
  email VARCHAR(120) NOT NULL PRIMARY KEY,
  fails INT NOT NULL DEFAULT 0,
  lock_until DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

---------------SECTION 13---------------------
CREATE TABLE IF NOT EXISTS password_resets (
  reset_id   INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used_at    DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);


---------------SECTION 14-------------------
   ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP;
   ALTER TABLE users MODIFY email_verified_at DATETIME NULL DEFAULT NULL;
   ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_pw TINYINT(1) NOT NULL DEFAULT 0;
   CREATE TABLE IF NOT EXISTS email_codes (
     code_id INT AUTO_INCREMENT PRIMARY KEY,
     user_id INT NOT NULL,
     code_hash CHAR(64) NOT NULL,
     tries INT NOT NULL DEFAULT 0,
     expires_at DATETIME NOT NULL,
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
   ) ENGINE=InnoDB;

---------------SECTION 15-------------------
   ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_email VARCHAR(120) NULL;
   ALTER TABLE users ADD UNIQUE INDEX IF NOT EXISTS uq_recovery_email (recovery_email);
   ALTER TABLE email_codes ADD COLUMN IF NOT EXISTS sent_to VARCHAR(120) NULL;
   ALTER TABLE users DROP COLUMN IF EXISTS must_change_pw;


-- ---------- 16. Remove the demo packages (added Oct 21, 2026) ----------
UPDATE products SET is_active = 0
WHERE item_type = 'package' AND name IN ('8-Camera Business CCTV Package', '2-Door Access Control Package', 'Solar Streetlight Package (3 units)');


-------------SECTION 17--------------------
  ALTER TABLE service_inquiries ADD COLUMN IF NOT EXISTS province VARCHAR(40) NULL AFTER installation_address;
   UPDATE service_inquiries SET province = 'Metro Manila' WHERE province IS NULL;

   -- ---------- 18. Real services (added Oct 21, 2026) ----------
 still choose it; it is not a priced quotation line.
UPDATE products SET is_active = 0
WHERE item_type = 'service' AND name IN ('Cabling & Installation', 'Site Survey', 'System Configuration & Commissioning',
      'Annual Maintenance Plan', 'Camera Relocation', 'Installation Labor', 'Rough-ins, Piping, Molding');

      INSERT INTO products (name, description, category, item_type, supplier, icon, unit_price, is_active, updated_at)
SELECT n, d, NULL, 'service', NULL, i, p, 1, NOW() FROM (
  SELECT 'Installation - Open / Exposed Wiring' n, 'Per camera. Installation with open (exposed) wiring.' d, 'fa-screwdriver-wrench' i, 1500.00 p UNION ALL
  SELECT 'Installation - with Molding', 'Per camera. Installation with wiring in molding.', 'fa-screwdriver-wrench', 2000.00 UNION ALL
  SELECT 'Installation - with Rough-ins', 'Per camera. Installation with rough-ins (concealed piping).', 'fa-screwdriver-wrench', 2500.00 UNION ALL
  SELECT 'Mobile Viewing Configuration', 'Per setup. Remote viewing on your phone.', 'fa-mobile-screen', 1000.00 UNION ALL
  SELECT 'CCTV Footage Retrieval and Review Fee', 'Per request. Technical assistance in locating, reviewing, and retrieving recorded CCTV footage upon customer request, including footage intended for investigation or legal proceedings.', 'fa-film', 1500.00 UNION ALL
  SELECT 'Ocular / Site Visit', 'Free. On-site inspection and assessment.', 'fa-eye', 0.00
) x WHERE NOT EXISTS (SELECT 1 FROM products WHERE item_type = 'service' AND name = x.n);
 
-- items that already existed: set the new prices and make sure they are active
UPDATE products SET unit_price = 1000.00, description = 'Per setup. Remote viewing on your phone.', is_active = 1, updated_at = NOW()
WHERE item_type = 'service' AND name = 'Mobile Viewing Configuration' AND unit_price <> 1000.00;
UPDATE products SET unit_price = 0.00, is_active = 1 WHERE item_type = 'service' AND name = 'Ocular / Site Visit';