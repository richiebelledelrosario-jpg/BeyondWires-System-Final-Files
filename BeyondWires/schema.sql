-- BeyondWires schema (MySQL 5.7+ / MariaDB 10.3+). Based on your ERD, with fixes + additions for the full flow.
CREATE DATABASE IF NOT EXISTS beyondwires CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE beyondwires;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE users (
  user_id INT AUTO_INCREMENT PRIMARY KEY,
  first_name VARCHAR(60) NOT NULL,
  last_name VARCHAR(60) NOT NULL,
  email VARCHAR(120) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  phone_number VARCHAR(30),
  role ENUM('customer','admin','superadmin') NOT NULL,   -- superadmin = Owner
  status ENUM('Active','Disabled') NOT NULL DEFAULT 'Active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE customers (
  customer_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  company_name VARCHAR(120),
  avatar_initials VARCHAR(4),
  FOREIGN KEY (user_id) REFERENCES users(user_id)
) ENGINE=InnoDB;

CREATE TABLE products (               -- products AND services (item_type)
  product_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  category VARCHAR(60) NOT NULL DEFAULT 'General',
  item_type ENUM('product','service') NOT NULL DEFAULT 'product',
  specs TEXT,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE service_inquiries (
  inquiry_id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  installation_address VARCHAR(255) NOT NULL,
  place_type ENUM('Residential','Commercial') NOT NULL,
  purchase_option ENUM('service','product','both') NOT NULL,
  requirements TEXT,
  urgency_level ENUM('Low','Normal','Very Urgent') NOT NULL DEFAULT 'Normal',
  needs_site_visit TINYINT(1) NOT NULL DEFAULT 0,
  preferred_visit_at DATETIME NULL,
  site_visit_done TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('New Inquiry','Accepted','Pending Visit','Quoted','Completed','Failed') NOT NULL DEFAULT 'New Inquiry',
  date_submitted DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
) ENGINE=InnoDB;

CREATE TABLE inquiry_items (          -- optional items the customer is interested in
  inquiry_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  PRIMARY KEY (inquiry_id, product_id),
  FOREIGN KEY (inquiry_id) REFERENCES service_inquiries(inquiry_id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(product_id)
) ENGINE=InnoDB;

CREATE TABLE projects (
  project_id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  inquiry_id INT NULL,
  project_name VARCHAR(160),
  project_lead VARCHAR(100),
  start_date DATE,
  end_date DATE,
  status ENUM('Awaiting Payment','Payment Under Review','Installation In Progress','Awaiting Final Payment','Done','Failed') NOT NULL DEFAULT 'Awaiting Payment',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
  FOREIGN KEY (inquiry_id) REFERENCES service_inquiries(inquiry_id)
) ENGINE=InnoDB;

CREATE TABLE project_updates (
  update_id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  note TEXT NOT NULL,
  created_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(user_id)
) ENGINE=InnoDB;

CREATE TABLE quotations (
  quotation_id INT AUTO_INCREMENT PRIMARY KEY,
  quotation_no VARCHAR(20) UNIQUE,
  inquiry_id INT NOT NULL,
  customer_id INT NOT NULL,
  project_id INT NULL,
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  other_charges_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  status ENUM('Draft','Pending Superadmin','Sent to Customer','Approved','Declined','Revision Requested') NOT NULL DEFAULT 'Draft',
  payment_status ENUM('Unpaid','Partial','Paid') NOT NULL DEFAULT 'Unpaid',
  notes TEXT,
  superadmin_comment TEXT,
  pdf_path VARCHAR(255),
  created_by INT NOT NULL,
  date_created DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expiry_date DATE,
  FOREIGN KEY (inquiry_id) REFERENCES service_inquiries(inquiry_id),
  FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
  FOREIGN KEY (project_id) REFERENCES projects(project_id),
  FOREIGN KEY (created_by) REFERENCES users(user_id)
) ENGINE=InnoDB;

CREATE TABLE quotation_items (
  item_id INT AUTO_INCREMENT PRIMARY KEY,
  quotation_id INT NOT NULL,
  product_id INT NOT NULL,
  description VARCHAR(160),
  quantity INT NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  total_amount DECIMAL(12,2) NOT NULL,
  FOREIGN KEY (quotation_id) REFERENCES quotations(quotation_id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(product_id)
) ENGINE=InnoDB;

CREATE TABLE quotation_charges (      -- "other expenses" the admin adds (labor, transport, ...)
  charge_id INT AUTO_INCREMENT PRIMARY KEY,
  quotation_id INT NOT NULL,
  label VARCHAR(120) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  FOREIGN KEY (quotation_id) REFERENCES quotations(quotation_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE quotation_approvals (
  approval_id INT AUTO_INCREMENT PRIMARY KEY,
  quotation_id INT NOT NULL,
  payment_agreement ENUM('Half upon quotation','Full upon quotation','Full after installation') NOT NULL,
  payment_method ENUM('Online','Over the counter') NOT NULL,
  preferred_install_date DATE,
  preferred_install_slot VARCHAR(10),
  process_step VARCHAR(60),
  date_submitted DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (quotation_id) REFERENCES quotations(quotation_id)
) ENGINE=InnoDB;

CREATE TABLE quotation_revisions (    -- history of edits by admin / owner
  revision_id INT AUTO_INCREMENT PRIMARY KEY,
  quotation_id INT NOT NULL,
  adjusted_amount DECIMAL(12,2),
  revised_validity DATE,
  scope_notes TEXT,
  revised_by INT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (quotation_id) REFERENCES quotations(quotation_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE quotation_rejections (   -- customer declines
  rejection_id INT AUTO_INCREMENT PRIMARY KEY,
  quotation_id INT NOT NULL,
  action ENUM('revise','cancel') NOT NULL,
  reason VARCHAR(255),
  comments TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (quotation_id) REFERENCES quotations(quotation_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE installation_schedules (
  schedule_id INT AUTO_INCREMENT PRIMARY KEY,
  quotation_id INT NULL,
  inquiry_id INT NULL,
  technician_id INT NULL,
  scheduled_date DATE NOT NULL,
  time_slot ENUM('8:00 AM','10:30 AM','1:00 PM','3:30 PM') NOT NULL,
  activity_type ENUM('Site Inspection','Installation') NOT NULL,
  status ENUM('Requested','Confirmed','Completed','Cancelled') NOT NULL DEFAULT 'Requested',
  notes VARCHAR(255),
  -- Prevents two active bookings in the same slot, even under race conditions:
  active_key VARCHAR(30) GENERATED ALWAYS AS (IF(status IN ('Requested','Confirmed'), CONCAT(scheduled_date,'|',time_slot), NULL)) STORED,
  UNIQUE KEY uq_active_slot (active_key),
  FOREIGN KEY (quotation_id) REFERENCES quotations(quotation_id),
  FOREIGN KEY (inquiry_id) REFERENCES service_inquiries(inquiry_id),
  FOREIGN KEY (technician_id) REFERENCES users(user_id)
) ENGINE=InnoDB;

CREATE TABLE payments (
  payment_id INT AUTO_INCREMENT PRIMARY KEY,
  quotation_id INT NOT NULL,
  customer_id INT NOT NULL,
  installment ENUM('Down payment','Final balance','Full') NOT NULL,
  amount_due DECIMAL(12,2) NOT NULL,
  amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_method ENUM('Online','Over the counter') NOT NULL,
  payment_agreement VARCHAR(40) NOT NULL,
  proof_of_payment_url VARCHAR(255),
  reference_no VARCHAR(60),
  status ENUM('Not Due','Awaiting Payment','Under Review','Confirmed','Rejected') NOT NULL,
  reject_reason VARCHAR(255),
  transaction_date DATETIME NULL,
  confirmed_by INT NULL,
  confirmed_at DATETIME NULL,
  FOREIGN KEY (quotation_id) REFERENCES quotations(quotation_id),
  FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
  FOREIGN KEY (confirmed_by) REFERENCES users(user_id)
) ENGINE=InnoDB;

CREATE TABLE receipts (
  receipt_id INT AUTO_INCREMENT PRIMARY KEY,
  payment_id INT NOT NULL UNIQUE,
  receipt_no VARCHAR(20) NOT NULL UNIQUE,
  issued_by INT NOT NULL,
  file_path VARCHAR(255),
  issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (payment_id) REFERENCES payments(payment_id),
  FOREIGN KEY (issued_by) REFERENCES users(user_id)
) ENGINE=InnoDB;

CREATE TABLE customer_documents (
  document_id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  inquiry_id INT NULL,
  quotation_id INT NULL,
  payment_id INT NULL,
  document_type ENUM('Quotation','Receipt','Other') NOT NULL,
  title VARCHAR(160),
  file_path VARCHAR(255) NOT NULL,
  date_issued DATE,
  status VARCHAR(30) DEFAULT 'Available',
  FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
) ENGINE=InnoDB;

CREATE TABLE notifications (
  notification_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(120),
  message TEXT,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE customer_activity_logs (
  log_id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  activity_device VARCHAR(160),
  location VARCHAR(60),
  status VARCHAR(40),
  timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
) ENGINE=InnoDB;

CREATE TABLE audit_logs (
  log_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  action_type VARCHAR(60),
  details TEXT,
  ip_address VARCHAR(45),
  timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
) ENGINE=InnoDB;

CREATE TABLE financial_summaries (
  summary_id INT AUTO_INCREMENT PRIMARY KEY,
  month_year VARCHAR(7) NOT NULL UNIQUE,          -- 'YYYY-MM'
  gross_revenue DECIMAL(14,2) DEFAULT 0,
  operating_expenses DECIMAL(14,2) DEFAULT 0,
  net_profit DECIMAL(14,2) DEFAULT 0,
  margin_percentage DECIMAL(6,2) DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE expenses (
  expense_id INT AUTO_INCREMENT PRIMARY KEY,
  summary_id INT NULL,
  category_name VARCHAR(80) NOT NULL,
  description VARCHAR(255),
  amount DECIMAL(14,2) NOT NULL,
  expense_date DATE NOT NULL,
  FOREIGN KEY (summary_id) REFERENCES financial_summaries(summary_id)
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;

-- Sample catalog (edit freely). Prices in PHP.
INSERT INTO products (name, description, category, item_type, specs, unit_price) VALUES
('IR CCTV Camera 2MP', 'Night-vision weatherproof bullet camera', 'CCTV', 'product', '2MP, 20m IR, IP66', 1500.00),
('IP CCTV Camera 4MP', 'Network camera with remote viewing', 'CCTV', 'product', '4MP, PoE, H.265', 3200.00),
('DVR 4-Channel', 'Recorder for analog cameras', 'CCTV', 'product', '4CH, 1080p', 3500.00),
('NVR 8-Channel', 'Network video recorder', 'CCTV', 'product', '8CH PoE', 6500.00),
('Biometric Access Terminal', 'Fingerprint / face access + attendance', 'Access Control', 'product', 'Fingerprint + card', 7800.00),
('Smart Door Lock', 'PIN / fingerprint / card entry', 'Access Control', 'product', 'Zinc alloy, 5 modes', 9500.00),
('Video Intercom Set', 'Door station + indoor unit', 'Intercom', 'product', '7in display', 6200.00),
('Solar Street Light', 'Dusk-to-dawn LED', 'Lighting', 'product', '60W, motion sensor', 8500.00),
('CAT6 Cable (305m)', 'Pull box', 'Accessories', 'product', 'Pure copper', 4200.00),
('Ocular / Site Visit', 'On-site inspection and assessment', 'Services', 'service', NULL, 0.00),
('Installation Labor', 'Professional installation per device', 'Services', 'service', NULL, 800.00),
('Mobile Viewing Configuration', 'Remote viewing on your phone', 'Services', 'service', NULL, 500.00),
('Rough-ins, Piping, Molding', 'Concealed cable routing, per meter', 'Services', 'service', NULL, 120.00);
