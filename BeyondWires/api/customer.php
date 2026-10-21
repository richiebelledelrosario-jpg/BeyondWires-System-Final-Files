<?php
/* ============ Public catalog (step 1: view products, services and packages) ============
   Customers never receive prices, suppliers or price history here. The Admin "Products" tab
   (admin.php) is the only source of this list. */
route('GET', '/catalog', null, function () {
    out(all('SELECT product_id,name,description,category,item_type FROM products WHERE is_active=1 AND unit_price > 0 ORDER BY FIELD(item_type,"package","service","product"),category,name'));
});

/* ============ Calendar (shared by site visit + installation + reschedule) ============
   Built from the slots the admin published and the bookings that hold them. No customer names. */
function calendar_days(string $from, string $to, ?int $exclude): array {
    $pub = all('SELECT available_date d, time_slot t FROM schedule_availability WHERE available_date BETWEEN ? AND ?', [$from, $to]);
    $taken = all('SELECT schedule_id, scheduled_date d, time_slot t FROM installation_schedules WHERE scheduled_date BETWEEN ? AND ? AND status IN ("Requested","Confirmed")', [$from, $to]);
    $days = [];
    foreach ($pub as $r) $days[$r['d']][$r['t']] = false;
    foreach ($taken as $r) if ((int)$r['schedule_id'] !== $exclude) $days[$r['d']][$r['t']] = true;
    $outDays = [];
    foreach ($days as $d => $slots) {
        $list = array_keys($slots);
        usort($list, fn($a, $b) => time_minutes($a) <=> time_minutes($b));
        $outDays[$d] = array_map(fn($t) => ['time' => $t, 'taken' => $slots[$t]], $list);
    }
    return $outDays;
}
/** A customer may only ignore ("exclude") their own booking when moving it. */
function own_schedule_id(array $u, $id): ?int {
    $id = (int)$id; if (!$id) return null;
    if ($u['role'] !== 'customer') return $id;
    return one('SELECT s.schedule_id ' . CUST_SCHEDULE_JOIN . ' WHERE s.schedule_id=? AND i.customer_id=?', [$id, $u['customer_id']]) ? $id : null;
}
route('GET', '/availability', [], function ($u) {
    $from = (string)($_GET['from'] ?? date('Y-m-01')); $to = (string)($_GET['to'] ?? date('Y-m-t', strtotime('+2 months')));
    if (!valid_date($from) || !valid_date($to) || $from > $to) fail('Invalid date range.');
    if ((strtotime($to) - strtotime($from)) / 86400 > 400) fail('Please keep the range to about a year.');
    $staff = $u['role'] !== 'customer';
    out([
        'today' => date('Y-m-d'),
        'min_date' => $staff ? date('Y-m-d') : date('Y-m-d', strtotime('+1 day')),
        'max_date' => $staff ? STAFF_DATES[1] : min(CUSTOMER_DATES[1], date('Y-m-d', strtotime('+' . (int)cfg('booking_days_ahead') . ' days'))),
        'standard' => cfg('slots'),
        'days' => calendar_days($from, $to, own_schedule_id($u, $_GET['exclude'] ?? 0)),
    ]);
});
route('GET', '/slots', [], function ($u) {
    $date = (string)($_GET['date'] ?? '');
    if (!valid_date($date)) fail('Invalid date.');
    $day = calendar_days($date, $date, own_schedule_id($u, $_GET['exclude'] ?? 0))[$date] ?? [];
    $bookable = $date > date('Y-m-d') && $date <= date('Y-m-d', strtotime('+' . (int)cfg('booking_days_ahead') . ' days'));
    out(['date' => $date, 'slots' => array_map(fn($s) => ['slot' => $s['time'], 'available' => $bookable && !$s['taken']], $day)]);
});
route('GET', '/slots/month', [], function () {
    $m = $_GET['month'] ?? date('Y-m');
    if (!preg_match('/^\d{4}-\d{2}$/', $m)) fail('Invalid month.');
    $rows = all('SELECT scheduled_date d, COUNT(*) c FROM installation_schedules WHERE DATE_FORMAT(scheduled_date,"%Y-%m")=? AND status IN ("Requested","Confirmed") GROUP BY scheduled_date', [$m]);
    $pub = all('SELECT available_date d, COUNT(*) c FROM schedule_availability WHERE DATE_FORMAT(available_date,"%Y-%m")=? GROUP BY available_date', [$m]);
    out(['month' => $m, 'total_slots' => count(cfg('slots')), 'booked' => $rows, 'published' => $pub]);
});

/* ============ Step 4: inquiry ============
   One form may carry several inquiries ("Add more inquiry"); each becomes its own inquiry row
   (own address, site visit and quotation). The 10-inquiry limit counts every row. */
const BUDGETS = ['₱10,000 - ₱25,000', '₱25,000 - ₱50,000', '₱50,000 - ₱100,000', '₱100,000 and above'];
function valid_budget(string $b): ?string {
    if (in_array($b, BUDGETS, true)) return $b;
    $n = str_replace([',', '₱', ' '], '', $b);
    if (is_numeric($n) && $n > 0 && $n <= 100000000) return '₱' . number_format((float)$n, 0);
    return null;
}
/** Installation address from the dropdowns: province -> city -> district (Manila only) -> barangay, plus street and landmark.
    Mainland Luzon only. Checked against the same PSA list the page uses (JS/luzon-address.json). Returns the parts and the full address. */
