<?php
declare(strict_types=1);
require __DIR__ . '/lib.php';

header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
start_session();

$method = $_SERVER['REQUEST_METHOD'];
// CSRF defence: state-changing calls must carry a custom header (browsers block cross-site requests that add it).
if (!in_array($method, ['GET', 'HEAD'], true) && ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'fetch') fail('Bad request.', 400);

foreach (['auth', 'customer', 'admin', 'owner'] as $m) require __DIR__ . "/$m.php";

$path = '/' . trim((string)($_GET['r'] ?? ''), '/');
session_idle_check(!($method === 'GET' && $path === '/notifications'));   // logs out after 30 idle minutes
foreach ($GLOBALS['ROUTES'] as [$m, $re, $roles, $fn]) {
    if ($m !== $method || !preg_match($re, $path, $mt)) continue;
    $u = $roles === null ? me() : need(...$roles);
    $ids = array_map('intval', array_values(array_filter($mt, 'is_string', ARRAY_FILTER_USE_KEY)));
    $fn($u, ...$ids);
    exit;
}
fail('Not found.', 404);
