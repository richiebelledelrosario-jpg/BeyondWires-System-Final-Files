/* ==========================================================
   BeyondWires shared front-end helper  |  JS/api.js
   Every page loads it BEFORE its own script:
     <script src="../JS/api.js"></script>
   Talks to the PHP backend: ../api/index.php?r=/route
   The server is the source of truth: logins, roles, limits, prices
   and schedules are all checked there, not only in the page.
   ========================================================== */
(function () {
    'use strict';

    const API_URL = '../api/index.php';
    const HOME = { customer: 'HomePage.html', admin: 'AdminHomePage.html', superadmin: 'SuperHomePage.html' };
    const LOGIN = { customer: 'LandingPage.html#login', admin: 'Super&AdminAccount.html', superadmin: 'Super&AdminAccount.html' };

    class ApiError extends Error {
        constructor(message, status) { super(message); this.status = status; }
    }
    let loginPage = null;   // set by guard(); a 401 later sends the user back here

    function buildUrl(path, query) {
        let url = API_URL + '?r=' + encodeURIComponent(path);
        if (query) Object.keys(query).forEach(k => {
            const v = query[k];
            if (v !== undefined && v !== null && v !== '') url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(v);
        });
        return url;
    }

    /**
     * api('/auth/login', { body: {...} })              -> POST JSON
     * api('/admin/inquiries', { query: { q: 'x' } })   -> GET
     * api('/customer/payments/5/proof', { form: fd })   -> POST multipart (file upload)
     * api('/admin/quotations/3', { method: 'PUT', body: {...} })
     */
    async function api(path, opt) {
        opt = opt || {};
        const method = opt.method || ((opt.body !== undefined || opt.form) ? 'POST' : 'GET');
        const headers = { 'X-Requested-With': 'fetch', 'Accept': 'application/json' };
        let body;
        if (opt.form) body = opt.form;
        else if (opt.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opt.body); }
        let res;
        try {
            res = await fetch(buildUrl(path, opt.query), { method, headers, body, credentials: 'same-origin' });
        } catch (e) {
            throw new ApiError('Cannot reach the server. Make sure Apache and MySQL are running in XAMPP.', 0);
        }
        let json = null;
        try { json = await res.json(); } catch (e) { /* not JSON */ }
        if (!json) throw new ApiError('Unexpected server response (' + res.status + '). Open api/index.php?r=/catalog in your browser to check PHP and the database.', res.status);
        if (!json.ok) {
            if (res.status === 401 && loginPage && !opt.noRedirect) location.replace(loginPage);
            throw new ApiError(json.error || 'Request failed.', res.status);
        }
        return json.data;
    }
    /** URL for GET downloads and images (proofs, photos). The session cookie is sent automatically. */
    const fileUrl = (path, query) => buildUrl(path, query);

    /**
     * Protects a dashboard page. Resolves with the logged-in user, or redirects:
     *  - not logged in         -> that role's login page
     *  - logged in, wrong role -> the user's own dashboard
     * The page stays hidden until the server has answered, so nothing flashes.
     */
    async function guard(role) {
        loginPage = LOGIN[role];
        document.documentElement.style.visibility = 'hidden';
        try {
            const me = await api('/auth/me', { noRedirect: true });
            if (me.role !== role) { location.replace(HOME[me.role] || 'LandingPage.html'); return new Promise(() => {}); }
            document.documentElement.style.visibility = '';
            return me;
        } catch (e) {
            if (e.status === 401) { location.replace(loginPage); return new Promise(() => {}); }
            document.documentElement.style.visibility = '';
            document.body.innerHTML = '<div style="font:14px sans-serif;padding:40px;max-width:640px;margin:auto"><h2>Cannot load the dashboard</h2><p>' +
                esc(e.message) + '</p><p><a href="LandingPage.html">Back to home</a></p></div>';
            return new Promise(() => {});
        }
    }
    async function logout(to) {
        try { await api('/auth/logout', { body: {}, noRedirect: true }); } catch (e) { /* already logged out */ }
        try { sessionStorage.clear(); } catch (e) {  }
        location.replace(to || 'LandingPage.html');
    }

    /* ---------- notifications (same layout + behaviour on every dashboard) ----------
       Items come from the server. Clicking one (or Enter / Space) marks it read and calls
       open(link), where link is e.g. "quotation:12", "project:3", "inquiry:5", "schedule:7", "documents". */
    function Notifications(o) {
        const listEl = document.getElementById(o.list), dotEl = document.getElementById(o.dot), markEl = document.getElementById(o.markAll);
        const ICON = { quotation: 'fa-file-invoice', project: 'fa-folder-open', inquiry: 'fa-inbox', schedule: 'fa-calendar-days', documents: 'fa-file-lines', payment: 'fa-receipt' };
        let items = [];
        async function load() {
            try { const r = await api('/notifications', { noRedirect: true }); items = r.items || []; }
            catch (e) { if (e.status === 401 && loginPage) location.replace(loginPage); return; }   // logged out after 30 idle minutes: leave the page
            listEl.innerHTML = items.length ? items.map((n, i) => {
                const kind = String(n.link || '').split(':')[0];
                const icon = /payment|proof|receipt/i.test(n.title) ? 'fa-receipt' : (ICON[kind] || 'fa-bell');
                return '<div class="notif-item' + (+n.is_read ? '' : ' unread') + '" data-n="' + i + '" role="button" tabindex="0"><strong><i class="fa-solid ' + icon + '"></i>' +
                    esc(n.message || n.title) + '</strong><span>' + esc(ago(n.timestamp)) + '</span></div>';
            }).join('') : '<div class="notif-empty">No notifications</div>';
            if (dotEl) dotEl.style.display = items.some(n => !+n.is_read) ? 'block' : 'none';
        }
        async function openIt(i) {
            const n = items[i]; if (!n) return;
            if (!+n.is_read) { n.is_read = 1; api('/notifications/' + n.notification_id + '/read', { body: {} }).catch(() => {}); }
            if (o.close) o.close();
            if (o.open) o.open(String(n.link || ''), n);
            load();
        }
        listEl.addEventListener('click', e => { const it = e.target.closest('[data-n]'); if (it) openIt(+it.dataset.n); });
        listEl.addEventListener('keydown', e => { const it = e.target.closest('[data-n]'); if (it && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openIt(+it.dataset.n); } });
        const markAll = async () => { try { await api('/notifications/read', { body: {} }); await load(); if (o.toast) o.toast('All notifications marked as read'); } catch (e) { if (o.toast) o.toast(e.message); } };
        if (markEl) { markEl.onclick = markAll; markEl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); markAll(); } }); }
        load();
        setInterval(load, 60000);   // new notifications show up without a reload
        return { load };
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    /** Accepts 'YYYY-MM-DD' or MySQL 'YYYY-MM-DD HH:MM:SS'. */
    function toDate(s) {
        if (!s) return null;
        if (s instanceof Date) return s;
        const str = String(s);
        return new Date(str.length <= 10 ? str + 'T00:00:00' : str.replace(' ', 'T'));
    }
    function ago(s) {
        const d = toDate(s); if (!d) return '';
        const sec = Math.floor((Date.now() - d.getTime()) / 1000);
        if (sec < 60) return 'just now';
        if (sec < 3600) return Math.floor(sec / 60) + ' mins ago';
        if (sec < 86400) return Math.floor(sec / 3600) + ' hours ago';
        const days = Math.floor(sec / 86400);
        return days < 30 ? days + ' days ago' : days < 365 ? Math.floor(days / 30) + ' months ago' : Math.floor(days / 365) + ' years ago';
    }
    const pad = n => String(n).padStart(2, '0');
    const isoDate = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const num = v => Number(v) || 0;
    /* Display numbers the pages use: INQ-2026-0005 style ids from the database ids */
    const inqNo = (id, date) => 'INQ-' + String(date || '').slice(0, 4) + '-' + String(id).padStart(3, '0');
    const prjNo = id => 'PRJ-' + String(id).padStart(3, '0');
    const toast = (msg) => { const t = document.createElement('div'); t.className = 'bw-toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3200); };

    window.BW = { api, fileUrl, guard, logout, Notifications, ApiError, esc, toDate, ago, pad, isoDate, num, inqNo, prjNo, toast, HOME };
})();