function service_address(array $b, string $p): array {
    static $provs = null;
    if ($provs === null) $provs = json_decode((string)@file_get_contents(__DIR__ . '/../JS/luzon-address.json'), true)['provinces'] ?? [];
    if (!$provs) fail('The address list is missing on the server (JS/luzon-address.json).', 500);
    $clean = fn($k, $max) => preg_replace('/\s+/', ' ', s($b[$k] ?? '', $max));
    [$prov, $city, $dist, $brgy, $street, $mark] = [$clean('province', 40), $clean('city', 40), $clean('district', 40), $clean('barangay', 60), $clean('street', 120), $clean('landmark', 120)];
    $pr = current(array_filter($provs, fn($x) => $x['name'] === $prov));
    if (!$pr) fail($p . 'Please choose your province (mainland Luzon only).');
    $c = current(array_filter($pr['cities'], fn($x) => $x['name'] === $city));
    if (!$c) fail($p . 'Please choose your city or municipality.');
    $list = $c['barangays'] ?? [];
    if (isset($c['districts'])) {
        $d = current(array_filter($c['districts'], fn($x) => $x['name'] === $dist));
        if (!$d) fail($p . 'Please choose your district in Manila.');
        $list = $d['barangays'];
    } else $dist = '';
    if (!in_array($brgy, $list, true)) fail($p . 'Please choose your barangay from the list.');
    $ok = '/^[\p{L}\p{N}\s.,#\-\/\'()&]+$/u';
    if (mb_strlen($street) < 3 || !preg_match($ok, $street)) fail($p . 'Please enter your house / unit number, building and street (letters, numbers and . , # - / \' ( ) & only).');
    if ($mark !== '' && !preg_match($ok, $mark)) fail($p . 'The landmark can contain letters, numbers and . , # - / \' ( ) & only.');
    $addr = implode(', ', array_filter([$street, $brgy, $dist, $c['name'], $pr['name']]));
    return ['addr' => $addr, 'province' => $pr['name'], 'city' => $c['name'], 'district' => $dist ?: null, 'barangay' => $brgy, 'landmark' => $mark ?: null];
}
function inquiry_block(array $b, int $n, bool $many): array {
    $p = $many ? "Inquiry $n: " : '';
    $opt = $b['purchase_option'] ?? '';
    if (!in_array($opt, ['service', 'product', 'both', 'package'], true)) fail($p . 'Choose a purchase option.');
    $place = $b['place_type'] ?? '';
    if (!in_array($place, ['Residential', 'Commercial'], true)) fail($p . 'Choose Residential or Commercial.');
    $where = service_address($b, $p);
    $addr = $where['addr'];
    $urg = $b['urgency_level'] ?? 'Normal';
    if (!in_array($urg, ['Low', 'Normal', 'Very Urgent'], true)) fail($p . 'Choose an urgency level.');
    $visit = filter_var($b['needs_site_visit'] ?? false, FILTER_VALIDATE_BOOLEAN);
    $date = (string)($b['visit_date'] ?? ''); $slot = (string)($b['visit_slot'] ?? '');
    if ($visit && ($date === '' || $slot === '')) fail($p . 'Choose a preferred site-visit date and time slot.');
    $items = []; $budget = null;
    if (!$visit) {
        // items the customer is interested in: must exist, be active and match the purchase option
        // a package inquiry may also carry optional extra products (at least one package is still required)
        $types = ['service' => ['service'], 'product' => ['product'], 'both' => ['service', 'product'], 'package' => ['package', 'product']][$opt];
        $packages = 0;
        foreach ((array)($b['items'] ?? []) as $it) {
            $pid = (int)(is_array($it) ? ($it['product_id'] ?? 0) : $it);
            $row = one('SELECT product_id,item_type FROM products WHERE product_id=? AND is_active=1', [$pid]);
            if (!$row || !in_array($row['item_type'], $types, true)) fail($p . 'One of the selected items is no longer available. Please choose again.');
            if ($row['item_type'] === 'package') $packages++;
            $items[$pid] = max(1, min(9999, (int)(is_array($it) ? ($it['quantity'] ?? 1) : 1)));
        }
        if (!$items) fail($p . 'Please select at least one item from the list.');
        if ($opt === 'package' && !$packages) fail($p . 'Please choose at least one package.');
        $budget = valid_budget(s($b['budget_range'] ?? '', 60));
        if (!$budget) fail($p . 'Please select a budget range or enter a valid custom amount.');
    }
    return compact('opt', 'place', 'addr', 'urg', 'visit', 'date', 'slot', 'items', 'budget', 'where') + ['req' => s($b['requirements'] ?? '', 2000) ?: null];
}
route('POST', '/customer/inquiries', ['customer'], function ($u) {
    $in = input();
    $raw = isset($in['blocks']) && is_array($in['blocks']) ? array_values($in['blocks']) : [$in];
    if (!$raw) fail('Nothing to submit.');
    if (count($raw) > (int)cfg('max_blocks')) fail('You can add up to ' . cfg('max_blocks') . ' inquiries in one submission.');
    $blocks = [];
    foreach ($raw as $i => $b) $blocks[] = inquiry_block((array)$b, $i + 1, count($raw) > 1);
    $max = (int)cfg('max_inquiries');
    $ids = tx(function () use ($u, $blocks, $max) {
        q('SELECT customer_id FROM customers WHERE customer_id=? FOR UPDATE', [$u['customer_id']]);   // serialises two submissions from the same account
        $used = (int)one('SELECT COUNT(*) n FROM service_inquiries WHERE customer_id=?', [$u['customer_id']])['n'];
        if ($used + count($blocks) > $max) fail($used >= $max ? "You have reached the limit of $max inquiries." : 'You can submit ' . ($max - $used) . " more inquir" . ($max - $used === 1 ? 'y' : 'ies') . " (limit $max).", 409);
        $ref = count($blocks) > 1 ? 'S' . date('ymdHis') . $u['customer_id'] : null;
        $ids = [];
        foreach ($blocks as $n => $b) {
            q('INSERT INTO service_inquiries(customer_id,installation_address,province,city,district,barangay,landmark,place_type,purchase_option,requirements,budget_range,urgency_level,needs_site_visit,preferred_visit_at,submission_ref) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
              [$u['customer_id'], $b['addr'], $b['where']['province'], $b['where']['city'], $b['where']['district'], $b['where']['barangay'], $b['where']['landmark'], $b['place'], $b['opt'], $b['req'], $b['budget'], $b['urg'], (int)$b['visit'], null, $ref]);
            $iid = lastId();
            if ($b['visit']) {
                $sid = reserve_slot(null, $iid, $b['date'], $b['slot'], 'Site Inspection');
                $s = one('SELECT scheduled_date,time_slot FROM installation_schedules WHERE schedule_id=?', [$sid]);
                q('UPDATE service_inquiries SET preferred_visit_at=? WHERE inquiry_id=?', [date('Y-m-d H:i:s', strtotime($s['scheduled_date'] . ' ' . $s['time_slot'])), $iid]);
            }
            foreach ($b['items'] as $pid => $qty) q('INSERT INTO inquiry_items(inquiry_id,product_id,quantity) VALUES(?,?,?)', [$iid, $pid, $qty]);
            $ids[] = $iid;
        }
        return $ids;
    });
    foreach ($ids as $k => $id)
        notify_role('admin', 'New inquiry', "Inquiry #$id from {$u['name']} ({$blocks[$k]['place']})." . ($blocks[$k]['visit'] ? ' Site visit requested.' : ''), 'inquiry:' . $id);
    notify((int)$u['id'], 'Inquiry received', (count($ids) > 1 ? count($ids) . ' inquiries were' : "Inquiry #{$ids[0]} was") . ' received. Please wait for our acknowledgment.', 'inquiry:' . $ids[0]);
    audit('INQUIRY_SUBMITTED', implode(',', array_map(fn($i) => "#$i", $ids)));
    out(['inquiry_id' => $ids[0], 'inquiry_ids' => $ids, 'message' => 'Inquiry submitted. Please wait for our acknowledgment.'], 201);
});

