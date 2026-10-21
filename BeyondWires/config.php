<?php
// Edit these values for your server (XAMPP defaults shown).
return [
    'db' => [
        'host' => '127.0.0.1',
        'name' => 'beyondwires',
        'user' => 'root',
        'pass' => '',
        'charset' => 'utf8mb4',
    ],
    // Keep this folder OUTSIDE the public web root in production.
    'upload_dir'     => __DIR__ . '/storage',
    'max_upload'     => 5 * 1024 * 1024,              // 5 MB
    'payment_qr_url' => '../Assets/payment-qr.png',   // QR image shown for online payments (relative to the HTML folder)
    // "Standard hours" the admin can publish with one click. Customers can only book times the admin published.
    'slots'          => ['9:00 AM', '10:30 AM', '1:00 PM', '3:30 PM'],
    'session_name'   => 'BWSESSID',
    'timezone'       => 'Asia/Manila',

    // ---- Quotation rules (enforced by the server, not only the pages) ----
    'vat_rate'       => 0.12,                         // added on items + extra expenses + labor
    'price_max'      => 1000000,                      // max catalog price / quotation unit price (PHP)
    'expense_max'    => 1000000,                      // max total of extra expenses per quotation (PHP)
    'qty_max'        => 9999,
    'labor_rates'    => ['Helper' => 1000, 'Junior Installer' => 1500, 'Senior Installer' => 2000, 'Head Technician' => 2500],  // PHP per worker per day
    'labor_days_max' => 5,
    'labor_workers_max' => 50,
    'validity_days'  => 30,                           // default quotation validity

    // ---- Customer rules ----
    'max_inquiries'  => 10,                           // per customer account (each inquiry in a multi-inquiry form counts)
    'max_blocks'     => 5,                            // inquiries in one form submission
    'booking_days_ahead' => 120,                      // how far ahead a customer can book
    'cert_photos_max' => 8,

    // ---- Forgot password emails (sent through Gmail) ----
    // 'pass' is a Gmail App Password (16 letters), NOT the normal Gmail password.
    // Create it at myaccount.google.com > Security > 2-Step Verification > App passwords.
    'mail' => [
        'host'      => 'smtp.gmail.com',
        'port'      => 587,
        'secure'    => 'tls',
        'user'      => 'beyondwires4demo@gmail.com',
        'pass'      => 'wdjjhvqyhqhhuknt',                             // <-- paste the App Password here
        'from_name' => 'BeyondWires',
    ],

    
    // Address of the site, used in the reset link inside the email (no slash at the end).
    'app_url' => 'http://localhost/BeyondWires',
];
