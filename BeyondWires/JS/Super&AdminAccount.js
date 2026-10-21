// Where each role lands after signing in (paths are relative to the HTML folder).
const DASHBOARDS = {
    admin: 'AdminHomePage.html',
    superadmin: 'SuperHomePage.html'
};
const ROLE_LABEL = { admin: 'Admin', superadmin: 'Super Admin' };

let chosenRole = 'admin';

const form = document.getElementById('loginForm');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const togglePassword = document.getElementById('togglePassword');
const rolePicker = document.getElementById('rolePicker');
const submitBtn = document.getElementById('submitBtn');
const errorBox = document.getElementById('loginError');

// Chrome fills saved logins into the boxes when the page opens. The boxes start read-only
// (Chrome skips those) and unlock as soon as they are clicked, tapped or tabbed into.
[emailInput, passwordInput].forEach(el => ['pointerdown', 'focus'].forEach(ev => el.addEventListener(ev, () => el.removeAttribute('readonly'))));

function showError(msg) {
    errorBox.textContent = msg || '';
    errorBox.classList.toggle('show', !!msg);
}

if (togglePassword && passwordInput) {
    togglePassword.addEventListener('click', () => {
        const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        passwordInput.setAttribute('type', type);
        togglePassword.classList.toggle('fa-eye');
        togglePassword.classList.toggle('fa-eye-slash');
    });
}

/* ---------- Role picker ---------- */
rolePicker.addEventListener('click', e => {
    const btn = e.target.closest('[data-role]');
    if (!btn) return;
    chosenRole = btn.dataset.role;
    rolePicker.querySelectorAll('.role-opt').forEach(b => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-checked', String(b === btn));
    });
    submitBtn.textContent = 'Log In as ' + ROLE_LABEL[chosenRole];
    showError('');
});

/* ---------- Sign in ----------
   The server checks the email, the password AND that the account really has the
   chosen role (api/auth.php). Opening a dashboard URL directly does not work either:
   every dashboard asks the server who is logged in before it shows anything. */
form.addEventListener('submit', async e => {
    e.preventDefault();
    const id = emailInput.value.trim(), pw = passwordInput.value;

    if (!id || !pw) {
        showError('Please enter your email or username and your password.');
        (id ? passwordInput : emailInput).focus();
        return;
    }
    showError('');
    submitBtn.disabled = true;
    try {
        const res = await window.BW.api('/auth/login', { body: { email: id, password: pw, role: chosenRole }, noRedirect: true });
        location.href = DASHBOARDS[res.user.role] || DASHBOARDS[chosenRole];
    } catch (err) {
        // the server's message also says how many tries are left before a 5-minute lock
        showError(err.status === 401 ? err.message + ' Also check that you chose the right role (' + ROLE_LABEL[chosenRole] + ').' : err.message);
        if (err.status === 401 || err.status === 429) { emailInput.classList.add('invalid'); passwordInput.classList.add('invalid'); passwordInput.value = ''; passwordInput.focus(); }
        submitBtn.disabled = false;
    }
});

form.addEventListener('input', e => { if (e.target.tagName === 'INPUT') { e.target.classList.remove('invalid'); showError(''); } });