function customer_inquiries(int $cid, ?int $id = null): array {
    $rows = all('SELECT i.inquiry_id,i.installation_address,i.city,i.barangay,i.landmark,i.place_type,i.purchase_option,i.requirements,i.budget_range,i.urgency_level,i.needs_site_visit,i.preferred_visit_at,
                        i.status,i.date_submitted,i.submission_ref,i.rejection_reason,i.rejection_note,i.rejected_at,
                        s.schedule_id visit_schedule_id, s.scheduled_date visit_date, s.time_slot visit_slot, s.status visit_status
                 FROM service_inquiries i
                 LEFT JOIN installation_schedules s ON s.schedule_id=(SELECT MAX(x.schedule_id) FROM installation_schedules x WHERE x.inquiry_id=i.inquiry_id AND x.activity_type="Site Inspection" AND x.status<>"Cancelled")
                 WHERE i.customer_id=?' . ($id ? ' AND i.inquiry_id=?' : '') . ' ORDER BY i.inquiry_id DESC', $id ? [$cid, $id] : [$cid]);
    if (!$rows) return [];
    $ids = implode(',', array_map(fn($r) => (int)$r['inquiry_id'], $rows));
    $items = all("SELECT ii.inquiry_id, p.name, p.item_type, p.description, p.category, ii.quantity FROM inquiry_items ii JOIN products p USING(product_id) WHERE ii.inquiry_id IN ($ids)");
    $by = []; foreach ($items as $it) $by[$it['inquiry_id']][] = $it;
    foreach ($rows as &$r) $r['items'] = $by[$r['inquiry_id']] ?? [];
    return $rows;
}
route('GET', '/customer/inquiries', ['customer'], function ($u) {
    out(customer_inquiries($u['customer_id']));
});
route('GET', '/customer/inquiries/{id}', ['customer'], function ($u, $id) {
    $i = customer_inquiries($u['customer_id'], $id)[0] ?? null;
    if (!$i) fail('Inquiry not found.', 404);
    $i['quotation'] = one('SELECT quotation_id,quotation_no,status FROM quotations WHERE inquiry_id=? AND status NOT IN ("Draft","Pending Superadmin") ORDER BY quotation_id DESC LIMIT 1', [$id]);
    out($i);
});

/* ============ Steps 6-7: quotations ============ */
const CUSTOMER_VISIBLE = '("Sent to Customer","Approved","Declined","Revision Requested")';

route('GET', '/customer/quotations', ['customer'], function ($u) {
    out(all('SELECT quotation_id,quotation_no,inquiry_id,total_amount,status,payment_status,date_created,expiry_date FROM quotations WHERE customer_id=? AND status IN ' . CUSTOMER_VISIBLE . ' ORDER BY quotation_id DESC', [$u['customer_id']]));
});
/** What a customer may see of a quotation: the priced document, never internal notes, the itemised
    expense list (shown as one "Extra expenses" line), the owner's comments or the edit history. */
function customer_quote(array $u, int $id): array {
    $q = quote_detail($id);
    if (!$q || (int)$q['customer_id'] !== $u['customer_id'] || !in_array($q['status'], ['Sent to Customer', 'Approved', 'Declined', 'Revision Requested'], true)) fail('Quotation not found.', 404);
    $q['extra_expenses'] = (float)$q['other_charges_total'];
    $q['items'] = array_map(fn($i) => ['name' => $i['description'], 'quantity' => (int)$i['quantity'], 'unit_price' => (float)$i['unit_price'], 'total_amount' => (float)$i['total_amount'],
                                      'item_type' => $i['item_type'], 'description' => $i['product_description'] ?: $i['category']], $q['items']);
    $q['labor'] = array_map(fn($l) => ['role' => $l['role'], 'workers' => (int)$l['workers'], 'days' => (int)$l['days'], 'daily_rate' => (float)$l['daily_rate'], 'amount' => (float)$l['amount']], $q['labor']);
    unset($q['superadmin_comment'], $q['created_by'], $q['pdf_path'], $q['charges'], $q['events']);
    $q['qr_url'] = cfg('payment_qr_url');
    $q['schedule'] = one('SELECT schedule_id,scheduled_date,time_slot,status FROM installation_schedules WHERE quotation_id=? AND activity_type="Installation" AND status<>"Cancelled" ORDER BY schedule_id DESC LIMIT 1', [$id]);
    $q['payment_options'] = $q['place_type'] === 'Residential'
        ? ['Half upon quotation', 'Full upon quotation', 'Full after installation'] : ['Half upon quotation', 'Full upon quotation'];
    return $q;
}
route('GET', '/customer/quotations/{id}', ['customer'], function ($u, $id) {
    out(customer_quote($u, $id));
});

/* 7.a approve: preferred install slot + payment agreement + method */
route('POST', '/customer/quotations/{id}/approve', ['customer'], function ($u, $id) {
    $in = input();
    $q = quote_detail($id);
    if (!$q || (int)$q['customer_id'] !== $u['customer_id']) fail('Quotation not found.', 404);
    if ($q['status'] !== 'Sent to Customer') fail('This quotation can no longer be approved.', 409);
    if ($q['expiry_date'] && $q['expiry_date'] < date('Y-m-d')) fail('This quotation has expired. Please request a new one.', 409);

    $allowed = $q['place_type'] === 'Residential' ? ['Half upon quotation', 'Full upon quotation', 'Full after installation'] : ['Half upon quotation', 'Full upon quotation'];
    $agr = $in['payment_agreement'] ?? '';
    if (!in_array($agr, $allowed, true)) fail('That payment agreement is not available for ' . strtolower($q['place_type']) . ' properties.');
    $method = $in['payment_method'] ?? '';
    if (!in_array($method, ['Online', 'Over the counter'], true)) fail('Choose Online or Over the counter.');
    $date = (string)($in['install_date'] ?? ''); $slot = (string)($in['install_slot'] ?? '');
    if ($date === '' || $slot === '') fail('Choose your preferred installation date and time slot.');

    $total = (float)$q['total_amount'];
    $pid = tx(function () use ($u, $q, $id, $agr, $method, $date, $slot, $total) {
        $sid = reserve_slot($id, (int)$q['inquiry_id'], $date, $slot, 'Installation');
        $slot = one('SELECT time_slot FROM installation_schedules WHERE schedule_id=?', [$sid])['time_slot'];
        q('INSERT INTO quotation_approvals(quotation_id,payment_agreement,payment_method,preferred_install_date,preferred_install_slot,process_step) VALUES(?,?,?,?,?,"Approved by customer")',
          [$id, $agr, $method, $date, $slot]);
        $after = $agr === 'Full after installation';
        $title = $q['project_title'] ?: ($q['place_type'] . ' installation - ' . mb_substr($q['installation_address'], 0, 80));
        q('INSERT INTO projects(customer_id,inquiry_id,project_name,start_date,status,install_status) VALUES(?,?,?,?,?,"Scheduled")',
          [$u['customer_id'], $q['inquiry_id'], mb_substr($title, 0, 160), $date, $after ? 'Installation In Progress' : 'Awaiting Payment']);
        $pid = lastId();
        q('UPDATE quotations SET status="Approved", project_id=? WHERE quotation_id=?', [$pid, $id]);
        q('UPDATE service_inquiries SET status="Quoted" WHERE inquiry_id=?', [$q['inquiry_id']]);
        create_payments((int)$id, (int)$u['customer_id'], $total, $agr, $method);
        quote_event((int)$id, "Approved by customer. Project #$pid created");
        return $pid;
    });
    audit('QUOTATION_APPROVED', $q['quotation_no']);
    notify_role('admin', 'Quotation approved', "{$q['quotation_no']} approved by customer. Payment: $agr ($method). Install request: $date $slot.", 'project:' . $pid);
    out(['project_id' => $pid, 'message' => 'Quotation approved. Please proceed to payment.']);
});
/** Payment rows for an agreement (also used when the admin changes the terms before anything is paid). */
function create_payments(int $qid, int $cid, float $total, string $agr, string $method): void {
    $ins = fn($inst, $amt, $st) => q('INSERT INTO payments(quotation_id,customer_id,installment,amount_due,payment_method,payment_agreement,status) VALUES(?,?,?,?,?,?,?)',
                                     [$qid, $cid, $inst, $amt, $method, $agr, $st]);
    if ($agr === 'Half upon quotation') { $half = round($total / 2, 2); $ins('Down payment', $half, 'Awaiting Payment'); $ins('Final balance', round($total - $half, 2), 'Not Due'); }
    elseif ($agr === 'Full upon quotation') $ins('Full', $total, 'Awaiting Payment');
    else $ins('Full', $total, 'Not Due');
}

/* 7.b decline: revise (loop back to admin) or cancel */
route('POST', '/customer/quotations/{id}/decline', ['customer'], function ($u, $id) {
    $in = input();
    $q = one('SELECT * FROM quotations WHERE quotation_id=? AND customer_id=?', [$id, $u['customer_id']]);
    if (!$q) fail('Quotation not found.', 404);
    if ($q['status'] !== 'Sent to Customer') fail('This quotation can no longer be declined.', 409);
    $action = $in['action'] ?? '';
    if (!in_array($action, ['revise', 'cancel'], true)) fail('Choose to request a new quotation or cancel.');
    tx(function () use ($id, $q, $action, $in) {
        q('INSERT INTO quotation_rejections(quotation_id,action,reason,comments) VALUES(?,?,?,?)', [$id, $action, s($in['reason'] ?? '', 255) ?: null, s($in['comments'] ?? '', 2000) ?: null]);
        if ($action === 'revise') q('UPDATE quotations SET status="Revision Requested" WHERE quotation_id=?', [$id]);
        else {
            q('UPDATE quotations SET status="Declined" WHERE quotation_id=?', [$id]);
            q('UPDATE service_inquiries SET status="Failed" WHERE inquiry_id=?', [$q['inquiry_id']]);
        }
        quote_event((int)$id, $action === 'revise' ? 'Declined by customer: new quotation requested' : 'Declined by customer: negotiation cancelled');
    });
    audit('QUOTATION_DECLINED', $q['quotation_no'] . " ($action)");
    notify_role('admin', $action === 'revise' ? 'New quotation requested' : 'Negotiation cancelled',
        $q['quotation_no'] . ($action === 'revise' ? ' was declined; the customer wants a revised quotation.' : ' was declined and the inquiry is marked Failed.'), 'quotation:' . $id);
    out(['message' => $action === 'revise' ? 'We will prepare a revised quotation.' : 'Negotiation cancelled.']);
});

/* ============ Step 8: payments ============ */
route('GET', '/customer/payments', ['customer'], function ($u) {
    $rows = all('SELECT p.payment_id,p.quotation_id,q.quotation_no,q.project_id,p.installment,p.amount_due,p.amount_paid,p.payment_method,p.payment_agreement,p.status,p.reject_reason,p.reference_no,p.transaction_date,p.confirmed_at,p.proof_of_payment_url IS NOT NULL AS has_proof
                 FROM payments p JOIN quotations q USING(quotation_id) WHERE p.customer_id=? ORDER BY p.payment_id DESC', [$u['customer_id']]);
    foreach ($rows as &$r)   // 8.a show QR + the exact amount for online payments
        $r['qr_url'] = ($r['payment_method'] === 'Online' && in_array($r['status'], ['Awaiting Payment', 'Rejected'], true)) ? cfg('payment_qr_url') : null;
    out($rows);
});
route('POST', '/customer/payments/{id}/proof', ['customer'], function ($u, $id) {
    $p = one('SELECT p.*, q.project_id, q.quotation_no FROM payments p JOIN quotations q USING(quotation_id) WHERE p.payment_id=? AND p.customer_id=?', [$id, $u['customer_id']]);
    if (!$p) fail('Payment not found.', 404);
    // Online: the screenshot is mandatory. Over the counter: the customer may upload the photo of the official receipt
    // (the admin can also record the cash payment without it).
    if (!in_array($p['status'], ['Awaiting Payment', 'Rejected'], true)) fail('This payment is not waiting for proof.', 409);
    $ref = s($_POST['reference_no'] ?? '', 60);
    if (mb_strlen($ref) < 4 || !preg_match('/^[A-Za-z0-9\- ]+$/', $ref)) fail('Please enter the reference number from your payment (letters, numbers and dashes).');
    $paid = (string)($_POST['payment_date'] ?? date('Y-m-d'));
    need_date($paid, CUSTOMER_DATES, 'payment date');
    if ($paid > date('Y-m-d')) fail('Payment date cannot be in the future.');
    $path = save_upload('proof', IMG + PDFM, 'proofs');   // 8.a.1 screenshot is mandatory
    q('UPDATE payments SET proof_of_payment_url=?, reference_no=?, status="Under Review", reject_reason=NULL, transaction_date=? WHERE payment_id=?',
      [$path, $ref, $paid . ' ' . date('H:i:s'), $id]);
    if ($p['project_id']) q('UPDATE projects SET status="Payment Under Review" WHERE project_id=? AND status="Awaiting Payment"', [$p['project_id']]);
    audit('PAYMENT_PROOF_UPLOADED', $p['quotation_no']);
    notify_role('admin', 'Payment proof uploaded', "{$u['name']} uploaded proof for {$p['quotation_no']} ({$p['installment']}).", $p['project_id'] ? 'project:' . $p['project_id'] : null);
    out(['message' => 'Proof received. Waiting for admin confirmation.']);
});

/* ============ Steps 9-11: projects, documents, dashboard ============ */
route('GET', '/customer/projects', ['customer'], function ($u) {
    out(all('SELECT p.project_id,p.project_name,p.status,p.install_status,p.start_date,p.end_date,p.created_at,q.quotation_id,q.quotation_no,q.total_amount,q.payment_status,
                    (SELECT s.scheduled_date FROM installation_schedules s WHERE s.quotation_id=q.quotation_id AND s.activity_type="Installation" AND s.status<>"Cancelled" ORDER BY s.schedule_id DESC LIMIT 1) install_date,
                    (SELECT s.time_slot FROM installation_schedules s WHERE s.quotation_id=q.quotation_id AND s.activity_type="Installation" AND s.status<>"Cancelled" ORDER BY s.schedule_id DESC LIMIT 1) install_slot
             FROM projects p LEFT JOIN quotations q ON q.project_id=p.project_id WHERE p.customer_id=? ORDER BY p.project_id DESC', [$u['customer_id']]));
});
/** Everything in the customer's Documents tab: uploaded files plus documents shown from live data
    (quotations sent to them, receipts and certificates the admin sent). */
function customer_documents(int $cid): array {
    $files = all('SELECT d.document_id,d.document_type,d.title,d.date_issued,d.status,d.quotation_id,d.payment_id,p.project_id FROM customer_documents d LEFT JOIN projects p ON p.inquiry_id=d.inquiry_id WHERE d.customer_id=? ORDER BY d.document_id DESC', [$cid]);
    $docs = []; $hasQ = []; $hasR = [];
    foreach ($files as $f) {
        $docs[] = ['kind' => 'file', 'id' => (int)$f['document_id'], 'type' => $f['document_type'] === 'Other' ? (str_starts_with($f['title'], 'Job Order') ? 'Job Order' : 'Contract') : $f['document_type'], 'title' => $f['title'], 'date' => $f['date_issued'], 'status' => $f['status'] ?: 'Available',
                   'quotation_id' => $f['quotation_id'], 'payment_id' => $f['payment_id'], 'project_id' => $f['project_id']];
        if ($f['quotation_id'] && $f['document_type'] === 'Quotation') $hasQ[$f['quotation_id']] = 1;
        if ($f['payment_id']) $hasR[$f['payment_id']] = 1;
    }
    foreach (all('SELECT q.quotation_id,q.quotation_no,q.status,q.date_created,q.project_id,COALESCE(q.project_title,p.project_name) title FROM quotations q LEFT JOIN projects p ON p.project_id=q.project_id WHERE q.customer_id=? AND q.status IN ' . CUSTOMER_VISIBLE, [$cid]) as $q)
        if (empty($hasQ[$q['quotation_id']]))
            $docs[] = ['kind' => 'quotation', 'id' => (int)$q['quotation_id'], 'type' => 'Quotation', 'title' => 'Quotation ' . $q['quotation_no'] . ($q['title'] ? ' - ' . $q['title'] : ''), 'date' => substr($q['date_created'], 0, 10),
                       'status' => ['Sent to Customer' => 'Pending', 'Approved' => 'Approved', 'Declined' => 'Declined', 'Revision Requested' => 'Declined'][$q['status']], 'quotation_id' => (int)$q['quotation_id'], 'project_id' => $q['project_id']];
    foreach (all('SELECT r.receipt_no,r.sent_at,p.payment_id,p.installment,q.project_id FROM receipts r JOIN payments p USING(payment_id) JOIN quotations q ON q.quotation_id=p.quotation_id WHERE p.customer_id=? AND r.sent_at IS NOT NULL', [$cid]) as $r)
        if (empty($hasR[$r['payment_id']]))
            $docs[] = ['kind' => 'receipt', 'id' => (int)$r['payment_id'], 'type' => 'Receipt', 'title' => 'Acknowledgement Receipt ' . $r['receipt_no'] . ' - ' . $r['installment'], 'date' => substr($r['sent_at'], 0, 10), 'status' => 'Completed', 'payment_id' => (int)$r['payment_id'], 'project_id' => $r['project_id']];
    foreach (all('SELECT c.project_id,c.sent_at,p.project_name FROM project_certificates c JOIN projects p USING(project_id) WHERE p.customer_id=? AND c.sent_at IS NOT NULL', [$cid]) as $c) {
        $docs[] = ['kind' => 'certificate', 'id' => (int)$c['project_id'], 'type' => 'Certificate', 'title' => 'Installation Certificate - ' . $c['project_name'], 'date' => substr($c['sent_at'], 0, 10), 'status' => 'Completed', 'project_id' => (int)$c['project_id']];
        $docs[] = ['kind' => 'report', 'id' => (int)$c['project_id'], 'type' => 'Report', 'title' => 'Accomplishment Report - ' . $c['project_name'], 'date' => substr($c['sent_at'], 0, 10), 'status' => 'Completed', 'project_id' => (int)$c['project_id']];
    }
    usort($docs, fn($a, $b) => strcmp((string)$b['date'], (string)$a['date']));
    return $docs;
}
route('GET', '/customer/documents', ['customer'], function ($u) {
    out(customer_documents($u['customer_id']));
});
route('GET', '/customer/documents/{id}/download', ['customer'], function ($u, $id) {
    $d = one('SELECT * FROM customer_documents WHERE document_id=? AND customer_id=?', [$id, $u['customer_id']]);
    if (!$d) fail('Document not found.', 404);
    stream_file($d['file_path'], $d['title'] . '.' . pathinfo($d['file_path'], PATHINFO_EXTENSION));
});
route('GET', '/customer/receipts/{id}', ['customer'], function ($u, $id) {   // {id} = payment_id
    $own = one('SELECT 1 FROM payments p JOIN receipts r USING(payment_id) WHERE p.payment_id=? AND p.customer_id=? AND (r.sent_at IS NOT NULL OR r.file_path IS NOT NULL)', [$id, $u['customer_id']]);
    $r = $own ? receipt_data($id) : null;
    if (!$r) fail('Receipt not found.', 404);
    unset($r['issued_first'], $r['issued_last']);
    out($r);
});
route('GET', '/customer/certificates/{id}', ['customer'], function ($u, $id) {   // {id} = project_id
    $c = one('SELECT c.data,c.sent_at,p.project_name,p.start_date,p.end_date FROM project_certificates c JOIN projects p USING(project_id) WHERE c.project_id=? AND p.customer_id=? AND c.sent_at IS NOT NULL', [$id, $u['customer_id']]);
    if (!$c) fail('Certificate not found.', 404);
    $c['data'] = json_decode($c['data'], true) ?: [];
    $c['photos'] = all('SELECT photo_id,caption FROM certificate_photos WHERE project_id=? ORDER BY photo_id', [$id]);
    out($c);
});
route('GET', '/customer/certificates/{id}/photos/{pid}', ['customer'], function ($u, $id, $pid) {
    $ph = one('SELECT f.file_path FROM certificate_photos f JOIN projects p USING(project_id) JOIN project_certificates c ON c.project_id=p.project_id
               WHERE f.photo_id=? AND f.project_id=? AND p.customer_id=? AND c.sent_at IS NOT NULL', [$pid, $id, $u['customer_id']]);
    if (!$ph) fail('Photo not found.', 404);
    stream_file($ph['file_path'], "photo-$pid");
});
function customer_dashboard(int $cid): array {
    $exp = one('SELECT MIN(expiry_date) e, COUNT(*) n FROM quotations WHERE customer_id=? AND status="Sent to Customer"', [$cid]);
    return [
        'inquiries'  => all('SELECT status, COUNT(*) n FROM service_inquiries WHERE customer_id=? GROUP BY status', [$cid]),
        'quotations_to_review' => (int)$exp['n'],
        'next_expiry' => $exp['e'],
        'payments_due' => (int)one('SELECT COUNT(*) n FROM payments WHERE customer_id=? AND status IN ("Awaiting Payment","Rejected")', [$cid])['n'],
        'active_projects' => (int)one('SELECT COUNT(*) n FROM projects WHERE customer_id=? AND status<>"Done" AND status<>"Failed"', [$cid])['n'],
        'completed_projects' => (int)one('SELECT COUNT(*) n FROM projects WHERE customer_id=? AND status="Done"', [$cid])['n'],
        'total_paid' => (float)one('SELECT COALESCE(SUM(amount_paid),0) s FROM payments WHERE customer_id=? AND status="Confirmed"', [$cid])['s'],
        'activity' => all('SELECT activity_device,location,status,timestamp FROM customer_activity_logs WHERE customer_id=? ORDER BY log_id DESC LIMIT 5', [$cid]),
    ];
}
route('GET', '/customer/dashboard', ['customer'], function ($u) {
    out(customer_dashboard($u['customer_id']));
});

/* ============ Schedules (dashboard list + customer reschedule) ============ */
const CUST_SCHEDULE_JOIN = 'FROM installation_schedules s LEFT JOIN quotations q ON q.quotation_id=s.quotation_id
    JOIN service_inquiries i ON i.inquiry_id=COALESCE(s.inquiry_id,q.inquiry_id)';
function customer_schedules(int $cid): array {
    return all('SELECT s.schedule_id,s.scheduled_date,s.time_slot,s.activity_type,s.status,s.notes,s.quotation_id,i.inquiry_id,i.installation_address,q.quotation_no,q.project_id '
        . CUST_SCHEDULE_JOIN . ' WHERE i.customer_id=? AND s.status IN ("Requested","Confirmed") AND s.scheduled_date>=CURDATE() ORDER BY s.scheduled_date,s.time_slot', [$cid]);
}
route('GET', '/customer/schedules', ['customer'], function ($u) {
    out(customer_schedules($u['customer_id']));
});
route('POST', '/customer/schedules/{id}/reschedule', ['customer'], function ($u, $id) {
    $in = input();
    $s = one('SELECT s.* ' . CUST_SCHEDULE_JOIN . ' WHERE s.schedule_id=? AND i.customer_id=? AND s.status IN ("Requested","Confirmed")', [$id, $u['customer_id']]);
    if (!$s) fail('Schedule not found.', 404);
    $reason = s($in['reason'] ?? '', 200);
    if (mb_strlen($reason) < 3) fail('Please give a reason for rescheduling.');
    $date = (string)($in['date'] ?? ''); $slot = norm_time($in['slot'] ?? '') ?? (string)($in['slot'] ?? '');
    if ($date === $s['scheduled_date'] && $slot === $s['time_slot']) fail('That is your current schedule. Pick a different one.');
    tx(function () use ($id, $s, $date, $slot, $reason, &$slotOut) {
        $slotOut = move_slot($id, $date, $slot);
        // the admin sees this under "Reschedule requests" and re-confirms it (Schedules tab)
        q('UPDATE installation_schedules SET status="Requested", notes=?, previous_date=COALESCE(previous_date,?), previous_slot=COALESCE(previous_slot,?), change_reason=?, changed_at=NOW() WHERE schedule_id=?',
          ['Customer reschedule: ' . $reason, $s['scheduled_date'], $s['time_slot'], $reason, $id]);
        if ($s['activity_type'] === 'Site Inspection' && $s['inquiry_id'])
            q('UPDATE service_inquiries SET preferred_visit_at=? WHERE inquiry_id=?', [date('Y-m-d H:i:s', strtotime("$date $slotOut")), $s['inquiry_id']]);
    });
    notify_role('admin', 'Reschedule request', "{$u['name']} moved a {$s['activity_type']} to $date $slotOut. Reason: $reason", 'schedule:' . $id);
    audit('SCHEDULE_CHANGED_CUSTOMER', "#$id -> $date $slotOut");
    out(['message' => 'Schedule updated. We will confirm the new time.', 'date' => $date, 'slot' => $slotOut]);
});

/* ============ Settings: primary contact ============ */
route('POST', '/customer/contact', ['customer'], function ($u) {
    $in = input();
    $name = preg_replace('/\s+/', ' ', s($in['contact_name'] ?? '', 120));
    $role = preg_replace('/\s+/', ' ', s($in['contact_role'] ?? '', 50));
    $email = strtolower(s($in['contact_email'] ?? '', 120));
    $phone = ph_mobile($in['contact_phone'] ?? '');
    if (!preg_match('/^[\p{L}]+(?:\s+[\p{L}]+)*$/u', $name)) fail('Contact name can contain letters and spaces only.');
    if (!preg_match('/^\p{L}[\p{L}\s.\-\/&]{1,49}$/u', $role)) fail('Role can contain letters, spaces and . - / & only.');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Enter a valid email address.');
    if (!$phone) fail('Enter a valid PH mobile number, e.g. +63 917 824 6310.');
    q('UPDATE customers SET contact_name=?, contact_role=?, contact_email=?, contact_phone=? WHERE customer_id=?', [$name, $role, $email, $phone, $u['customer_id']]);
    audit('CONTACT_UPDATE');
    out(['contact_name' => $name, 'contact_role' => $role, 'contact_email' => $email, 'contact_phone' => $phone]);
});

/* ============ Everything the customer page needs, in one call ============ */
route('GET', '/customer/state', ['customer'], function ($u) {
    $c = $u['customer_id'];
    $quotes = all('SELECT quotation_id,quotation_no,inquiry_id,project_id,total_amount,status,payment_status,date_created,expiry_date FROM quotations WHERE customer_id=? AND status IN ' . CUSTOMER_VISIBLE . ' ORDER BY quotation_id DESC', [$c]);
    $pays = all('SELECT p.payment_id,p.quotation_id,p.installment,p.amount_due,p.amount_paid,p.payment_method,p.payment_agreement,p.status,p.reject_reason,p.transaction_date
                 FROM payments p WHERE p.customer_id=? ORDER BY p.payment_id', [$c]);
    out([
        'limit' => ['max' => (int)cfg('max_inquiries'), 'used' => (int)one('SELECT COUNT(*) n FROM service_inquiries WHERE customer_id=?', [$c])['n'], 'max_blocks' => (int)cfg('max_blocks')],
        'inquiries' => customer_inquiries($c),
        'quotations' => $quotes,
        'payments' => $pays,
        'projects' => all('SELECT p.project_id,p.project_name,p.status,p.install_status,p.start_date,p.end_date,p.created_at,q.quotation_id,q.quotation_no,q.payment_status
                           FROM projects p LEFT JOIN quotations q ON q.project_id=p.project_id WHERE p.customer_id=? ORDER BY p.project_id DESC', [$c]),
        'schedules' => customer_schedules($c),
        'documents' => customer_documents($c),
        'dashboard' => customer_dashboard($c),
    ]);
});