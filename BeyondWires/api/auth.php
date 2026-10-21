<?php
function valid_gmail(string $e): bool {
    if (!preg_match('/^[a-z0-9.]{6,30}@gmail\.com$/', $e)) return false;
    $local = explode('@', $e)[0];
    return $local[0] !== '.' && substr($local, -1) !== '.' && !str_contains($local, '..');
}
function valid_name(string $v): bool { return $v !== '' && preg_match('/^[\p{L}]+(?:\s+[\p{L}]+)*$/u', $v) === 1; }
function strong_pw(string $p): bool { return strlen($p) >= 8 && preg_match('/\d/', $p) === 1; }

const HOME = ['customer' => 'HomePage.html', 'admin' => 'AdminHomePage.html', 'superadmin' => 'SuperHomePage.html'];

/* ---- Customer sign-up ---- */
route('POST', '/auth/register', null, function () {
    $in = input();
    $fn = s($in['first_name'] ?? '', 60); $ln = s($in['last_name'] ?? '', 60);
    $email = strtolower(s($in['email'] ?? '', 120)); $pw = (string)($in['password'] ?? '');
    if (!valid_name($fn)) fail('First name can contain letters and spaces only.');
    if (!valid_name($ln)) fail('Last name can contain letters and spaces only.');
    if (!valid_gmail($email)) fail('Enter a valid Gmail address (6-30 letters, numbers or periods before @gmail.com).');
    if (!strong_pw($pw)) fail('Use at least 8 characters and include a number.');
    if (array_key_exists('confirm_password', $in) && (string)$in['confirm_password'] !== $pw) fail('Passwords do not match.');
    $phone = null;
    if (($raw = s($in['phone_number'] ?? '', 30)) !== '' && !($phone = ph_mobile($raw))) fail('Enter a valid PH mobile number, e.g. +63 917 824 6310.');
    $ex = one('SELECT user_id, role, email_verified_at FROM users WHERE email=?', [$email]);
    if ($ex && ($ex['email_verified_at'] || $ex['role'] !== 'customer')) fail('An account with this email already exists.', 409);
    $uid = tx(function () use ($fn, $ln, $email, $pw, $in, $phone, $ex) {
        if ($ex) {   // never verified (e.g. the code was lost): signing up again replaces the unverified details
            q('UPDATE users SET first_name=?, last_name=?, password_hash=?, phone_number=? WHERE user_id=?', [$fn, $ln, password_hash($pw, PASSWORD_DEFAULT), $phone, $ex['user_id']]);
            return (int)$ex['user_id'];
        }
        q('INSERT INTO users(first_name,last_name,email,password_hash,phone_number,role) VALUES(?,?,?,?,?,"customer")',
          [$fn, $ln, $email, password_hash($pw, PASSWORD_DEFAULT), $phone]);
        $id = (int)lastId();
        q('INSERT INTO customers(user_id,company_name,avatar_initials) VALUES(?,?,?)',
          [$id, s($in['company_name'] ?? '', 120) ?: null, mb_strtoupper(mb_substr($fn, 0, 1) . mb_substr($ln, 0, 1))]);
        return $id;
    });
    $sent = send_verify_code(['user_id' => $uid, 'email' => $email, 'first_name' => $fn]) === 'sent';
    out(['message' => $sent ? 'Account created. We sent a 6-digit code to your email.' : 'Account created, but we could not send the code right now. Use "Send a new code" in a minute.', 'verify' => true], 201);
});

/* ---- Email verification (update_2026_10.sql, section 14) ----
   A new customer account must enter the 6-digit code we email before it can log in.
   A code expires after 10 minutes and allows 5 tries; at most 3 codes per account every 15 minutes. */
