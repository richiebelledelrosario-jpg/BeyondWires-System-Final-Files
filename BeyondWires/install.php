<?php
// Run ONCE from the command line:  php install.php "owner@email.com" "OwnerPass123" "admin@email.com" "AdminPass123"
// Then delete this file.
if (PHP_SAPI !== 'cli') { http_response_code(403); exit('CLI only.'); }
require __DIR__ . '/api/lib.php';
[$_, $oe, $op, $ae, $ap] = $argv + [null, null, null, null, null];
if (!$oe || !$op || !$ae || !$ap) exit("Usage: php install.php owner_email owner_pass admin_email admin_pass\n");
foreach ([$op, $ap] as $p) if (!strong_pw_cli($p)) exit("Passwords need 8+ characters and a number.\n");
function strong_pw_cli(string $p): bool { return strlen($p) >= 8 && preg_match('/\d/', $p); }
$mk = fn($fn, $ln, $e, $p, $r) => q('INSERT INTO users(first_name,last_name,email,password_hash,role) VALUES(?,?,?,?,?)', [$fn, $ln, strtolower($e), password_hash($p, PASSWORD_DEFAULT), $r]);
$mk('Owner', 'BeyondWires', $oe, $op, 'superadmin');
$mk('Admin', 'NOC', $ae, $ap, 'admin');
echo "Created owner ($oe) and admin ($ae). Delete install.php now.\n";
