<?php
/* ============ a. Quotation approval ============ */
route('GET', '/owner/quotations', ['superadmin'], function () {
    $st = $_GET['status'] ?? 'Pending Superadmin';
    out(all('SELECT q.quotation_id,q.quotation_no,q.total_amount,q.status,q.date_created,q.expiry_date,q.superadmin_comment,q.project_title,q.project_id, CONCAT(u.first_name," ",u.last_name) customer,
                    (SELECT MAX(e.created_at) FROM quotation_events e WHERE e.quotation_id=q.quotation_id AND e.event LIKE "Approved by superadmin%") sent_at
             FROM quotations q JOIN customers c USING(customer_id) JOIN users u ON u.user_id=c.user_id' . ($st !== 'all' ? ' WHERE q.status=?' : '') . ' ORDER BY q.quotation_id DESC LIMIT 300', $st !== 'all' ? [$st] : []));
});
/* a.2.2 owner can edit the quotation while it is pending (items, charges, validity, notes). The admin's labor lines are kept. */
route('PUT', '/owner/quotations/{id}', ['superadmin'], function ($u, $id) {
    $in = input();
    $q = one('SELECT * FROM quotations WHERE quotation_id=?', [$id]);
    if (!$q) fail('Quotation not found.', 404);
    if ($q['status'] !== 'Pending Superadmin') fail('Only quotations awaiting your approval can be edited.', 409);
    foreach ((array)($in['items'] ?? []) as $it) {
        $qty = $it['quantity'] ?? 0;
        if (!is_numeric($qty) || (int)$qty != $qty || $qty < 1 || $qty > 100) fail('Quantity must be a whole number from 1 to 100.');
        if (!is_numeric($it['unit_price'] ?? null) || $it['unit_price'] < 1) fail('Unit price must be at least PHP 1.');
    }
    $labor = all('SELECT role, workers, days FROM quotation_labor WHERE quotation_id=?', [$id]);
    [$lines, $ch, $sub, $ct, $lab, $lt, $vat] = quote_calc((array)($in['items'] ?? []), (array)($in['charges'] ?? []), $labor, !$labor);
    $expiry = $q['expiry_date'];
    if (isset($in['validity_days'])) {   // 1-30 days from the quotation date (from today if that has already passed)
        $vd = $in['validity_days'];
        if (!is_numeric($vd) || (int)$vd != $vd || $vd < 1 || $vd > 30) fail('Validity must be 1 to 30 days.');
        $expiry = date('Y-m-d', strtotime(substr($q['date_created'], 0, 10) . " +$vd days"));
        if ($expiry <= date('Y-m-d')) $expiry = date('Y-m-d', strtotime("+$vd days"));
    } elseif (isset($in['expiry_date'])) $expiry = quote_expiry($in['expiry_date']);
    tx(function () use ($id, $q, $lines, $ch, $sub, $ct, $lab, $lt, $vat, $in, $u, $expiry) {
        q('UPDATE quotations SET subtotal=?,other_charges_total=?,labor_total=?,vat_amount=?,total_amount=?,notes=?,expiry_date=?,pdf_path=NULL WHERE quotation_id=?',
          [$sub, $ct, $lt, $vat, round($sub + $ct + $lt + $vat, 2), array_key_exists('notes', $in) ? (s($in['notes'], 2000) ?: null) : $q['notes'], $expiry, $id]);
        quote_write($id, $lines, $ch);
        quote_event($id, 'Edited by superadmin');
        q('INSERT INTO quotation_revisions(quotation_id,adjusted_amount,revised_validity,scope_notes,revised_by) VALUES(?,?,?,?,?)', [$id, $sub + $ct, $q['expiry_date'], 'Edited by owner', $u['id']]);
    });
    audit('QUOTATION_EDITED_OWNER', "#$id");
    out(quote_detail($id));
});
/* a.1 approve -> goes straight to the customer, admin is notified too */
route('POST', '/owner/quotations/{id}/approve', ['superadmin'], function ($u, $id) {
    $q = one('SELECT * FROM quotations WHERE quotation_id=?', [$id]);
    if (!$q) fail('Quotation not found.', 404);
    if ($q['status'] !== 'Pending Superadmin') fail('This quotation is not awaiting approval.', 409);
    q('UPDATE quotations SET status="Sent to Customer", superadmin_comment=NULL WHERE quotation_id=?', [$id]);
    quote_event($id, 'Approved by superadmin. Sent to customer');
    publish_quote_doc($id);
    notify_customer((int)$q['customer_id'], 'New quotation', "Quotation {$q['quotation_no']} is ready for your review.", 'quotation:' . $id);
    notify_role('admin', 'Quotation approved', "{$q['quotation_no']} was approved and sent to the customer.", 'quotation:' . $id);
    audit('QUOTATION_APPROVED_OWNER', $q['quotation_no']);
    out(['status' => 'Sent to Customer']);
});
/* a.2 reject with a comment -> back to admin (Draft) */
route('POST', '/owner/quotations/{id}/reject', ['superadmin'], function ($u, $id) {
    $comment = s(input()['comment'] ?? '', 2000);
    if ($comment === '') fail('Please add a comment explaining what should change.');
    $q = one('SELECT * FROM quotations WHERE quotation_id=?', [$id]);
    if (!$q) fail('Quotation not found.', 404);
    if ($q['status'] !== 'Pending Superadmin') fail('This quotation is not awaiting approval.', 409);
    q('UPDATE quotations SET status="Draft", superadmin_comment=? WHERE quotation_id=?', [$comment, $id]);
    quote_event($id, 'Returned by superadmin: ' . $comment);
    notify_role('admin', 'Quotation rejected', "{$q['quotation_no']} needs changes: $comment", 'quotation:' . $id);
    audit('QUOTATION_REJECTED_OWNER', $q['quotation_no']);
    out(['status' => 'Draft']);
});

/* ============ Dashboard (KPIs, 12-month trends, status breakdown, recent events) ============ */
route('GET', '/owner/dashboard', ['superadmin'], function () {
    $from = (new DateTime('first day of this month'))->modify('-11 months')->format('Y-m-d');
    out([
        'active_projects'     => (int)one('SELECT COUNT(*) n FROM projects WHERE status NOT IN ("Done","Failed")')['n'],
        'projects_this_month' => (int)one('SELECT COUNT(*) n FROM projects WHERE DATE_FORMAT(created_at,"%Y-%m")=DATE_FORMAT(CURDATE(),"%Y-%m")')['n'],
        'pending_quotes'      => (int)one('SELECT COUNT(*) n FROM quotations WHERE status="Pending Superadmin"')['n'],
        'revenue'  => all('SELECT DATE_FORMAT(confirmed_at,"%Y-%m") m, SUM(amount_paid) v FROM payments WHERE status="Confirmed" AND confirmed_at>=? GROUP BY m', [$from]),
        'projects' => all('SELECT DATE_FORMAT(created_at,"%Y-%m") m, COUNT(*) v FROM projects WHERE created_at>=? GROUP BY m', [$from]),
        'quotes'   => all('SELECT DATE_FORMAT(date_created,"%Y-%m") m, COUNT(*) v FROM quotations WHERE date_created>=? GROUP BY m', [$from]),
        'project_status' => all('SELECT status, COUNT(*) n FROM projects GROUP BY status'),
        'quote_status'   => all('SELECT status, COUNT(*) n FROM quotations GROUP BY status'),
        'events' => all('SELECT a.log_id,a.action_type,a.details,a.timestamp, CONCAT(u.first_name," ",u.last_name) user_name, u.role FROM audit_logs a JOIN users u USING(user_id) ORDER BY a.log_id DESC LIMIT 10'),
    ]);
});

/* ============ b. Project summary ============ */
route('GET', '/owner/projects/summary', ['superadmin'], function () {
    out([
        'by_status' => all('SELECT status, COUNT(*) n FROM projects GROUP BY status'),
        'by_type'   => all('SELECT i.place_type, COUNT(*) n FROM projects p JOIN service_inquiries i USING(inquiry_id) GROUP BY i.place_type'),
        'contract_value' => (float)one('SELECT COALESCE(SUM(total_amount),0) s FROM quotations WHERE status="Approved"')['s'],
        'outstanding'    => (float)one('SELECT COALESCE(SUM(amount_due),0) s FROM payments WHERE status<>"Confirmed"')['s'],
        'failed_inquiries' => (int)one('SELECT COUNT(*) n FROM service_inquiries WHERE status="Failed"')['n'],
    ]);
});

/* ============ c. Financial summary ============ */
route('GET', '/owner/finance', ['superadmin'], function () {
    $y = (int)($_GET['year'] ?? date('Y'));
    if ($y < 2000 || $y > 2100) fail('Invalid year.');
    $rev = array_column(all('SELECT DATE_FORMAT(confirmed_at,"%Y-%m") m, SUM(amount_paid) v FROM payments WHERE status="Confirmed" AND YEAR(confirmed_at)=? GROUP BY m', [$y]), 'v', 'm');
    $exp = array_column(all('SELECT DATE_FORMAT(expense_date,"%Y-%m") m, SUM(amount) v FROM expenses WHERE YEAR(expense_date)=? GROUP BY m', [$y]), 'v', 'm');
    $months = []; $tr = 0.0; $te = 0.0;
    for ($i = 1; $i <= 12; $i++) {
        $m = sprintf('%04d-%02d', $y, $i);
        $r = round((float)($rev[$m] ?? 0), 2); $e = round((float)($exp[$m] ?? 0), 2); $n = round($r - $e, 2);
        $mg = $r > 0 ? round($n / $r * 100, 2) : 0;
        $months[] = ['month' => $m, 'revenue' => $r, 'expenses' => $e, 'net_profit' => $n, 'margin' => $mg];
        $tr += $r; $te += $e;
        if ($r > 0 || $e > 0) {   // keep the financial_summaries snapshot table in sync
            q('INSERT INTO financial_summaries(month_year,gross_revenue,operating_expenses,net_profit,margin_percentage) VALUES(?,?,?,?,?)
               ON DUPLICATE KEY UPDATE gross_revenue=VALUES(gross_revenue),operating_expenses=VALUES(operating_expenses),net_profit=VALUES(net_profit),margin_percentage=VALUES(margin_percentage)', [$m, $r, $e, $n, $mg]);
            q('UPDATE expenses SET summary_id=(SELECT summary_id FROM financial_summaries WHERE month_year=?) WHERE DATE_FORMAT(expense_date,"%Y-%m")=?', [$m, $m]);
        }
    }
    out([
        'year' => $y, 'months' => $months,
        'totals' => ['revenue' => round($tr, 2), 'expenses' => round($te, 2), 'net_profit' => round($tr - $te, 2), 'margin' => $tr > 0 ? round(($tr - $te) / $tr * 100, 2) : 0],
        'expenses_by_category' => all('SELECT category_name, SUM(amount) total FROM expenses WHERE YEAR(expense_date)=? GROUP BY category_name ORDER BY total DESC', [$y]),
        'receivables' => (float)one('SELECT COALESCE(SUM(amount_due),0) s FROM payments WHERE status IN ("Awaiting Payment","Under Review","Rejected")')['s'],
    ]);
});
/* Monthly revenue + expenses per category for the last 24 months (Financial tab and dashboard chart). */
route('GET', '/owner/ledger', ['superadmin'], function () {
    $from = (new DateTime('first day of this month'))->modify('-23 months')->format('Y-m-d');
    out([
        'revenue'  => all('SELECT DATE_FORMAT(confirmed_at,"%Y-%m") m, SUM(amount_paid) v FROM payments WHERE status="Confirmed" AND confirmed_at>=? GROUP BY m', [$from]),
        'expenses' => all('SELECT DATE_FORMAT(expense_date,"%Y-%m") m, category_name c, SUM(amount) v FROM expenses WHERE expense_date>=? GROUP BY m, c', [$from]),
        'projects' => all('SELECT DATE_FORMAT(created_at,"%Y-%m") m, COUNT(*) v FROM projects WHERE created_at>=? GROUP BY m', [$from]),
        'quotes'   => all('SELECT DATE_FORMAT(date_created,"%Y-%m") m, COUNT(*) v FROM quotations WHERE date_created>=? AND status="Pending Superadmin" GROUP BY m', [$from]),
        'receivables' => (float)one('SELECT COALESCE(SUM(amount_due),0) s FROM payments WHERE status IN ("Awaiting Payment","Under Review","Rejected")')['s'],
    ]);
});
route('GET', '/owner/expenses', ['superadmin'], function () {
    out(all('SELECT * FROM expenses ORDER BY expense_date DESC, expense_id DESC LIMIT 300'));
});
route('POST', '/owner/expenses', ['superadmin'], function ($u) {
    $in = input();
    $cat = s($in['category_name'] ?? '', 80);
    $amt = $in['amount'] ?? null;
    $d = DateTime::createFromFormat('Y-m-d', (string)($in['expense_date'] ?? ''));
    if ($cat === '' || !is_numeric($amt) || $amt <= 0 || !$d) fail('Category, a positive amount and a valid date (YYYY-MM-DD) are required.');
    need_date($d->format('Y-m-d'), STAFF_DATES, 'expense date');
    q('INSERT INTO expenses(category_name,description,amount,expense_date) VALUES(?,?,?,?)', [$cat, s($in['description'] ?? '', 255) ?: null, round((float)$amt, 2), $d->format('Y-m-d')]);
    audit('EXPENSE_ADDED', "$cat " . round((float)$amt, 2));
    out(['expense_id' => lastId()], 201);
});

/* ============ d. Activity log ============ */
route('GET', '/owner/activity', ['superadmin'], function () {
    $page = max(1, (int)($_GET['page'] ?? 1)); $off = ($page - 1) * 200;
    if (($_GET['source'] ?? 'staff') === 'customer')
        out(all("SELECT l.log_id,l.activity_device,l.location,l.status,l.timestamp, CONCAT(u.first_name,' ',u.last_name) customer FROM customer_activity_logs l JOIN customers c USING(customer_id) JOIN users u ON u.user_id=c.user_id ORDER BY l.log_id DESC LIMIT 200 OFFSET $off"));
    out(all("SELECT a.log_id,a.user_id,a.action_type,a.details,a.ip_address,a.timestamp, CONCAT(u.first_name,' ',u.last_name) user_name, u.role FROM audit_logs a JOIN users u USING(user_id) ORDER BY a.log_id DESC LIMIT 200 OFFSET $off"));
});

/* ============ e. Manage users ============ */
route('GET', '/owner/users', ['superadmin'], function () {
    $role = $_GET['role'] ?? 'all';
    out(all('SELECT user_id,first_name,last_name,email,phone_number,role,status,created_at,(SELECT MAX(a.timestamp) FROM audit_logs a WHERE a.user_id=users.user_id) last_activity FROM users' . ($role !== 'all' ? ' WHERE role=?' : '') . ' ORDER BY user_id DESC LIMIT 500', $role !== 'all' ? [$role] : []));
});
route('POST', '/owner/users', ['superadmin'], function ($u) {
    $in = input();
    $fn = s($in['first_name'] ?? '', 60); $ln = s($in['last_name'] ?? '', 60);
    $email = strtolower(s($in['email'] ?? '', 120)); $pw = (string)($in['password'] ?? ''); $role = $in['role'] ?? '';
    if (!valid_name($fn) || !valid_name($ln)) fail('Names can contain letters and spaces only.');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Enter a valid email address.');
    if (!strong_pw($pw)) fail('Password needs at least 8 characters and a number.');
    if (!in_array($role, ['customer', 'admin', 'superadmin'], true)) fail('Invalid role.');
    if (one('SELECT 1 FROM users WHERE email=?', [$email])) fail('That email is already registered.', 409);
    $id = tx(function () use ($fn, $ln, $email, $pw, $role, $in) {
        q('INSERT INTO users(first_name,last_name,email,password_hash,phone_number,role) VALUES(?,?,?,?,?,?)', [$fn, $ln, $email, password_hash($pw, PASSWORD_DEFAULT), s($in['phone_number'] ?? '', 30) ?: null, $role]);
        $id = lastId();
        if ($role === 'customer') q('INSERT INTO customers(user_id,avatar_initials) VALUES(?,?)', [$id, mb_strtoupper(mb_substr($fn, 0, 1) . mb_substr($ln, 0, 1))]);
        return $id;
    });
    audit('USER_CREATED', "$email ($role)");
    out(['user_id' => $id], 201);
});
route('POST', '/owner/users/{id}/status', ['superadmin'], function ($u, $id) {
    $st = input()['status'] ?? '';
    if (!in_array($st, ['Active', 'Disabled'], true)) fail('Invalid status.');
    if ($id === $u['id']) fail('You cannot change your own status.', 409);
    $t = one('SELECT * FROM users WHERE user_id=?', [$id]);
    if (!$t) fail('User not found.', 404);
    q('UPDATE users SET status=? WHERE user_id=?', [$st, $id]);
    audit('USER_STATUS', "{$t['email']} -> $st");
    out(['status' => $st]);
});
route('DELETE', '/owner/users/{id}', ['superadmin'], function ($u, $id) {
    if ($id === $u['id']) fail('You cannot delete your own account.', 409);
    $t = one('SELECT * FROM users WHERE user_id=?', [$id]);
    if (!$t) fail('User not found.', 404);
    if ($t['role'] === 'superadmin' && (int)one('SELECT COUNT(*) n FROM users WHERE role="superadmin" AND status="Active"')['n'] <= 1) fail('At least one active owner account must remain.', 409);
    try {
        tx(function () use ($id, $t) {
            if ($t['role'] === 'customer') q('DELETE FROM customers WHERE user_id=?', [$id]);
            q('DELETE FROM users WHERE user_id=?', [$id]);
        });
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') { if (db()->inTransaction()) db()->rollBack(); fail('This account has linked records (inquiries, quotations, logs) and cannot be deleted. Disable it instead.', 409); }
        throw $e;
    }
    audit('USER_DELETED', $t['email']);
    out(['message' => 'Account deleted.']);
});
