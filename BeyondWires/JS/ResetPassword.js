/* =====================================================================
   Forgot password page  |  JS/ResetPassword.js   (HTML/ResetPassword.html)
   - No ?token= in the address: asks for the email and sends the reset link (POST /auth/forgot)
   - ?token= (the link from the email): sets the new password (POST /auth/reset)
   The server checks everything again; this page only shows the messages right away.
   ===================================================================== */
(function () {
    const $ = id => document.getElementById(id);
    const show = (el, msg) => { el.textContent = msg || ''; el.classList.toggle('show', !!msg); };
    const fieldErr = (id, msg) => { $(id + 'Err').textContent = msg || ''; $(id).classList.toggle('invalid', !!msg); };
    const validEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
    const strongPw = v => v.length >= 8 && /\d/.test(v);
    const token = new URLSearchParams(location.search).get('token');

    document.querySelectorAll('[data-eye]').forEach(eye => eye.addEventListener('click', () => {
        const input = $(eye.dataset.eye), reveal = input.type === 'password';
        input.type = reveal ? 'text' : 'password';
        eye.classList.toggle('fa-eye', !reveal); eye.classList.toggle('fa-eye-slash', reveal);
    }));

    /* ---------- Step 1: ask for the link ---------- */
    const askEmail = $('askEmail');
    askEmail.addEventListener('blur', () => { askEmail.dataset.live = '1'; fieldErr('askEmail', askEmail.value.trim() && !validEmail(askEmail.value.trim()) ? 'Enter a valid email address.' : ''); });
    askEmail.addEventListener('input', () => { if (askEmail.dataset.live) fieldErr('askEmail', askEmail.value.trim() && !validEmail(askEmail.value.trim()) ? 'Enter a valid email address.' : ''); show($('askError'), ''); });
    $('askForm').addEventListener('submit', async e => {
        e.preventDefault();
        const email = askEmail.value.trim().toLowerCase();
        show($('askError'), ''); show($('askOk'), '');
        if (!validEmail(email)) { fieldErr('askEmail', 'Enter a valid email address.'); askEmail.focus(); return; }
        $('askBtn').disabled = true;
        try {
            const res = await window.BW.api('/auth/forgot', { body: { email }, noRedirect: true });
            show($('askOk'), res.message);
            $('askForm').hidden = true;
        } catch (err) {
            show($('askError'), err.message);
            $('askBtn').disabled = false;
        }
    });

    /* ---------- Step 2: set the new password ---------- */
    if (token) {
        $('askView').hidden = true; $('resetView').hidden = false;
        history.replaceState(null, '', location.pathname);   // the link is not left in the address bar or history
    }
    const checkPw = () => {
        const a = $('newPw').value, b = $('confPw').value;
        fieldErr('newPw', a && !strongPw(a) ? 'Use at least 8 characters and include a number.' : '');
        fieldErr('confPw', b && a !== b ? 'Passwords do not match.' : '');
    };
    ['newPw', 'confPw'].forEach(id => $(id).addEventListener('input', () => { checkPw(); show($('resetError'), ''); }));
    $('resetForm').addEventListener('submit', async e => {
        e.preventDefault();
        const a = $('newPw').value, b = $('confPw').value;
        show($('resetError'), '');
        if (!strongPw(a)) { fieldErr('newPw', 'Use at least 8 characters and include a number.'); $('newPw').focus(); return; }
        if (a !== b) { fieldErr('confPw', 'Passwords do not match.'); $('confPw').focus(); return; }
        $('resetBtn').disabled = true;
        try {
            const res = await window.BW.api('/auth/reset', { body: { token, password: a, confirm_password: b }, noRedirect: true });
            $('resetForm').hidden = true;
            show($('resetOk'), res.message);
            const staff = res.role === 'admin' || res.role === 'superadmin';
            $('backLink').href = staff ? 'Super&AdminAccount.html' : 'LandingPage.html#login';
            $('backLink').textContent = 'Go to log in';
        } catch (err) {
            show($('resetError'), err.message);
            $('resetBtn').disabled = false;
            if (err.status === 410) { $('resetForm').hidden = true; $('backLink').href = 'ResetPassword.html'; $('backLink').textContent = 'Request a new link'; }
        }
    });

    /* Staff come here from the staff page: "Back to log in" returns there */
    if (/Super&AdminAccount|Super%26AdminAccount/.test(document.referrer)) $('backLink').href = 'Super&AdminAccount.html';
})();
