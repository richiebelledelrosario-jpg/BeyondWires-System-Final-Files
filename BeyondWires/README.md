# BeyondWires: setup (XAMPP)

## 1. Folder layout
Put the whole folder in `C:\xampp\htdocs\` (for example `C:\xampp\htdocs\BeyondWires\`):

```
BeyondWires/
├── .htaccess              blocks config.php, install.php, migrate.php and the .sql files from the browser
├── config.php             database login, upload folder, standard time slots, quotation and customer rules
├── install.php            run ONCE on a new database to create the owner + admin accounts, then delete
├── migrate.php            applies update_2026_10.sql (safe to run more than once)
├── schema.sql             the original database (new installs only)
├── update_2026_10.sql     October 2026 update: new columns/tables only, keeps all existing data
├── Assets/                your images (logos, payment-qr.png, ...)
├── HTML/  CSS/  JS/       the pages (JS/api.js connects every page to the server)
├── api/
│   ├── index.php          router: api/index.php?r=/route
│   ├── lib.php            DB, sessions, validation, uploads, shared logic
│   ├── auth.php           register, login, logout, profile, password, notifications
│   ├── customer.php       catalog (no prices), calendar, inquiries, quotations, payments, documents
│   ├── admin.php          inquiries, quotations, payments, projects, schedules, products
│   └── owner.php          super admin: approvals, finance, activity, accounts
└── storage/               uploaded proofs, photos and PDFs ("Require all denied": served only through the API)
```

## 2. Database

**You already have the `beyondwires` database (keep your data):**
1. Back it up: phpMyAdmin > `beyondwires` > Export > Go.
2. phpMyAdmin > `beyondwires` > Import > choose `update_2026_10.sql` > Go
   (or in a terminal in this folder: `C:\xampp\php\php.exe migrate.php`).

**New install:**
1. phpMyAdmin > Import > `schema.sql` > Go, then Import > `update_2026_10.sql` > Go.
2. Create the staff accounts once, then delete `install.php`:
   `C:\xampp\php\php.exe install.php "owner@beyondwires.com" "OwnerPass123" "admin@beyondwires.com" "AdminPass123"`

If your MySQL root account has a password, put it in `config.php` under `'pass'`.

## 3. Open the site
- Customers: `http://localhost/BeyondWires/HTML/LandingPage.html` (Sign Up / Log In; Gmail addresses only).
- Admin and Super Admin: `http://localhost/BeyondWires/HTML/Super&AdminAccount.html` (choose the role).
- Check the server: `http://localhost/BeyondWires/api/index.php?r=/catalog` should show JSON with `"ok":true`.

Every dashboard asks the server who is logged in before it shows anything, so opening a dashboard
address directly (or any hidden link to the staff page) never skips the login or the role check.

## 4. Rules the server enforces
- Customers: max 10 inquiries per account (max 5 in one form), Metro Manila (NCR) addresses only,
  only time slots the admin published and nobody holds, from tomorrow up to 120 days ahead,
  customer dates 2019 to 2028, payment date not in the future, reference number required.
- Admin / Super Admin dates: January to December 2026 (slots, schedules, certificates, expenses).
- Quotations: price above PHP 0 and up to PHP 1,000,000 per line, extra expenses up to PHP 1,000,000,
  labor uses the rates in `config.php` (1 to 5 days, 1 to 50 workers), 12% VAT added by the server.
- Customers never receive prices in the catalog or inquiries, suppliers, price history, internal
  expense lists, owner comments or edit history.

## Requirements
PHP 8.0 or newer (XAMPP 8.0+) and MariaDB 10.3+ (the database that ships with XAMPP).
An internet connection is needed for the icon font, Chart.js and the PDF library.
