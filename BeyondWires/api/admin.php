<?php
function like(string $v): string { return '%' . addcslashes($v, '%_\\') . '%'; }

/* ============ Dashboard ============ */
route('GET', '/admin/dashboard', ['admin'], function () {
    out([
        'inquiries_by_status' => all('SELECT status, COUNT(*) n FROM service_inquiries GROUP BY status'),
        'quotations_by_status' => all('SELECT status, COUNT(*) n FROM quotations GROUP BY status'),
        'projects_by_status' => all('SELECT status, COUNT(*) n FROM projects GROUP BY status'),
        'payments_to_review' => (int)one('SELECT COUNT(*) n FROM payments WHERE status="Under Review" OR (status="Awaiting Payment" AND payment_method="Over the counter")')['n'],
        'latest_inquiries' => all('SELECT i.inquiry_id,i.status,i.place_type,i.date_submitted,CONCAT(u.first_name," ",u.last_name) customer FROM service_inquiries i JOIN customers c USING(customer_id) JOIN users u ON u.user_id=c.user_id ORDER BY i.inquiry_id DESC LIMIT 5'),
        'upcoming_schedule' => all('SELECT s.schedule_id,s.scheduled_date,s.time_slot,s.activity_type,s.status, CONCAT(u.first_name," ",u.last_name) customer FROM installation_schedules s
             LEFT JOIN service_inquiries i ON i.inquiry_id=COALESCE(s.inquiry_id,(SELECT inquiry_id FROM quotations WHERE quotation_id=s.quotation_id))
             LEFT JOIN customers c ON c.customer_id=i.customer_id LEFT JOIN users u ON u.user_id=c.user_id
             WHERE s.scheduled_date>=CURDATE() AND s.status IN ("Requested","Confirmed") ORDER BY s.scheduled_date,s.time_slot LIMIT 5'),
    ]);
});

/* ============ Inquiries ============ */
route('GET', '/admin/inquiries', ['admin'], function () {
    $w = []; $p = [];
    $st = $_GET['status'] ?? 'all';
    if ($st !== 'all') { $w[] = 'i.status=?'; $p[] = $st; }
    if (($t = s($_GET['q'] ?? '', 80)) !== '') {
        $w[] = '(CONCAT(u.first_name," ",u.last_name) LIKE ? OR i.inquiry_id LIKE ? OR i.place_type LIKE ?)';
        array_push($p, like($t), like($t), like($t));
    }
    out(all('SELECT i.inquiry_id,i.place_type,i.purchase_option,i.urgency_level,i.needs_site_visit,i.site_visit_done,i.preferred_visit_at,i.status,i.date_submitted,
                    CONCAT(u.first_name," ",u.last_name) customer, u.email, u.phone_number,
                    (SELECT q.quotation_id FROM quotations q WHERE q.inquiry_id=i.inquiry_id AND q.status<>"Declined" ORDER BY q.quotation_id DESC LIMIT 1) quotation_id,
                    (SELECT q.status FROM quotations q WHERE q.inquiry_id=i.inquiry_id AND q.status<>"Declined" ORDER BY q.quotation_id DESC LIMIT 1) quotation_status
             FROM service_inquiries i JOIN customers c USING(customer_id) JOIN users u ON u.user_id=c.user_id'
             . ($w ? ' WHERE ' . implode(' AND ', $w) : '') . ' ORDER BY i.inquiry_id DESC LIMIT 300', $p));
});
route('GET', '/admin/inquiries/{id}', ['admin'], function ($u, $id) {
    $i = one('SELECT i.*, CONCAT(u.first_name," ",u.last_name) customer, u.email, u.phone_number, c.company_name FROM service_inquiries i JOIN customers c USING(customer_id) JOIN users u ON u.user_id=c.user_id WHERE i.inquiry_id=?', [$id]);
    if (!$i) fail('Inquiry not found.', 404);
    $i['items'] = all('SELECT p.product_id,p.name,ii.quantity FROM inquiry_items ii JOIN products p USING(product_id) WHERE ii.inquiry_id=?', [$id]);
    $i['site_visit'] = one('SELECT * FROM installation_schedules WHERE inquiry_id=? AND activity_type="Site Inspection" AND status<>"Cancelled" ORDER BY schedule_id DESC LIMIT 1', [$id]);
    $i['quotation'] = one('SELECT quotation_id,quotation_no,status FROM quotations WHERE inquiry_id=? ORDER BY quotation_id DESC LIMIT 1', [$id]);
    out($i);
});
/* 3. accept inquiry -> sends the acknowledgment notification (customer step 5) */
route('POST', '/admin/inquiries/{id}/accept', ['admin'], function ($u, $id) {
    $i = one('SELECT * FROM service_inquiries WHERE inquiry_id=?', [$id]);
    if (!$i) fail('Inquiry not found.', 404);
    if ($i['status'] !== 'New Inquiry') fail('This inquiry was already processed.', 409);
    $new = $i['needs_site_visit'] ? 'Pending Visit' : 'Accepted';
    q('UPDATE service_inquiries SET status=? WHERE inquiry_id=?', [$new, $id]);
    notify_customer((int)$i['customer_id'], 'Inquiry acknowledged',
        "Your inquiry #$id has been accepted." . ($i['needs_site_visit'] ? ' We will confirm your site visit schedule shortly.' : ' We are preparing your quotation.'), 'inquiry:' . $id);
    audit('INQUIRY_ACCEPTED', "#$id");
    out(['status' => $new]);
});
/* Reject an inquiry (outside the mainland Luzon service area). Frees any site visit it had booked. */
route('POST', '/admin/inquiries/{id}/reject', ['admin'], function ($u, $id) {
    $in = input();
    $i = one('SELECT * FROM service_inquiries WHERE inquiry_id=?', [$id]);
    if (!$i) fail('Inquiry not found.', 404);
    if (!in_array($i['status'], ['New Inquiry', 'Accepted', 'Pending Visit'], true)) fail('This inquiry can no longer be rejected.', 409);
    if (one('SELECT 1 FROM quotations WHERE inquiry_id=? AND status<>"Declined"', [$id])) fail('This inquiry already has a quotation. Decline the quotation instead.', 409);
    $reason = s($in['reason'] ?? '', 120);
    if ($reason === '') fail('Please choose a reason.');
    $note = s($in['note'] ?? '', 400);
    tx(function () use ($id, $reason, $note) {
        q('UPDATE service_inquiries SET status="Failed", rejection_reason=?, rejection_note=?, rejected_at=NOW() WHERE inquiry_id=?', [$reason, $note ?: null, $id]);
        q('UPDATE installation_schedules SET status="Cancelled" WHERE inquiry_id=? AND activity_type="Site Inspection" AND status IN ("Requested","Confirmed")', [$id]);
    });
    notify_customer((int)$i['customer_id'], 'Inquiry not accepted', $note !== '' ? $note : "Your inquiry #$id was not accepted: $reason.", 'inquiry:' . $id);
    audit('INQUIRY_REJECTED', "#$id ($reason)");
    out(['status' => 'Failed']);
});
/* 4.b site visit: confirm (optionally move the slot), then mark complete */
route('POST', '/admin/inquiries/{id}/site-visit/confirm', ['admin'], function ($u, $id) {
    $in = input();
    $i = one('SELECT * FROM service_inquiries WHERE inquiry_id=?', [$id]);
    $s = one('SELECT * FROM installation_schedules WHERE inquiry_id=? AND activity_type="Site Inspection" AND status IN ("Requested","Confirmed") ORDER BY schedule_id DESC LIMIT 1', [$id]);
    if (!$i || !$s) fail('No site visit to confirm.', 404);
    if ($i['status'] !== 'Pending Visit') fail('Accept the inquiry first.', 409);
    tx(function () use ($s, $in) {
        if (!empty($in['date']) && !empty($in['slot']) && ($in['date'] !== $s['scheduled_date'] || norm_time($in['slot']) !== $s['time_slot'])) move_slot((int)$s['schedule_id'], $in['date'], $in['slot'], true);
        q('UPDATE installation_schedules SET status="Confirmed", technician_id=?, previous_date=NULL, previous_slot=NULL, change_reason=NULL WHERE schedule_id=?', [!empty($in['technician_id']) ? (int)$in['technician_id'] : null, $s['schedule_id']]);
    });
    $n = one('SELECT scheduled_date,time_slot FROM installation_schedules WHERE schedule_id=?', [$s['schedule_id']]);
    notify_customer((int)$i['customer_id'], 'Site visit confirmed', "Your site visit is set for {$n['scheduled_date']} at {$n['time_slot']}.", 'inquiry:' . $id);
    audit('SITE_VISIT_CONFIRMED', "inquiry #$id");
    out($n);
});
route('POST', '/admin/inquiries/{id}/site-visit/complete', ['admin'], function ($u, $id) {
    $i = one('SELECT * FROM service_inquiries WHERE inquiry_id=?', [$id]);
    $s = one('SELECT * FROM installation_schedules WHERE inquiry_id=? AND activity_type="Site Inspection" AND status="Confirmed" LIMIT 1', [$id]);
    if (!$i || !$s) fail('There is no confirmed site visit for this inquiry.', 409);
    tx(function () use ($s, $id) {
        q('UPDATE installation_schedules SET status="Completed" WHERE schedule_id=?', [$s['schedule_id']]);
        q('UPDATE service_inquiries SET site_visit_done=1, status="Accepted" WHERE inquiry_id=?', [$id]);
    });
    audit('SITE_VISIT_DONE', "inquiry #$id");
    out(['message' => 'Site visit completed. You can now create the quotation.']);
});
/* Book or move the site visit of an inquiry (Inquiry Details > Change schedule). */
route('POST', '/admin/inquiries/{id}/site-visit/schedule', ['admin'], function ($u, $id) {
    $in = input();
    $i = one('SELECT * FROM service_inquiries WHERE inquiry_id=?', [$id]);
    if (!$i) fail('Inquiry not found.', 404);
    if (!$i['needs_site_visit'] || $i['site_visit_done'] || in_array($i['status'], ['Failed', 'Completed', 'Quoted'], true)) fail('This inquiry has no open site visit.', 409);
    $date = (string)($in['date'] ?? ''); $slot = (string)($in['slot'] ?? '');
    $s = one('SELECT * FROM installation_schedules WHERE inquiry_id=? AND activity_type="Site Inspection" AND status IN ("Requested","Confirmed") ORDER BY schedule_id DESC LIMIT 1', [$id]);
    $slot = tx(function () use ($s, $id, $date, $slot) {
        if ($s) { $t = move_slot((int)$s['schedule_id'], $date, $slot, true); q('UPDATE installation_schedules SET previous_date=NULL, previous_slot=NULL, change_reason=NULL WHERE schedule_id=?', [$s['schedule_id']]); }
        else { $sid = reserve_slot(null, $id, $date, $slot, 'Site Inspection', true); $t = one('SELECT time_slot FROM installation_schedules WHERE schedule_id=?', [$sid])['time_slot']; }
        q('UPDATE service_inquiries SET preferred_visit_at=? WHERE inquiry_id=?', [date('Y-m-d H:i:s', strtotime("$date $t")), $id]);
        return $t;
    });
    if (!empty($in['notify'])) notify_customer((int)$i['customer_id'], 'Site visit schedule updated', "Your site visit is now on $date at $slot." . (($r = s($in['reason'] ?? '', 200)) !== '' ? " Reason: $r" : ''), 'inquiry:' . $id);
    audit('SITE_VISIT_SCHEDULED', "inquiry #$id -> $date $slot");
    out(['date' => $date, 'slot' => $slot]);
});

/* ============ Schedules + published availability ============ */
function admin_bookings(string $from, string $to): array {
    return all('SELECT s.schedule_id,s.quotation_id,s.inquiry_id,s.scheduled_date,s.time_slot,s.activity_type,s.status,s.notes,s.previous_date,s.previous_slot,s.change_reason,s.changed_at,
                       CONCAT(u.first_name," ",u.last_name) customer, q.project_id
                FROM installation_schedules s
                LEFT JOIN quotations q ON q.quotation_id=s.quotation_id
                LEFT JOIN service_inquiries i ON i.inquiry_id=COALESCE(s.inquiry_id,q.inquiry_id)
                LEFT JOIN customers c ON c.customer_id=i.customer_id LEFT JOIN users u ON u.user_id=c.user_id
                WHERE s.scheduled_date BETWEEN ? AND ? AND s.status IN ("Requested","Confirmed") ORDER BY s.scheduled_date,s.time_slot', [$from, $to]);
}
route('GET', '/admin/schedules', ['admin'], function () {
    $m = $_GET['month'] ?? date('Y-m');
    if (!preg_match('/^\d{4}-\d{2}$/', $m)) fail('Invalid month.');
    out(all('SELECT s.*, CONCAT(u.first_name," ",u.last_name) customer FROM installation_schedules s
             LEFT JOIN service_inquiries i ON i.inquiry_id=COALESCE(s.inquiry_id,(SELECT inquiry_id FROM quotations WHERE quotation_id=s.quotation_id))
             LEFT JOIN customers c ON c.customer_id=i.customer_id LEFT JOIN users u ON u.user_id=c.user_id
             WHERE DATE_FORMAT(s.scheduled_date,"%Y-%m")=? ORDER BY s.scheduled_date,s.time_slot', [$m]));
});
route('POST', '/admin/schedules/{id}/confirm', ['admin'], function ($u, $id) {
    $s = one('SELECT * FROM installation_schedules WHERE schedule_id=?', [$id]);
    if (!$s || $s['status'] !== 'Requested') fail('Schedule not found or already handled.', 404);
    q('UPDATE installation_schedules SET status="Confirmed", previous_date=NULL, previous_slot=NULL, change_reason=NULL WHERE schedule_id=?', [$id]);
    $c = schedule_customer($s);
    if ($c) notify_customer($c, $s['activity_type'] . ' confirmed', "Your {$s['activity_type']} on {$s['scheduled_date']} at {$s['time_slot']} is confirmed.", 'schedule:' . $id);
    audit('SCHEDULE_CONFIRMED', "#$id");
    out(['status' => 'Confirmed']);
});
route('POST', '/admin/schedules/{id}/reschedule', ['admin'], function ($u, $id) {
    $in = input();
    $s = one('SELECT * FROM installation_schedules WHERE schedule_id=? AND status IN ("Requested","Confirmed")', [$id]);
    if (!$s) fail('Schedule not found.', 404);
    $slot = tx(function () use ($id, $in, $s) {
        $slot = move_slot($id, (string)($in['date'] ?? ''), (string)($in['slot'] ?? ''), true);
        // moving a customer's reschedule request settles it: the admin's time is the confirmed one
        q('UPDATE installation_schedules SET notes=?, status=IF(previous_date IS NULL,status,"Confirmed"), previous_date=NULL, previous_slot=NULL, change_reason=NULL WHERE schedule_id=?', [s($in['note'] ?? '', 255) ?: null, $id]);
        if ($s['activity_type'] === 'Site Inspection' && $s['inquiry_id'])
            q('UPDATE service_inquiries SET preferred_visit_at=? WHERE inquiry_id=?', [date('Y-m-d H:i:s', strtotime($in['date'] . ' ' . $slot)), $s['inquiry_id']]);
        return $slot;
    });
    $c = schedule_customer($s);
    if ($c && ($in['notify'] ?? true)) notify_customer($c, 'Schedule updated', "Your {$s['activity_type']} was moved to {$in['date']} at $slot." . (($r = s($in['note'] ?? '', 200)) !== '' ? " Reason: $r" : ''), 'schedule:' . $id);
    audit('SCHEDULE_MOVED', "#$id");
    out(['message' => 'Rescheduled.', 'slot' => $slot]);
});
/* The admin publishes the open slots customers can book (Schedules tab). Booked slots are never removed. */
function set_day_slots(string $date, array $add, array $remove): void {
    need_date($date, STAFF_DATES);
    if ($date < date('Y-m-d')) fail('This date has passed, so its availability can no longer be changed.');
    foreach ($add as $t) { $n = norm_time($t); if (!$n) fail('Invalid time: ' . s($t, 20)); publish_slot($date, $n); }
    foreach ($remove as $t) {
        $n = norm_time($t); if (!$n) continue;
        if (one('SELECT 1 FROM installation_schedules WHERE scheduled_date=? AND time_slot=? AND status IN ("Requested","Confirmed")', [$date, $n])) continue;   // keep booked slots
        q('DELETE FROM schedule_availability WHERE available_date=? AND time_slot=?', [$date, $n]);
    }
}
route('POST', '/admin/availability', ['admin'], function () {
    $in = input();
    tx(fn() => set_day_slots((string)($in['date'] ?? ''), (array)($in['add'] ?? []), (array)($in['remove'] ?? [])));
    audit('AVAILABILITY_CHANGED', (string)($in['date'] ?? ''));
    out(['message' => 'Availability updated.']);
});
route('POST', '/admin/availability/bulk', ['admin'], function () {
    $in = input();
    $from = need_date($in['from'] ?? '', STAFF_DATES, 'start date'); $to = need_date($in['to'] ?? '', STAFF_DATES, 'end date');
    if ($from > $to) fail('The end date must be on or after the start date.');
    $mode = $in['mode'] ?? 'add';
    if (!in_array($mode, ['add', 'replace', 'clear'], true)) fail('Invalid action.');
    $dows = array_values(array_intersect(array_map('intval', (array)($in['dows'] ?? [])), [0, 1, 2, 3, 4, 5, 6]));
    if (!$dows) fail('Pick at least one day of the week.');
    $times = [];
    foreach ((array)($in['times'] ?? []) as $t) { $n = norm_time($t); if (!$n) fail('Invalid time: ' . s($t, 20)); $times[$n] = 1; }
    if ($mode !== 'clear' && !$times) fail('Pick at least one time slot.');
    $n = tx(function () use ($from, $to, $mode, $dows, $times) {
        $n = 0; $today = date('Y-m-d');
        for ($d = max($from, $today); $d <= $to; $d = date('Y-m-d', strtotime("$d +1 day"))) {
            if (!in_array((int)date('w', strtotime($d)), $dows, true)) continue;
            $cur = array_column(all('SELECT time_slot FROM schedule_availability WHERE available_date=?', [$d]), 'time_slot');
            set_day_slots($d, $mode === 'clear' ? [] : array_keys($times), $mode === 'add' ? [] : $cur);
            $n++;
        }
        return $n;
    });
    if (!$n) fail('No upcoming dates match that selection.');
    audit('AVAILABILITY_BULK', "$from..$to $mode ($n days)");
    out(['days' => $n]);
});

/* ============ Products (Admin "Products" tab = the catalog customers choose from) ============ */
function product_input(array $in, ?int $id): array {
    $name = preg_replace('/\s+/', ' ', s($in['name'] ?? '', 80));
    if ($name === '') fail('Enter a name for the item.');
    if (one('SELECT 1 FROM products WHERE LOWER(name)=LOWER(?) AND product_id<>?', [$name, $id ?? 0])) fail('An item with that name already exists.', 409);
    $type = $in['item_type'] ?? '';
    if (!in_array($type, ['product', 'service', 'package'], true)) fail('Choose Product, Service or Package.');
    $cat = s($in['category'] ?? '', 40);
    if ($type === 'product' && $cat === '') fail('Choose a category or enter a new one.');
    return ['name' => $name, 'item_type' => $type, 'category' => $cat !== '' ? $cat : ($type === 'service' ? 'Services' : ($type === 'package' ? 'Packages' : 'General')),
            'description' => s($in['description'] ?? '', 160) ?: null, 'supplier' => s($in['supplier'] ?? '', 60) ?: null, 'icon' => preg_replace('/[^a-z0-9\-]/', '', s($in['icon'] ?? '', 40)) ?: null];
}
function product_price($v): float {
    if (!is_numeric($v) || $v <= 0) fail('Price must be greater than zero.');
    if ($v > cfg('price_max')) fail('Price cannot exceed PHP ' . number_format((float)cfg('price_max')) . '.');
    return round((float)$v, 2);
}
function admin_products(bool $all): array {
    $rows = all('SELECT * FROM products' . ($all ? '' : ' WHERE is_active=1') . ' ORDER BY item_type,category,name');
    $hist = all('SELECT product_id, old_price, new_price, note, changed_at FROM product_price_history ORDER BY history_id DESC');
    $by = []; foreach ($hist as $h) if (count($by[$h['product_id']] ?? []) < 20) $by[$h['product_id']][] = $h;
    foreach ($rows as &$r) $r['history'] = $by[$r['product_id']] ?? [];
    return $rows;
}
route('GET', '/admin/products', ['admin', 'superadmin'], function () {   // the "add to cart" catalog, grouped by category on the front-end
    out(admin_products(!empty($_GET['all'])));
});
route('POST', '/admin/products', ['admin'], function ($u) {
    $in = input(); $f = product_input($in, null); $price = product_price($in['unit_price'] ?? null);
    q('INSERT INTO products(name,description,category,item_type,supplier,icon,unit_price,updated_at) VALUES(?,?,?,?,?,?,?,NOW())',
      [$f['name'], $f['description'], $f['category'], $f['item_type'], $f['supplier'], $f['icon'], $price]);
    $id = lastId();
    audit('PRODUCT_ADDED', $f['name']);
    out(['product_id' => $id], 201);
});
route('PUT', '/admin/products/{id}', ['admin'], function ($u, $id) {
    $in = input();
    $p = one('SELECT * FROM products WHERE product_id=?', [$id]);
    if (!$p) fail('Item not found.', 404);
    $f = product_input($in, $id);
    $price = array_key_exists('unit_price', $in) ? product_price($in['unit_price']) : (float)$p['unit_price'];
    tx(function () use ($id, $f, $price, $p, $u, $in) {
        q('UPDATE products SET name=?,description=?,category=?,item_type=?,supplier=?,icon=COALESCE(?,icon),unit_price=?,updated_at=NOW() WHERE product_id=?',
          [$f['name'], $f['description'], $f['category'], $f['item_type'], $f['supplier'], $f['icon'], $price, $id]);
        if (abs($price - (float)$p['unit_price']) > 0.001)
            q('INSERT INTO product_price_history(product_id,old_price,new_price,note,changed_by) VALUES(?,?,?,?,?)', [$id, $p['unit_price'], $price, s($in['note'] ?? '', 120) ?: null, $u['id']]);
    });
    audit('PRODUCT_EDITED', $f['name']);
    out(['message' => 'Item updated.']);
});
/* Price change only. Existing quotations keep the price each line was created with. */
route('POST', '/admin/products/{id}/price', ['admin'], function ($u, $id) {
    $in = input();
    $p = one('SELECT * FROM products WHERE product_id=?', [$id]);
    if (!$p) fail('Item not found.', 404);
    $price = product_price($in['unit_price'] ?? null);
    if (abs($price - (float)$p['unit_price']) < 0.001) fail('The price is unchanged.');
    tx(function () use ($id, $p, $price, $u, $in) {
        q('UPDATE products SET unit_price=?, updated_at=NOW() WHERE product_id=?', [$price, $id]);
        q('INSERT INTO product_price_history(product_id,old_price,new_price,note,changed_by) VALUES(?,?,?,?,?)', [$id, $p['unit_price'], $price, s($in['note'] ?? '', 120) ?: null, $u['id']]);
    });
    audit('PRODUCT_PRICE', "{$p['name']}: {$p['unit_price']} -> $price");
    out(['unit_price' => $price]);
});
/* Archive hides the item from the quotation builder and from customers; restore brings it back. */
route('POST', '/admin/products/{id}/archive', ['admin'], function ($u, $id) {
    $p = one('SELECT name FROM products WHERE product_id=?', [$id]);
    if (!$p) fail('Item not found.', 404);
    $arch = filter_var(input()['archived'] ?? true, FILTER_VALIDATE_BOOLEAN);
    q('UPDATE products SET is_active=?, updated_at=NOW() WHERE product_id=?', [$arch ? 0 : 1, $id]);
    audit($arch ? 'PRODUCT_ARCHIVED' : 'PRODUCT_RESTORED', $p['name']);
    out(['is_active' => $arch ? 0 : 1]);
});
/* Permanent delete is only allowed while no inquiry or quotation uses the item (keeps their history intact). */
route('DELETE', '/admin/products/{id}', ['admin'], function ($u, $id) {
    $p = one('SELECT name FROM products WHERE product_id=?', [$id]);
    if (!$p) fail('Item not found.', 404);
    if (one('SELECT 1 FROM quotation_items WHERE product_id=? UNION SELECT 1 FROM inquiry_items WHERE product_id=? LIMIT 1', [$id, $id]))
        fail('This item is used by existing inquiries or quotations, so it cannot be deleted. Archive it instead.', 409);
    q('DELETE FROM products WHERE product_id=?', [$id]);
    audit('PRODUCT_DELETED', $p['name']);
    out(['message' => 'Item deleted.']);
});

/* ============ Quotations ============ */
route('GET', '/admin/quotations', ['admin'], function () {
    $w = []; $p = [];
    if (($st = $_GET['status'] ?? 'all') !== 'all') { $w[] = 'q.status=?'; $p[] = $st; }
    if (($t = s($_GET['q'] ?? '', 80)) !== '') { $w[] = '(q.quotation_no LIKE ? OR CONCAT(u.first_name," ",u.last_name) LIKE ?)'; array_push($p, like($t), like($t)); }
    out(all('SELECT q.quotation_id,q.quotation_no,q.inquiry_id,q.total_amount,q.status,q.payment_status,q.date_created,q.expiry_date,q.superadmin_comment, CONCAT(u.first_name," ",u.last_name) customer
             FROM quotations q JOIN customers c USING(customer_id) JOIN users u ON u.user_id=c.user_id' . ($w ? ' WHERE ' . implode(' AND ', $w) : '') . ' ORDER BY q.quotation_id DESC LIMIT 300', $p));
});
route('GET', '/admin/quotations/{id}', ['admin', 'superadmin'], function ($u, $id) {
    $q = quote_detail($id);
    $q ? out($q) : fail('Quotation not found.', 404);
});
function quote_body(array $in): array {
    // older clients send no labor fields at all: that means "no labor"
    $noLabor = array_key_exists('no_labor', $in) ? filter_var($in['no_labor'], FILTER_VALIDATE_BOOLEAN) : empty($in['labor']);
    return quote_calc((array)($in['items'] ?? []), (array)($in['charges'] ?? []), (array)($in['labor'] ?? []), $noLabor) + [7 => $noLabor];
}
route('POST', '/admin/quotations', ['admin'], function ($u) {
    $in = input();
    $iid = (int)($in['inquiry_id'] ?? 0);
    $i = one('SELECT * FROM service_inquiries WHERE inquiry_id=?', [$iid]);
    if (!$i) fail('Inquiry not found.', 404);
    if ($i['needs_site_visit'] && !$i['site_visit_done']) fail('A site visit is required first. A quotation cannot be made yet.', 409);   // rule 4.b
    if ($i['status'] !== 'Accepted') fail('Accept the inquiry first.', 409);
    if (one('SELECT 1 FROM quotations WHERE inquiry_id=? AND status IN ("Draft","Pending Superadmin","Sent to Customer","Approved","Revision Requested")', [$iid])) fail('This inquiry already has an active quotation.', 409);
    [$lines, $ch, $sub, $ct, $lab, $lt, $vat, $noLabor] = quote_body($in);
    $f = quote_fields($in);
    $exp = quote_expiry($in['expiry_date'] ?? null);
    $send = !empty($in['submit']);
    $qid = tx(function () use ($u, $i, $iid, $lines, $ch, $sub, $ct, $lab, $lt, $vat, $noLabor, $f, $exp, $send) {
        q('INSERT INTO quotations(inquiry_id,customer_id,subtotal,other_charges_total,labor_total,vat_amount,total_amount,no_labor,notes,scope_of_work,project_title,duration,site_address,project_incharge,payment_terms,created_by,expiry_date,status)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [$iid, $i['customer_id'], $sub, $ct, $lt, $vat, round($sub + $ct + $lt + $vat, 2), (int)$noLabor, $f['notes'], $f['scope_of_work'], $f['project_title'], $f['duration'], $f['site_address'], $f['project_incharge'], $f['payment_terms'], $u['id'], $exp,
           $send ? 'Pending Superadmin' : 'Draft']);
        $qid = lastId();
        q('UPDATE quotations SET quotation_no=? WHERE quotation_id=?', ['Q-' . date('Y') . '-' . str_pad((string)$qid, 5, '0', STR_PAD_LEFT), $qid]);
        quote_write($qid, $lines, $ch, $lab);
        quote_event($qid, 'Draft created');
        if ($send) quote_event($qid, 'Sent to superadmin');
        return $qid;
    });
    if ($send) notify_role('superadmin', 'Quotation for approval', one('SELECT quotation_no FROM quotations WHERE quotation_id=?', [$qid])['quotation_no'] . ' is waiting for your approval.', 'quotation:' . $qid);
    audit('QUOTATION_CREATED', "#$qid");
    out(quote_detail($qid), 201);
});
/* Drafts, revision requests and quotations still waiting for the superadmin can be edited. */
route('PUT', '/admin/quotations/{id}', ['admin'], function ($u, $id) {
    $in = input();
    $q = one('SELECT * FROM quotations WHERE quotation_id=?', [$id]);
    if (!$q) fail('Quotation not found.', 404);
    if (!in_array($q['status'], ['Draft', 'Revision Requested', 'Pending Superadmin'], true)) fail('Only drafts, revision requests and quotations awaiting the superadmin can be edited.', 409);
    [$lines, $ch, $sub, $ct, $lab, $lt, $vat, $noLabor] = quote_body($in);
    $f = quote_fields($in, $q);
    tx(function () use ($id, $q, $lines, $ch, $sub, $ct, $lab, $lt, $vat, $noLabor, $f, $in, $u) {
        q('UPDATE quotations SET subtotal=?,other_charges_total=?,labor_total=?,vat_amount=?,total_amount=?,no_labor=?,notes=?,scope_of_work=?,project_title=?,duration=?,site_address=?,project_incharge=?,payment_terms=?,expiry_date=?,pdf_path=NULL WHERE quotation_id=?',
          [$sub, $ct, $lt, $vat, round($sub + $ct + $lt + $vat, 2), (int)$noLabor, $f['notes'], $f['scope_of_work'], $f['project_title'], $f['duration'], $f['site_address'], $f['project_incharge'], $f['payment_terms'],
           quote_expiry($in['expiry_date'] ?? ($q['expiry_date'] >= date('Y-m-d', strtotime('+1 day')) ? $q['expiry_date'] : null)), $id]);
        quote_write($id, $lines, $ch, $lab);
        q('INSERT INTO quotation_revisions(quotation_id,adjusted_amount,revised_validity,scope_notes,revised_by) VALUES(?,?,?,?,?)', [$id, round($sub + $ct + $lt + $vat, 2), $q['expiry_date'], s($in['revision_note'] ?? '', 1000) ?: null, $u['id']]);
        quote_event($id, 'Quotation edited');
    });
    audit('QUOTATION_EDITED', "#$id");
    out(quote_detail($id));
});
/* 4.a / 5 / 6.b.1  send to super admin */
route('POST', '/admin/quotations/{id}/submit', ['admin'], function ($u, $id) {
    $q = one('SELECT * FROM quotations WHERE quotation_id=?', [$id]);
    if (!$q) fail('Quotation not found.', 404);
    if (!in_array($q['status'], ['Draft', 'Revision Requested'], true)) fail('This quotation cannot be submitted.', 409);
    if ($q['total_amount'] <= 0) fail('Quotation total must be greater than zero.');
    q('UPDATE quotations SET status="Pending Superadmin", superadmin_comment=NULL WHERE quotation_id=?', [$id]);
    quote_event($id, 'Sent to superadmin');
    notify_role('superadmin', 'Quotation for approval', "{$q['quotation_no']} is waiting for your approval.", 'quotation:' . $id);
    audit('QUOTATION_SUBMITTED', $q['quotation_no']);
    out(['status' => 'Pending Superadmin']);
});
/* The admin records that a quotation was declined (for example by phone). */
route('POST', '/admin/quotations/{id}/decline', ['admin'], function ($u, $id) {
    $q = one('SELECT * FROM quotations WHERE quotation_id=?', [$id]);
    if (!$q) fail('Quotation not found.', 404);
    if (!in_array($q['status'], ['Pending Superadmin', 'Sent to Customer'], true)) fail('Only quotations awaiting the superadmin or the customer can be marked as declined.', 409);
    q('UPDATE quotations SET status="Declined" WHERE quotation_id=?', [$id]);
    quote_event($id, 'Marked as declined by admin');
    if ($q['status'] === 'Sent to Customer') notify_customer((int)$q['customer_id'], 'Quotation closed', "Quotation {$q['quotation_no']} was closed as declined.", 'quotation:' . $id);
    audit('QUOTATION_DECLINED_ADMIN', $q['quotation_no']);
    out(['status' => 'Declined']);
});
route('DELETE', '/admin/quotations/{id}', ['admin'], function ($u, $id) {
    $q = one('SELECT * FROM quotations WHERE quotation_id=?', [$id]);
    if (!$q) fail('Quotation not found.', 404);
    if ($q['status'] !== 'Draft' || $q['project_id']) fail('Only drafts can be deleted.', 409);
    q('DELETE FROM quotations WHERE quotation_id=?', [$id]);
    audit('QUOTATION_DELETED', $q['quotation_no']);
    out(['message' => 'Draft deleted.']);
});
/* The front-end generates the templated PDF (html2pdf) and uploads the blob here. */
route('POST', '/admin/quotations/{id}/pdf', ['admin', 'superadmin'], function ($u, $id) {
    $q = one('SELECT * FROM quotations WHERE quotation_id=?', [$id]);
    if (!$q) fail('Quotation not found.', 404);
    $path = save_upload('pdf', PDFM, 'quotations');
    q('UPDATE quotations SET pdf_path=? WHERE quotation_id=?', [$path, $id]);
    publish_quote_doc($id);
    out(['message' => 'PDF saved.']);
});
route('GET', '/admin/quotations/{id}/pdf', ['admin', 'superadmin'], function ($u, $id) {
    $q = one('SELECT quotation_no,pdf_path FROM quotations WHERE quotation_id=?', [$id]);
    if (!$q || !$q['pdf_path']) fail('No PDF yet.', 404);
    stream_file($q['pdf_path'], $q['quotation_no'] . '.pdf');
});

/* ============ Payments (step 7) ============ */
route('GET', '/admin/payments', ['admin'], function () {
    $w = []; $p = [];
    if (($st = $_GET['status'] ?? 'all') !== 'all') { $w[] = 'p.status=?'; $p[] = $st; }
    out(all('SELECT p.payment_id,p.quotation_id,q.quotation_no,p.installment,p.amount_due,p.amount_paid,p.payment_method,p.payment_agreement,p.status,p.reference_no,p.proof_of_payment_url IS NOT NULL has_proof,p.transaction_date, CONCAT(u.first_name," ",u.last_name) customer
             FROM payments p JOIN quotations q USING(quotation_id) JOIN customers c ON c.customer_id=p.customer_id JOIN users u ON u.user_id=c.user_id' . ($w ? ' WHERE ' . implode(' AND ', $w) : '') . ' ORDER BY p.payment_id DESC LIMIT 300', $p));
});
route('GET', '/admin/payments/{id}/proof', ['admin', 'superadmin'], function ($u, $id) {
    $p = one('SELECT proof_of_payment_url FROM payments WHERE payment_id=?', [$id]);
    if (!$p || !$p['proof_of_payment_url']) fail('No proof uploaded.', 404);
    stream_file($p['proof_of_payment_url'], "proof-$id");
});
/* 7.b / 8.b.1 confirm (online: after checking the screenshot; over-the-counter: after receiving cash) */
route('POST', '/admin/payments/{id}/confirm', ['admin'], function ($u, $id) {
    $in = input();
    $p = one('SELECT p.*, q.project_id, q.quotation_no FROM payments p JOIN quotations q USING(quotation_id) WHERE p.payment_id=?', [$id]);
    if (!$p) fail('Payment not found.', 404);
    if (!in_array($p['status'], ['Awaiting Payment', 'Under Review'], true)) fail('This payment cannot be confirmed right now.', 409);
    if ($p['payment_method'] === 'Online' && !$p['proof_of_payment_url']) fail('The customer has not uploaded a proof of payment yet.', 409);
    if (isset($in['amount']) && abs((float)$in['amount'] - (float)$p['amount_due']) > 0.009)   // cash: the amount received must match this installment
        fail('The amount received must be exactly PHP ' . number_format((float)$p['amount_due'], 2) . ' for this payment.');
    tx(function () use ($p, $id, $u) {
        q('UPDATE payments SET status="Confirmed", amount_paid=amount_due, confirmed_by=?, confirmed_at=NOW(), transaction_date=COALESCE(transaction_date,NOW()) WHERE payment_id=?', [$u['id'], $id]);
        q('INSERT INTO receipts(payment_id,receipt_no,issued_by) VALUES(?,?,?)', [$id, 'OR-' . date('Y') . '-' . str_pad((string)$id, 5, '0', STR_PAD_LEFT), $u['id']]);
        refresh_payment_status((int)$p['quotation_id']);
        $pr = one('SELECT * FROM projects WHERE project_id=?', [$p['project_id']]);
        if (in_array($pr['status'], ['Awaiting Payment', 'Payment Under Review'], true)) {
            set_project((int)$pr['project_id'], 'Installation In Progress');
            q('UPDATE installation_schedules SET status="Confirmed" WHERE quotation_id=? AND activity_type="Installation" AND status="Requested"', [$p['quotation_id']]);
        } elseif ($pr['status'] === 'Awaiting Final Payment' && !one('SELECT 1 FROM payments WHERE quotation_id=? AND status<>"Confirmed"', [$p['quotation_id']])) {
            finish_project((int)$pr['project_id']);
        }
    });
    notify_customer((int)$p['customer_id'], 'Payment confirmed', "Your {$p['installment']} for {$p['quotation_no']} was confirmed. Your receipt is being prepared.", 'project:' . $p['project_id']);
    audit('PAYMENT_CONFIRMED', "#$id");
    out(['receipt' => receipt_data($id)]);   // feed this into the receipt template
});
route('POST', '/admin/payments/{id}/reject', ['admin'], function ($u, $id) {
    $p = one('SELECT p.*, q.project_id FROM payments p JOIN quotations q USING(quotation_id) WHERE p.payment_id=?', [$id]);
    if (!$p || !in_array($p['status'], ['Under Review', 'Awaiting Payment'], true)) fail('This payment cannot be rejected.', 409);
    $reason = s(input()['reason'] ?? '', 255);
    if ($reason === '') fail('Please give a reason.');
    q('UPDATE payments SET status="Rejected", reject_reason=? WHERE payment_id=?', [$reason, $id]);
    if ($p['project_id']) q('UPDATE projects SET status="Awaiting Payment" WHERE project_id=? AND status="Payment Under Review"', [$p['project_id']]);
    notify_customer((int)$p['customer_id'], 'Payment proof rejected', "Please upload a clearer proof. Reason: $reason", $p['project_id'] ? 'project:' . $p['project_id'] : null);
    audit('PAYMENT_REJECTED', "#$id");
    out(['status' => 'Rejected']);
});
route('GET', '/admin/receipts/{id}', ['admin'], function ($u, $id) {   // {id} = payment_id
    $r = receipt_data($id);
    $r ? out($r) : fail('No receipt for this payment.', 404);
});
route('POST', '/admin/receipts/{id}/pdf', ['admin'], function ($u, $id) {
    $r = one('SELECT r.*, p.quotation_id, p.customer_id, q.inquiry_id FROM receipts r JOIN payments p USING(payment_id) JOIN quotations q ON q.quotation_id=p.quotation_id WHERE r.payment_id=?', [$id]);
    if (!$r) fail('Receipt not found.', 404);
    $path = save_upload('pdf', PDFM, 'receipts');
    q('UPDATE receipts SET file_path=?, sent_at=COALESCE(sent_at,NOW()) WHERE payment_id=?', [$path, $id]);
    add_doc((int)$r['customer_id'], (int)$r['inquiry_id'], 'Receipt', 'Receipt ' . $r['receipt_no'], $path, (int)$r['quotation_id'], $id);
    notify_customer((int)$r['customer_id'], 'Receipt available', 'Receipt ' . $r['receipt_no'] . ' is now in your Documents.', 'documents');
    out(['message' => 'Receipt saved.']);
});
/* "Send to customer": the receipt appears in the customer's Documents. */
route('POST', '/admin/receipts/{id}/send', ['admin'], function ($u, $id) {
    $r = one('SELECT r.*, p.customer_id FROM receipts r JOIN payments p USING(payment_id) WHERE r.payment_id=?', [$id]);
    if (!$r) fail('Receipt not found.', 404);
    q('UPDATE receipts SET sent_at=NOW() WHERE payment_id=?', [$id]);
    notify_customer((int)$r['customer_id'], 'Receipt available', 'Acknowledgement receipt ' . $r['receipt_no'] . ' is now in your Documents.', 'documents');
    audit('RECEIPT_SENT', $r['receipt_no']);
    out(['sent_at' => date('Y-m-d H:i:s')]);
});

/* ============ Projects / installation (steps 8-9) ============ */
route('GET', '/admin/projects', ['admin', 'superadmin'], function () {
    $w = []; $p = [];
    if (($st = $_GET['status'] ?? 'all') !== 'all') { $w[] = 'p.status=?'; $p[] = $st; }
    if (($ty = $_GET['type'] ?? 'all') !== 'all') { $w[] = 'i.place_type=?'; $p[] = $ty; }
    if (($t = s($_GET['q'] ?? '', 80)) !== '') { $w[] = '(p.project_name LIKE ? OR CONCAT(u.first_name," ",u.last_name) LIKE ? OR p.project_id LIKE ?)'; array_push($p, like($t), like($t), like($t)); }
    out(all('SELECT p.project_id,p.project_name,p.project_lead,p.status,p.install_status,p.start_date,p.end_date,p.created_at,i.place_type,q.quotation_no,q.total_amount,q.payment_status, CONCAT(u.first_name," ",u.last_name) customer
             FROM projects p LEFT JOIN service_inquiries i USING(inquiry_id) LEFT JOIN quotations q ON q.project_id=p.project_id JOIN customers c ON c.customer_id=p.customer_id JOIN users u ON u.user_id=c.user_id'
             . ($w ? ' WHERE ' . implode(' AND ', $w) : '') . ' ORDER BY p.project_id DESC LIMIT 300', $p));
});
route('GET', '/admin/projects/{id}', ['admin', 'superadmin'], function ($u, $id) {
    $pr = one('SELECT * FROM projects WHERE project_id=?', [$id]);
    if (!$pr) fail('Project not found.', 404);
    $q = one('SELECT quotation_id FROM quotations WHERE project_id=?', [$id]);
    $pr['quotation'] = $q ? quote_detail((int)$q['quotation_id']) : null;
    $pr['schedules'] = $q ? all('SELECT * FROM installation_schedules WHERE quotation_id=? ORDER BY schedule_id', [$q['quotation_id']]) : [];
    $pr['updates'] = all('SELECT pu.note, pu.created_at, CONCAT(u.first_name," ",u.last_name) by_name FROM project_updates pu JOIN users u ON u.user_id=pu.created_by WHERE pu.project_id=? ORDER BY pu.update_id DESC', [$id]);
    out($pr);
});
function project_or_fail(int $id): array {
    $pr = one('SELECT p.*, q.quotation_id, q.total_amount, i.place_type FROM projects p JOIN quotations q ON q.project_id=p.project_id LEFT JOIN service_inquiries i ON i.inquiry_id=p.inquiry_id WHERE p.project_id=?', [$id]);
    if (!$pr) fail('Project not found.', 404);
    return $pr;
}
/* Checklist, progress note and project lead. */
route('POST', '/admin/projects/{id}/update', ['admin'], function ($u, $id) {
    $in = input();
    $pr = one('SELECT * FROM projects WHERE project_id=?', [$id]);
    if (!$pr) fail('Project not found.', 404);
    if (($note = s($in['note'] ?? '', 2000)) !== '') q('INSERT INTO project_updates(project_id,note,created_by) VALUES(?,?,?)', [$id, $note, $u['id']]);
    if (isset($in['project_lead'])) q('UPDATE projects SET project_lead=? WHERE project_id=?', [s($in['project_lead'], 100) ?: null, $id]);
    if (isset($in['checklist'])) {
        if ($pr['install_status'] !== 'In progress') fail('The checklist can be updated while the installation is in progress.', 409);
        $list = [];
        foreach (array_slice((array)$in['checklist'], 0, 20) as $c) {
            $st = $c['state'] ?? '';
            if (!in_array($st, ['Pending', 'In progress', 'Done'], true)) fail('Invalid checklist state.');
            $list[] = ['label' => s($c['label'] ?? '', 80), 'state' => $st];
        }
        q('UPDATE projects SET checklist=? WHERE project_id=?', [json_encode($list, JSON_UNESCAPED_UNICODE), $id]);
    }
    out(['message' => 'Progress updated.']);
});
/* Payment agreement / method can change until a proof has been submitted or a payment confirmed. */
route('POST', '/admin/projects/{id}/terms', ['admin'], function ($u, $id) {
    $in = input();
    $pr = project_or_fail($id);
    $pays = all('SELECT * FROM payments WHERE quotation_id=?', [$pr['quotation_id']]);
    if (array_filter($pays, fn($p) => $p['status'] === 'Confirmed' || $p['proof_of_payment_url'])) fail('The payment terms are locked after a proof is submitted or a payment is confirmed.', 409);
    $agr = $in['payment_agreement'] ?? ($pays[0]['payment_agreement'] ?? '');
    $method = $in['payment_method'] ?? ($pays[0]['payment_method'] ?? 'Online');
    $allowed = ($pr['place_type'] ?? 'Residential') === 'Residential' ? ['Half upon quotation', 'Full upon quotation', 'Full after installation'] : ['Half upon quotation', 'Full upon quotation'];
    if (!in_array($agr, $allowed, true)) fail('Full Payment After Installation is for residential customers only.');
    if (!in_array($method, ['Online', 'Over the counter'], true)) fail('Choose Online or Over the counter.');
    tx(function () use ($pr, $agr, $method) {
        q('DELETE FROM payments WHERE quotation_id=?', [$pr['quotation_id']]);
        create_payments((int)$pr['quotation_id'], (int)$pr['customer_id'], (float)$pr['total_amount'], $agr, $method);
        q('UPDATE quotation_approvals SET payment_agreement=?, payment_method=? WHERE quotation_id=?', [$agr, $method, $pr['quotation_id']]);
        if (in_array($pr['status'], ['Awaiting Payment', 'Payment Under Review', 'Installation In Progress'], true) && $pr['install_status'] !== 'In progress' && $pr['install_status'] !== 'Completed')
            set_project((int)$pr['project_id'], $agr === 'Full after installation' ? 'Installation In Progress' : 'Awaiting Payment');
    });
    notify_customer((int)$pr['customer_id'], 'Payment terms updated', "Your payment terms are now: $agr ($method).", 'project:' . $id);
    audit('PROJECT_TERMS', "project #$id -> $agr / $method");
    out(['message' => 'Payment terms updated.']);
});
/* Book or move the installation (Installation > SCHEDULED). */
route('POST', '/admin/projects/{id}/schedule', ['admin'], function ($u, $id) {
    $in = input();
    $pr = project_or_fail($id);
    if ($pr['status'] === 'Done' || $pr['install_status'] === 'Completed') fail('The installation is already completed.', 409);
    if ($pr['install_status'] === 'In progress') fail('The installation is already in progress.', 409);
    $date = (string)($in['date'] ?? ''); $slot = (string)($in['slot'] ?? '');
    $s = one('SELECT * FROM installation_schedules WHERE quotation_id=? AND activity_type="Installation" AND status IN ("Requested","Confirmed") ORDER BY schedule_id DESC LIMIT 1', [$pr['quotation_id']]);
    $slot = tx(function () use ($s, $pr, $date, $slot, $id) {
        if ($s) { $t = move_slot((int)$s['schedule_id'], $date, $slot, true); q('UPDATE installation_schedules SET previous_date=NULL, previous_slot=NULL, change_reason=NULL WHERE schedule_id=?', [$s['schedule_id']]); }
        else { $sid = reserve_slot((int)$pr['quotation_id'], (int)$pr['inquiry_id'], $date, $slot, 'Installation', true); $t = one('SELECT time_slot FROM installation_schedules WHERE schedule_id=?', [$sid])['time_slot']; }
        q('UPDATE projects SET install_status="Scheduled", start_date=? WHERE project_id=?', [$date, $id]);
        return $t;
    });
    if ($in['notify'] ?? true) notify_customer((int)$pr['customer_id'], 'Installation scheduled', "Your installation is set for $date at $slot.", 'project:' . $id);
    audit('INSTALL_SCHEDULED', "project #$id -> $date $slot");
    out(['date' => $date, 'slot' => $slot]);
});
/* Installation > IN PROGRESS (on the day). COMPLETED uses installation-complete below. */
route('POST', '/admin/projects/{id}/install', ['admin'], function ($u, $id) {
    $pr = project_or_fail($id);
    if ((input()['status'] ?? '') !== 'In progress') fail('Invalid installation status.');
    if ($pr['status'] !== 'Installation In Progress') fail('Installation unlocks once the payment is approved.', 409);
    if ($pr['install_status'] !== 'Scheduled') fail('Schedule the installation first.', 409);
    $list = json_decode((string)$pr['checklist'], true);
    if (!$list) $list = array_map(fn($l) => ['label' => $l, 'state' => 'Pending'], ['Site preparation', 'Equipment mounting', 'Cabling & PoE', 'Recorder setup & configuration', 'Testing & customer handover']);
    if (!array_filter($list, fn($c) => $c['state'] !== 'Pending')) $list[0]['state'] = 'In progress';
    q('UPDATE projects SET install_status="In progress", start_date=CURDATE(), checklist=? WHERE project_id=?', [json_encode($list, JSON_UNESCAPED_UNICODE), $id]);
    notify_customer((int)$pr['customer_id'], 'Installation started', 'Our team has started your installation.', 'project:' . $id);
    audit('INSTALL_STARTED', "project #$id");
    out(['install_status' => 'In progress']);
});
/* 8/9: installation finished. Unpaid balance -> back to payment (phase 7); nothing owed -> Done. */
route('POST', '/admin/projects/{id}/installation-complete', ['admin'], function ($u, $id) {
    $pr = one('SELECT * FROM projects WHERE project_id=?', [$id]);
    if (!$pr) fail('Project not found.', 404);
    if ($pr['status'] !== 'Installation In Progress') fail('The project is not in installation.', 409);
    $q = one('SELECT * FROM quotations WHERE project_id=?', [$id]);
    $state = tx(function () use ($q, $pr, $id) {
        $list = json_decode((string)$pr['checklist'], true) ?: [];
        foreach ($list as &$c) $c['state'] = 'Done';
        q('UPDATE projects SET install_status="Completed", end_date=CURDATE(), checklist=? WHERE project_id=?', [$list ? json_encode($list, JSON_UNESCAPED_UNICODE) : null, $id]);
        q('UPDATE installation_schedules SET status="Completed" WHERE quotation_id=? AND activity_type="Installation" AND status IN ("Requested","Confirmed")', [$q['quotation_id']]);
        $due = q('UPDATE payments SET status="Awaiting Payment" WHERE quotation_id=? AND status="Not Due"', [$q['quotation_id']])->rowCount();
        if ($due > 0) { set_project($id, 'Awaiting Final Payment'); return 'Awaiting Final Payment'; }
        if (one('SELECT 1 FROM payments WHERE quotation_id=? AND status<>"Confirmed"', [$q['quotation_id']])) return 'Installation In Progress'; // an earlier payment is still being reviewed
        finish_project($id); return 'Done';
    });
    if ($state === 'Awaiting Final Payment') {
        $d = one('SELECT SUM(amount_due) s FROM payments WHERE quotation_id=? AND status="Awaiting Payment"', [$q['quotation_id']]);
        notify_customer((int)$pr['customer_id'], 'Installation complete', 'Your installation is complete. Remaining balance: PHP ' . number_format((float)$d['s'], 2) . '.', 'project:' . $id);
    }
    audit('INSTALLATION_COMPLETE', "project #$id -> $state");
    out(['status' => $state]);
});

/* ---------- Certificate of installation + accomplishment report ---------- */
const CERT_FIELDS = ['system' => 40, 'title' => 160, 'work' => 160, 'location' => 160, 'manager' => 80, 'team' => 160, 'contractor' => 80, 'residence' => 160, 'overview' => 1500, 'scope' => 1500];
route('GET', '/admin/projects/{id}/certificate', ['admin', 'superadmin'], function ($u, $id) {
    $c = one('SELECT data,sent_at FROM project_certificates WHERE project_id=?', [$id]);
    out(['data' => $c ? json_decode($c['data'], true) : null, 'sent_at' => $c['sent_at'] ?? null,
         'photos' => all('SELECT photo_id,caption FROM certificate_photos WHERE project_id=? ORDER BY photo_id', [$id])]);
});
route('PUT', '/admin/projects/{id}/certificate', ['admin'], function ($u, $id) {
    $in = input();
    $pr = project_or_fail($id);
    if ($pr['install_status'] !== 'Completed') fail('The certificate is available once installation is completed.', 409);
    $d = [];
    foreach (CERT_FIELDS as $k => $max) $d[$k] = s($in[$k] ?? '', $max);
    foreach (['start', 'end'] as $k) $d[$k] = ($in[$k] ?? '') === '' ? '' : need_date($in[$k], STAFF_DATES, $k === 'start' ? 'start date' : 'end date');
    if ($d['start'] && $d['end'] && $d['start'] > $d['end']) fail('The end date must be on or after the start date.');
    q('INSERT INTO project_certificates(project_id,data) VALUES(?,?) ON DUPLICATE KEY UPDATE data=VALUES(data)', [$id, json_encode($d, JSON_UNESCAPED_UNICODE)]);
    foreach ((array)($in['captions'] ?? []) as $pid => $cap) q('UPDATE certificate_photos SET caption=? WHERE photo_id=? AND project_id=?', [s($cap, 60) ?: null, (int)$pid, $id]);
    out(['message' => 'Saved.']);
});
route('POST', '/admin/projects/{id}/certificate/photos', ['admin'], function ($u, $id) {
    $pr = project_or_fail($id);
    if ($pr['install_status'] !== 'Completed') fail('Photos can be added once installation is completed.', 409);
    if ((int)one('SELECT COUNT(*) n FROM certificate_photos WHERE project_id=?', [$id])['n'] >= (int)cfg('cert_photos_max')) fail('Up to ' . cfg('cert_photos_max') . ' photos per certificate.', 409);
    $path = save_upload('photo', IMG, 'certificates');
    q('INSERT INTO certificate_photos(project_id,file_path,caption) VALUES(?,?,?)', [$id, $path, s($_POST['caption'] ?? '', 60) ?: null]);
    out(['photo_id' => lastId()], 201);
});
route('DELETE', '/admin/projects/{id}/certificate/photos/{pid}', ['admin'], function ($u, $id, $pid) {
    q('DELETE FROM certificate_photos WHERE photo_id=? AND project_id=?', [$pid, $id]);
    out(['message' => 'Photo removed.']);
});
route('GET', '/admin/projects/{id}/certificate/photos/{pid}', ['admin', 'superadmin'], function ($u, $id, $pid) {
    $p = one('SELECT file_path FROM certificate_photos WHERE photo_id=? AND project_id=?', [$pid, $id]);
    if (!$p) fail('Photo not found.', 404);
    stream_file($p['file_path'], "photo-$pid");
});
route('POST', '/admin/projects/{id}/certificate/send', ['admin'], function ($u, $id) {
    $pr = project_or_fail($id);
    if (!one('SELECT 1 FROM project_certificates WHERE project_id=?', [$id])) fail('Prepare the certificate first.', 409);
    if (!one('SELECT 1 FROM certificate_photos WHERE project_id=?', [$id])) fail('Add at least one installation photo before sending.', 409);
    q('UPDATE project_certificates SET sent_at=NOW() WHERE project_id=?', [$id]);
    notify_customer((int)$pr['customer_id'], 'Installation certificate available', 'Your installation certificate and accomplishment report are now in your Documents.', 'documents');
    audit('CERTIFICATE_SENT', "project #$id");
    out(['sent_at' => date('Y-m-d H:i:s')]);
});

/* ============ Project documents: Memorandum of Agreement and Job Order ============
   The admin page builds the PDF from the same template shown on screen and uploads it here.
   The file is saved on the server and listed in the customer's Documents. Sending again replaces the earlier copy. */
function project_doc_names(): array { return ['moa' => 'Memorandum of Agreement', 'jo' => 'Job Order']; }
route('POST', '/admin/projects/{id}/documents', ['admin'], function ($u, $id) {
    $pr = project_or_fail($id);
    $names = project_doc_names(); $kind = (string)($_POST['kind'] ?? '');
    if (!isset($names[$kind])) fail('Unknown document.');
    $path = save_upload('pdf', PDFM, 'project-documents');
    $title = mb_substr($names[$kind] . ' - ' . $pr['project_name'], 0, 120);
    $inq = $pr['inquiry_id'] ? (int)$pr['inquiry_id'] : null;
    tx(function () use ($pr, $inq, $names, $kind, $title, $path) {
        q('DELETE FROM customer_documents WHERE customer_id=? AND inquiry_id<=>? AND document_type="Other" AND title LIKE ?', [$pr['customer_id'], $inq, $names[$kind] . ' - %']);
        add_doc((int)$pr['customer_id'], $inq, 'Other', $title, $path, (int)$pr['quotation_id']);
    });
    notify_customer((int)$pr['customer_id'], $names[$kind] . ' available', 'Your ' . strtolower($names[$kind]) . ' is now in your Documents.', 'documents');
    audit('DOCUMENT_SENT', $names[$kind] . " for project #$id");
    out(['sent_at' => date('Y-m-d H:i:s')]);
});

/* ============ Everything the admin page needs, in one call ============ */
route('GET', '/admin/state', ['admin'], function () {
    $inq = all('SELECT i.*, CONCAT(u.first_name," ",u.last_name) customer, u.email, u.phone_number, c.contact_name, c.contact_role, c.contact_email, c.contact_phone,
                       s.schedule_id visit_schedule_id, s.scheduled_date visit_date, s.time_slot visit_slot, s.status visit_status,
                       (SELECT q.quotation_id FROM quotations q WHERE q.inquiry_id=i.inquiry_id AND q.status<>"Declined" ORDER BY q.quotation_id DESC LIMIT 1) quotation_id
                FROM service_inquiries i JOIN customers c USING(customer_id) JOIN users u ON u.user_id=c.user_id
                LEFT JOIN installation_schedules s ON s.schedule_id=(SELECT MAX(x.schedule_id) FROM installation_schedules x WHERE x.inquiry_id=i.inquiry_id AND x.activity_type="Site Inspection" AND x.status<>"Cancelled")
                ORDER BY i.inquiry_id DESC LIMIT 500');
    $items = all('SELECT ii.inquiry_id, p.product_id, p.name, p.item_type, p.description, p.category, p.unit_price, ii.quantity FROM inquiry_items ii JOIN products p USING(product_id)');
    $by = []; foreach ($items as $it) $by[$it['inquiry_id']][] = $it;
    foreach ($inq as &$i) $i['items'] = $by[$i['inquiry_id']] ?? [];
    unset($i);

    $quotes = all('SELECT q.*, CONCAT(u.first_name," ",u.last_name) customer, u.email, i.place_type, i.purchase_option, i.installation_address
                   FROM quotations q JOIN customers c ON c.customer_id=q.customer_id JOIN users u ON u.user_id=c.user_id JOIN service_inquiries i ON i.inquiry_id=q.inquiry_id ORDER BY q.quotation_id DESC LIMIT 500');
    $qi = all('SELECT qi.quotation_id, qi.product_id, qi.description, qi.quantity, qi.unit_price, p.item_type, p.category, p.description product_description FROM quotation_items qi LEFT JOIN products p USING(product_id) ORDER BY qi.item_id');
    $qc = all('SELECT quotation_id, charge_id, label, amount FROM quotation_charges ORDER BY charge_id');
    $ql = all('SELECT quotation_id, labor_id, role, workers, days, daily_rate, amount FROM quotation_labor ORDER BY labor_id');
    $qe = all('SELECT quotation_id, event, created_at FROM quotation_events ORDER BY event_id DESC');
    $g = function ($rows) { $o = []; foreach ($rows as $r) $o[$r['quotation_id']][] = $r; return $o; };
    [$gi, $gc, $gl, $ge] = [$g($qi), $g($qc), $g($ql), $g($qe)];
    foreach ($quotes as &$q) { $id = $q['quotation_id']; $q['items'] = $gi[$id] ?? []; $q['charges'] = $gc[$id] ?? []; $q['labor'] = $gl[$id] ?? []; $q['events'] = $ge[$id] ?? []; }
    unset($q);

    $projects = all('SELECT p.*, q.quotation_id, q.quotation_no, q.total_amount, i.place_type, i.province, i.city, CONCAT(u.first_name," ",u.last_name) customer, u.email,
                            a.payment_agreement agreement, a.payment_method method
                     FROM projects p JOIN quotations q ON q.project_id=p.project_id LEFT JOIN service_inquiries i ON i.inquiry_id=p.inquiry_id
                     JOIN customers c ON c.customer_id=p.customer_id JOIN users u ON u.user_id=c.user_id
                     LEFT JOIN quotation_approvals a ON a.approval_id=(SELECT MAX(approval_id) FROM quotation_approvals WHERE quotation_id=q.quotation_id)
                     ORDER BY p.project_id DESC LIMIT 500');
    $pays = all('SELECT p.payment_id,p.quotation_id,p.installment,p.amount_due,p.amount_paid,p.payment_method,p.payment_agreement,p.status,p.reference_no,p.reject_reason,p.transaction_date,p.confirmed_at,
                        p.proof_of_payment_url IS NOT NULL has_proof, r.receipt_no, r.issued_at, r.sent_at
                 FROM payments p LEFT JOIN receipts r USING(payment_id) ORDER BY p.payment_id');
    $gp = $g($pays);
    $certs = []; foreach (all('SELECT project_id,data,sent_at FROM project_certificates') as $c) $certs[$c['project_id']] = ['data' => json_decode($c['data'], true), 'sent_at' => $c['sent_at']];
    $photos = []; foreach (all('SELECT photo_id,project_id,caption FROM certificate_photos ORDER BY photo_id') as $ph) $photos[$ph['project_id']][] = $ph;
    $inst = []; foreach (all('SELECT schedule_id,quotation_id,scheduled_date,time_slot,status FROM installation_schedules WHERE activity_type="Installation" AND status<>"Cancelled" ORDER BY schedule_id') as $s) $inst[$s['quotation_id']] = $s;
    $pdocs = []; foreach (all('SELECT inquiry_id,title,date_issued FROM customer_documents WHERE document_type="Other" AND inquiry_id IS NOT NULL') as $d)
        foreach (project_doc_names() as $k => $n) if (str_starts_with($d['title'], $n . ' - ')) $pdocs[$d['inquiry_id']][$k] = $d['date_issued'];
    foreach ($projects as &$p) {
        $p['payments'] = $gp[$p['quotation_id']] ?? [];
        if (!$p['agreement'] && $p['payments']) { $p['agreement'] = $p['payments'][0]['payment_agreement']; $p['method'] = $p['payments'][0]['payment_method']; }
        $p['checklist'] = json_decode((string)$p['checklist'], true);
        $p['certificate'] = $certs[$p['project_id']] ?? null;
        $p['photos'] = $photos[$p['project_id']] ?? [];
        $p['install_schedule'] = $inst[$p['quotation_id']] ?? null;
        $p['documents'] = $pdocs[$p['inquiry_id']] ?? (object)[];   // MOA / Job Order sent to the customer: kind => date
    }
    unset($p);

    $from = date('Y-m-d', strtotime('-60 days')); $to = date('Y-m-d', strtotime('+400 days'));
    out([
        'today' => date('Y-m-d'),
        'catalog' => admin_products(true),
        'inquiries' => $inq,
        'quotations' => $quotes,
        'projects' => $projects,
        'bookings' => admin_bookings($from, $to),
        'availability' => array_map(fn($d) => array_column($d, 'time'), calendar_days($from, $to, null)),
        'labor_rates' => cfg('labor_rates'),
        'limits' => ['vat' => (float)cfg('vat_rate'), 'price_max' => (float)cfg('price_max'), 'expense_max' => (float)cfg('expense_max'), 'days_max' => (int)cfg('labor_days_max'), 'workers_max' => (int)cfg('labor_workers_max'), 'photos_max' => (int)cfg('cert_photos_max')],
        'standard_slots' => cfg('slots'),
    ]);
});