function send_verify_code(array $u, string $intro = 'Use this code to verify your email and activate your BeyondWires account:'): string {   // 'sent' | 'limit' | 'fail'
    if ((int)one('SELECT COUNT(*) n FROM email_codes WHERE user_id=? AND created_at > NOW() - INTERVAL 15 MINUTE', [$u['user_id']])['n'] >= 3) return 'limit';
    $code = (string)random_int(100000, 999999);
    q('UPDATE email_codes SET expires_at=NOW() WHERE user_id=? AND expires_at > NOW()', [$u['user_id']]);   // only the newest code works
    q('INSERT INTO email_codes(user_id, code_hash, expires_at, sent_to) VALUES(?,?,NOW() + INTERVAL 10 MINUTE,?)', [$u['user_id'], hash('sha256', $code), $u['email']]);
    $name = htmlspecialchars($u['first_name']);
    return send_mail($u['email'], 'Your BeyondWires verification code',
        "<p>Hi $name,</p><p>$intro</p>" .
        "<p style=\"font-size:28px;font-weight:bold;letter-spacing:6px\">$code</p><p>The code expires in 10 minutes. If you did not ask for this, you can ignore this email.</p><p>BeyondWires Security System Services</p>",
        "Hi {$u['first_name']},\n\nYour BeyondWires verification code is $code (expires in 10 minutes).\n\nIf you did not ask for this, ignore this email.") ? 'sent' : 'fail';
}
/** Checks a typed code against a stored one: 5 tries, then a new code is needed. */
function check_code(?array $c, string $code): void {
    if (!$c || $c['tries'] >= 5) fail('This code has expired. Please request a new one.', 410);
    if (!hash_equals($c['code_hash'], hash('sha256', $code))) {
        q('UPDATE email_codes SET tries=tries+1 WHERE code_id=?', [$c['code_id']]);
        $left = 4 - (int)$c['tries'];
        fail($left > 0 ? "Wrong code. $left " . ($left === 1 ? 'try' : 'tries') . ' left.' : 'Too many wrong codes. Please request a new one.', $left > 0 ? 400 : 410);
    }
}
route('POST', '/auth/verify', null, function () {
    $in = input();
    $email = strtolower(s($in['email'] ?? '', 120)); $code = (string)($in['code'] ?? '');
    $c = one('SELECT e.code_id, e.code_hash, e.tries, u.user_id FROM email_codes e JOIN users u USING(user_id)
              WHERE u.email=? AND u.email_verified_at IS NULL AND e.expires_at > NOW() ORDER BY e.code_id DESC LIMIT 1', [$email]);
    check_code($c, $code);
    q('UPDATE users SET email_verified_at=NOW() WHERE user_id=?', [$c['user_id']]);
    q('DELETE FROM email_codes WHERE user_id=?', [$c['user_id']]);
    q('INSERT INTO audit_logs(user_id,action_type,details,ip_address) VALUES(?,?,?,?)', [$c['user_id'], 'EMAIL_VERIFIED', 'Email verified with code', $_SERVER['REMOTE_ADDR'] ?? '']);
    out(['message' => 'Email verified. You can now log in.']);
});
route('POST', '/auth/resend', null, function () {
    $email = strtolower(s(input()['email'] ?? '', 120));
    $u = one('SELECT user_id, email, first_name FROM users WHERE email=? AND role="customer" AND email_verified_at IS NULL', [$email]);
    $st = $u ? send_verify_code($u) : 'sent';   // same answer for unknown emails
    if ($st === 'limit') fail('You already asked for 3 codes. Please wait 15 minutes, then try again.', 429);
    if ($st === 'fail') fail('We could not send the email right now. Please try again later.', 503);
    out(['message' => 'We sent a new code. Check your inbox and spam folder.']);
});

/* ---- Login (all roles). Staff page sends role: admin | superadmin ---- */
route('POST', '/auth/login', null, function () {
    $in = input();
    $email = strtolower(s($in['email'] ?? '', 120)); $pw = (string)($in['password'] ?? ''); $role = $in['role'] ?? null;
    /* Lockout per account: 5 wrong passwords lock that email for 5 minutes. It is kept in the database
       (table login_attempts), so clearing cookies or using another browser does not reset it. */
    $lock = one('SELECT TIMESTAMPDIFF(SECOND, NOW(), lock_until) s FROM login_attempts WHERE email=? AND lock_until > NOW()', [$email]);
    if ($lock) fail('Too many failed attempts. Please try again in ' . max(1, (int)ceil($lock['s'] / 60)) . ' minute(s).', 429);
    $row = $email !== '' ? one('SELECT u.*, c.customer_id FROM users u LEFT JOIN customers c ON c.user_id=u.user_id WHERE u.email=?', [$email]) : null;
    $ok = $row && password_verify($pw, $row['password_hash']) && $row['status'] === 'Active' && (!$role || $row['role'] === $role);
    if (!$ok) {
        q('INSERT INTO login_attempts(email,fails) VALUES(?,1) ON DUPLICATE KEY UPDATE
             fails = IF(lock_until IS NOT NULL AND lock_until <= NOW(), 1, fails + 1),
             lock_until = IF(fails >= 5, NOW() + INTERVAL 5 MINUTE, NULL)', [$email]);
        $left = 5 - (int)(one('SELECT fails FROM login_attempts WHERE email=?', [$email])['fails'] ?? 0);
        usleep(300000);
        if ($left <= 0) fail('Too many failed attempts. Please try again in 5 minutes.', 429);
        fail('Invalid email or password.' . ($left <= 2 ? " $left attempt" . ($left === 1 ? '' : 's') . ' left before a 5-minute lock.' : ''), 401);
    }
    q('DELETE FROM login_attempts WHERE email=?', [$email]);
    if ($row['role'] === 'customer' && !$row['email_verified_at']) {   // correct password, but the email is not verified yet
        if (!one('SELECT 1 FROM email_codes WHERE user_id=? AND expires_at > NOW() AND tries < 5', [$row['user_id']])) send_verify_code($row);
        fail('Please verify your email first. Enter the 6-digit code we sent to ' . $email . '.', 403);
    }
    session_regenerate_id(true);
    $_SESSION['last_activity'] = time();
    if (password_needs_rehash($row['password_hash'], PASSWORD_DEFAULT))
        q('UPDATE users SET password_hash=? WHERE user_id=?', [password_hash($pw, PASSWORD_DEFAULT), $row['user_id']]);
    $_SESSION['user'] = ['id' => (int)$row['user_id'], 'role' => $row['role'], 'name' => $row['first_name'] . ' ' . $row['last_name'],
                         'email' => $row['email'], 'customer_id' => $row['customer_id'] ? (int)$row['customer_id'] : null];
    if ($row['role'] === 'customer')
        q('INSERT INTO customer_activity_logs(customer_id,activity_device,location,status) VALUES(?,?,?,"Login")',
          [$row['customer_id'], mb_substr($_SERVER['HTTP_USER_AGENT'] ?? 'unknown', 0, 160), $_SERVER['REMOTE_ADDR'] ?? '']);
    audit('LOGIN', 'Signed in as ' . $row['role']);
    out(['user' => $_SESSION['user'], 'redirect' => HOME[$row['role']]]);
});

route('POST', '/auth/logout', [], function ($u) {
    audit('LOGOUT');
    $_SESSION = [];
    session_destroy();
    out(['message' => 'Logged out.']);
});

route('GET', '/auth/me', [], function ($u) {
    $r = one('SELECT u.first_name,u.last_name,u.email,u.phone_number,u.recovery_email,c.contact_name,c.contact_role,c.contact_email,c.contact_phone
              FROM users u LEFT JOIN customers c ON c.user_id=u.user_id WHERE u.user_id=?', [$u['id']]);
    if ($u['role'] !== 'customer') unset($r['contact_name'], $r['contact_role'], $r['contact_email'], $r['contact_phone']);
    out($u + $r);
});

/* ---- Profile + password (used by the Settings tab) ---- */
route('POST', '/auth/profile', [], function ($u) {
    $in = input();
    $parts = preg_split('/\s+/', s($in['full_name'] ?? '', 130), 2);
    $fn = $parts[0] ?? ''; $ln = $parts[1] ?? '';
    if (!valid_name($fn) || !valid_name($ln)) fail('Enter your first and last name (letters only).');
    $email = strtolower(s($in['email'] ?? '', 120));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Enter a valid email address.');
    if ($u['role'] === 'customer' && !valid_gmail($email)) fail('Enter a valid Gmail address.');
    if (one('SELECT 1 FROM users WHERE email=? AND user_id<>?', [$email, $u['id']])) fail('That email is already in use.', 409);
    $phone = array_key_exists('phone_number', $in) ? s($in['phone_number'], 30) : null;
    if ($phone !== null && $phone !== '') {
        if ($u['role'] === 'customer') { if (!($phone = ph_mobile($phone))) fail('Enter a valid PH mobile number, e.g. +63 917 824 6310.'); }
        elseif (!preg_match('/^\+?[0-9\s\-()]{7,20}$/', $phone)) fail('Enter a valid phone number.');
    }
    q('UPDATE users SET first_name=?, last_name=?, email=? WHERE user_id=?', [$fn, $ln, $email, $u['id']]);
    if ($phone !== null) q('UPDATE users SET phone_number=? WHERE user_id=?', [$phone ?: null, $u['id']]);
    $_SESSION['user']['name'] = "$fn $ln"; $_SESSION['user']['email'] = $email;
    audit('PROFILE_UPDATE');
    out($_SESSION['user']);
});

route('POST', '/auth/password', [], function ($u) {
    $in = input();
    $cur = (string)($in['current_password'] ?? ''); $new = (string)($in['new_password'] ?? '');
    $row = one('SELECT password_hash FROM users WHERE user_id=?', [$u['id']]);
    if (!password_verify($cur, $row['password_hash'])) fail('Current password is incorrect.', 403);
    if (!strong_pw($new)) fail('Use at least 8 characters and include a number.');
    if ($new === $cur) fail('New password must be different from the current one.');
    if (($in['confirm_password'] ?? $new) !== $new) fail('Passwords do not match.');
    q('UPDATE users SET password_hash=? WHERE user_id=?', [password_hash($new, PASSWORD_DEFAULT), $u['id']]);
    audit('PASSWORD_CHANGE');
    out(['message' => 'Password changed.']);
});

/* ---- Forgot password ----
   1) /auth/forgot: emails a reset link (valid 30 minutes, works once). The answer is the same whether
      or not the email has an account, so nobody can use this to check which emails are registered.
   2) /auth/reset: sets the new password with that link. Table: password_resets (update_2026_10.sql, section 13). */
route('POST', '/auth/forgot', null, function () {
    $email = strtolower(s(input()['email'] ?? '', 120));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Enter a valid email address.');
    $done = ['message' => 'If an account uses this email, we sent a link to reset the password. Check your inbox and spam folder.'];
    // the main email or the recovery email (Settings); the link goes to the email typed here
    // customer accounts only: staff (admin / super admin) passwords cannot be reset by email
    $u = one('SELECT user_id, first_name FROM users WHERE (email=? OR recovery_email=?) AND role="customer" AND status="Active" ORDER BY email=? DESC LIMIT 1', [$email, $email, $email]);
    if (!$u) out($done);
    // at most 3 emails per account every 15 minutes
    if ((int)one('SELECT COUNT(*) n FROM password_resets WHERE user_id=? AND created_at > NOW() - INTERVAL 15 MINUTE', [$u['user_id']])['n'] >= 3) out($done);
    $token = bin2hex(random_bytes(32));
    q('UPDATE password_resets SET expires_at=NOW() WHERE user_id=? AND used_at IS NULL AND expires_at > NOW()', [$u['user_id']]);   // only the newest link works
    q('INSERT INTO password_resets(user_id, token_hash, expires_at) VALUES(?,?,NOW() + INTERVAL 30 MINUTE)', [$u['user_id'], hash('sha256', $token)]);
    $link = rtrim((string)cfg('app_url'), '/') . '/HTML/ResetPassword.html?token=' . $token;
    $name = htmlspecialchars($u['first_name']);
    $sent = send_mail($email, 'Reset your BeyondWires password',
        "<p>Hi $name,</p><p>We received a request to reset your BeyondWires password.</p>" .
        "<p><a href=\"$link\" style=\"display:inline-block;padding:10px 18px;background:#0077F6;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold\">Reset password</a></p>" .
        "<p>This link works once and expires in 30 minutes. If you did not ask for this, you can ignore this email; your password stays the same.</p><p>BeyondWires Security System Services</p>",
        "Hi {$u['first_name']},\n\nReset your BeyondWires password with this link (works once, expires in 30 minutes):\n$link\n\nIf you did not ask for this, ignore this email.");
    if (!$sent) fail('We could not send the email right now. Please try again later.', 503);
    out($done);
});
route('POST', '/auth/reset', null, function () {
    $in = input();
    $token = (string)($in['token'] ?? ''); $pw = (string)($in['password'] ?? '');
    $r = preg_match('/^[a-f0-9]{64}$/', $token) ? one('SELECT r.reset_id, u.user_id, u.email, u.role FROM password_resets r JOIN users u USING(user_id)
               WHERE r.token_hash=? AND r.used_at IS NULL AND r.expires_at > NOW() AND u.role="customer"', [hash('sha256', $token)]) : null;
    if (!$r) fail('This reset link is invalid or has expired. Please request a new one.', 410);
    if (!strong_pw($pw)) fail('Use at least 8 characters and include a number.');
    if (($in['confirm_password'] ?? $pw) !== $pw) fail('Passwords do not match.');
    tx(function () use ($r, $pw) {
        q('UPDATE users SET password_hash=? WHERE user_id=?', [password_hash($pw, PASSWORD_DEFAULT), $r['user_id']]);
        q('UPDATE password_resets SET used_at=NOW() WHERE reset_id=?', [$r['reset_id']]);
        q('DELETE FROM login_attempts WHERE email=?', [$r['email']]);   // a locked account can log in again
    });
    q('INSERT INTO audit_logs(user_id,action_type,details,ip_address) VALUES(?,?,?,?)', [$r['user_id'], 'PASSWORD_RESET', 'Password reset by email link', $_SERVER['REMOTE_ADDR'] ?? '']);
    out(['message' => 'Your password has been changed. You can now log in.', 'role' => $r['role']]);
});

/* ---- Recovery email (customer Settings; update_2026_10.sql section 15) ----
   A second email, confirmed with a 6-digit code. Forgot password also accepts it, so a customer
   who loses their main email can still reset the password by themselves. Staff cannot set it. */
route('POST', '/auth/recovery', ['customer'], function ($u) {
    $email = strtolower(s(input()['email'] ?? '', 120));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Enter a valid email address.');
    if ($email === strtolower($u['email'])) fail('Use an email different from your main email.');
    if (one('SELECT 1 FROM users WHERE (email=? OR recovery_email=?) AND user_id<>?', [$email, $email, $u['id']])) fail('This email cannot be used as a recovery email. Please use another one.');
    $st = send_verify_code(['user_id' => $u['id'], 'email' => $email, 'first_name' => explode(' ', $u['name'])[0]],
        'Use this code to add this address as the recovery email of your BeyondWires account:');
    if ($st === 'limit') fail('You already asked for 3 codes. Please wait 15 minutes, then try again.', 429);
    if ($st === 'fail') fail('We could not send the email right now. Please try again later.', 503);
    out(['message' => "We sent a 6-digit code to $email."]);
});
route('POST', '/auth/recovery/verify', ['customer'], function ($u) {
    $c = one('SELECT code_id, code_hash, tries, sent_to FROM email_codes WHERE user_id=? AND sent_to IS NOT NULL AND sent_to<>? AND expires_at > NOW() ORDER BY code_id DESC LIMIT 1', [$u['id'], $u['email']]);
    check_code($c, (string)(input()['code'] ?? ''));
    if (one('SELECT 1 FROM users WHERE (email=? OR recovery_email=?) AND user_id<>?', [$c['sent_to'], $c['sent_to'], $u['id']])) fail('This email cannot be used as a recovery email. Please use another one.');
    q('UPDATE users SET recovery_email=? WHERE user_id=?', [$c['sent_to'], $u['id']]);
    q('DELETE FROM email_codes WHERE user_id=?', [$u['id']]);
    audit('RECOVERY_EMAIL_SET', $c['sent_to']);
    // tell the main email, in case someone else is using this account
    send_mail($u['email'], 'Recovery email added to your BeyondWires account',
        '<p>Hi ' . htmlspecialchars(explode(' ', $u['name'])[0]) . ',</p><p>' . htmlspecialchars($c['sent_to']) . ' was added as the recovery email of your BeyondWires account.</p><p>If this was not you, log in and change your password right away.</p>',
        $c['sent_to'] . " was added as the recovery email of your BeyondWires account. If this was not you, log in and change your password right away.");
    out(['recovery_email' => $c['sent_to']]);
});
route('POST', '/auth/recovery/remove', ['customer'], function ($u) {
    q('UPDATE users SET recovery_email=NULL WHERE user_id=?', [$u['id']]);
    audit('RECOVERY_EMAIL_REMOVED');
    out(['message' => 'Recovery email removed.']);
});

/* ---- Notifications (all roles) ---- */
route('GET', '/notifications', [], function ($u) {
    out(['unread' => (int)one('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0', [$u['id']])['c'],
         'items'  => all('SELECT notification_id,title,message,link,is_read,timestamp FROM notifications WHERE user_id=? ORDER BY notification_id DESC LIMIT 50', [$u['id']])]);
});
route('POST', '/notifications/{id}/read', [], function ($u, $id) {   // one notification (opened from the bell)
    q('UPDATE notifications SET is_read=1 WHERE notification_id=? AND user_id=?', [$id, $u['id']]);
    out(['message' => 'Marked as read.']);
});
route('POST', '/notifications/read', [], function ($u) {
    q('UPDATE notifications SET is_read=1 WHERE user_id=?', [$u['id']]);
    out(['message' => 'Marked as read.']);
});
