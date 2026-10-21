<?php
// Applies update_2026_10.sql to the database in config.php. Safe to run more than once.
// Run from the project folder:   C:\xampp\php\php.exe migrate.php
// (Or import update_2026_10.sql in phpMyAdmin instead.)
if (PHP_SAPI !== 'cli') { http_response_code(403); exit('CLI only.'); }
require __DIR__ . '/api/lib.php';

$sql = (string)file_get_contents(__DIR__ . '/update_2026_10.sql');
$sql = preg_replace('/^\s*--.*$/m', '', $sql);                    // drop comment lines
$parts = array_filter(array_map('trim', preg_split('/;\s*(\r?\n|$)/', $sql)), 'strlen');
$n = 0;
foreach ($parts as $stmt) {
    if (preg_match('/^USE\s/i', $stmt)) continue;                  // config.php already selects the database
    try { db()->exec($stmt); $n++; }
    catch (PDOException $e) { fwrite(STDERR, "FAILED: " . mb_substr($stmt, 0, 120) . "...\n  " . $e->getMessage() . "\n"); exit(1); }
}
echo "Database updated ($n statements). Existing data was kept.\n";
