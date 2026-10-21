(function () {
'use strict';

/* ===================== Helpers ===================== */
const VAT = 0.12, r2 = n => Math.round(n * 100) / 100;
/* Quotation edit limits */
const PRICE_MIN = 1, PRICE_MAX = 1000000;      // unit price per line item (PHP)
const QTY_MIN = 1, QTY_MAX = 100;              // whole units per line item
const EXP_MAX = 1000000;                       // transport / other expenses (PHP)
const VALIDITY_MIN = 1, VALIDITY_MAX = 30, VALIDITY_DEFAULT = 30;   // days the quoted prices are honored
/* Same math as the server: items + extra expenses + the admin's labor lines, then 12% VAT (older quotations without VAT keep theirs) */
function quoteCalc(q) {
    const sub = r2((q.items || []).reduce((s, i) => s + i.qty * i.price, 0)), tr = r2(q.transport || 0), lab = r2(q.labor || 0);
    const vat = q.noVat ? 0 : r2((sub + tr + lab) * VAT);
    return { sub, tr, lab, vat, total: r2(sub + tr + lab + vat) };
}
const DB_KEY = 'bw_super_db_v3', SET_KEY = 'bw_super_settings_v1', SIDEBAR_KEY = 'bw_super_sidebar_v1';
const THEME_KEY = 'bw_theme', PROFILE_KEY = 'bw_super_profile', LANDING = 'LandingPage.html';
let ME = 0;            // user id of the signed-in super admin (set in init)
const api = window.BW.api;
const $ = id => document.getElementById(id);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const peso = n => '₱' + Math.round(Number(n) || 0).toLocaleString('en-US');
const fmtDate = ts => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const initials = n => n.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const tone = n => ['blue', 'gray', 'green', 'orange'][[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % 4];
const badge = n => `<span class="client-badge ${tone(n)}">${esc(initials(n))}</span>`;
const emptyRow = (cols, msg) => `<tr class="empty-row"><td colspan="${cols}">${msg}</td></tr>`;
const readJSON = (k, fb) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? fb : v; } catch (e) { return fb; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

let profile = { name: '', email: '' };   // the signed-in account (from the server)
const firstName = () => profile.name.split(/\s+/)[0] || '';

const TABS = {
    dashboard: { crumb: 'OVERVIEW > DASHBOARD', title: 'System Dashboard', sub: '' },
    quotations: { crumb: 'MANAGEMENT > QUOTATIONS', title: 'Quotations', sub: 'Review, approve, or modify outgoing business proposals.' },
    projects: { crumb: 'MANAGEMENT > PROJECTS', title: 'Project Summary', sub: 'Track installations and security deployments by status and start date.' },
    financial: { crumb: 'PORTFOLIO > FINANCIAL SUMMARY', title: 'Financial Performance', sub: 'Real-time revenue, expense tracking, and profit analysis.' },
    activity: { crumb: 'SYSTEM > AUDIT TRAIL', title: 'Activity Log', sub: '' },
    settings: { crumb: 'SYSTEM SUPPORT > SETTINGS', title: 'System Settings', sub: 'Manage your dashboard appearance and account security.' }
};
const setDashSub = () => { TABS.dashboard.sub = `Welcome back, ${firstName()}. Here is a live summary of system status and recent operations.`; };
setDashSub();

const ui = {
    tab: 'dashboard', metric: 'revenue', range: 6, eventsShown: 5, perPage: 5, confirm: null, activeQuote: null,
    q: { page: 1, search: '', status: 'all' },
    p: { page: 1, search: '', status: 'all', from: '', to: '' },
    l: { page: 1, search: '', admin: 'all' }, a: { page: 1 }
};
let db;

/* ===================== Data ===================== */
const keyOf = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
const curKey = () => keyOf(new Date());
function lastMonths(n) {
    const out = [], now = new Date();
    for (let i = n - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        out.push({ key: keyOf(d), label: d.toLocaleString('en-US', { month: 'short' }), full: d.toLocaleString('en-US', { month: 'long', year: 'numeric' }) });
    }
    return out;
}

/* ===================== Finance ledger =====================
   ledger[YYYY-MM] = revenue + expenses per category, loaded from the server (api/owner.php: /owner/ledger). */
const EXP_CATS = ['Operations', 'Payroll', 'Marketing', 'Hardware / Supplies', 'Software'];
const EXP_SHARE = [0.42, 0.25, 0.14, 0.10, 0.09];
const COST_RATE = 0.6;
function buildLedger(revMap) {
    const out = {}, months = lastMonths(24);
    months.forEach((m, i) => {
        const rev = revMap[m.key] != null ? revMap[m.key]
            : Math.round(((revMap[months[Math.min(i + 12, 23)].key]) || 150000) * 0.82 / 1000) * 1000;
        const total = rev * (0.52 + ((i * 7) % 10) / 100), exp = {};
        EXP_CATS.forEach((c, j) => { exp[c] = Math.round(total * EXP_SHARE[j] / 100) * 100; });
        out[m.key] = { rev, exp };
    });
    return out;
}
/* ===================== Data from the server =====================
   Quotations, projects, revenue/expenses, activity and accounts are loaded from the
   API and mapped to the shapes this page draws. Every action goes to the server. */
const EVENT_TEXT = {
    LOGIN: 'Signed in', LOGOUT: 'Signed out', QUOTATION_CREATED: 'Created quotation', QUOTATION_SUBMITTED: 'Sent quotation to superadmin', QUOTATION_EDITED: 'Edited quotation',
    QUOTATION_APPROVED_OWNER: 'Approved quotation', QUOTATION_REJECTED_OWNER: 'Returned quotation', QUOTATION_EDITED_OWNER: 'Edited quotation', QUOTATION_APPROVED: 'Customer approved quotation',
    QUOTATION_DECLINED: 'Customer declined quotation', QUOTATION_DECLINED_ADMIN: 'Marked quotation as declined', QUOTATION_DELETED: 'Deleted draft quotation',
    INQUIRY_ACCEPTED: 'Accepted inquiry', INQUIRY_REJECTED: 'Rejected inquiry', INQUIRY_SUBMITTED: 'Customer submitted inquiry', SITE_VISIT_CONFIRMED: 'Confirmed site visit', SITE_VISIT_DONE: 'Completed site visit',
    SITE_VISIT_SCHEDULED: 'Scheduled site visit', PAYMENT_CONFIRMED: 'Confirmed payment', PAYMENT_REJECTED: 'Requested payment re-upload', PAYMENT_PROOF_UPLOADED: 'Customer uploaded payment proof',
    INSTALL_SCHEDULED: 'Scheduled installation', INSTALL_STARTED: 'Started installation', INSTALLATION_COMPLETE: 'Completed installation', RECEIPT_SENT: 'Sent receipt', CERTIFICATE_SENT: 'Sent installation certificate',
    PRODUCT_ADDED: 'Added catalog item', PRODUCT_EDITED: 'Edited catalog item', PRODUCT_PRICE: 'Changed price', PRODUCT_ARCHIVED: 'Archived catalog item', PRODUCT_RESTORED: 'Restored catalog item', PRODUCT_DELETED: 'Deleted catalog item',
    AVAILABILITY_CHANGED: 'Changed available slots', AVAILABILITY_BULK: 'Published available slots', SCHEDULE_CONFIRMED: 'Confirmed schedule', SCHEDULE_MOVED: 'Moved schedule', SCHEDULE_CHANGED_CUSTOMER: 'Customer moved schedule',
    USER_CREATED: 'Created account', USER_DELETED: 'Deleted account', USER_STATUS: 'Changed account status', PROFILE_UPDATE: 'Updated own profile', PASSWORD_CHANGE: 'Changed own password',
    EXPENSE_ADDED: 'Recorded expense', PROJECT_TERMS: 'Changed payment terms', CONTACT_UPDATE: 'Updated primary contact'
};
const ms = v => v ? new Date(String(v).replace(' ', 'T')).getTime() : Date.now();
const QSTATUS = q => q.status === 'Pending Superadmin' ? 'pending' : q.status === 'Draft' ? 'rejected' : 'approved';
async function load() {
    const [quotes, projects, ledger, logs, users] = await Promise.all([
        api('/owner/quotations', { query: { status: 'all' } }), api('/admin/projects'), api('/owner/ledger'),
        api('/owner/activity', { query: { source: 'staff' } }), api('/owner/users', { query: { role: 'all' } })]);
    const staff = users.filter(u => u.role !== 'customer').sort((a, b) => a.user_id - b.user_id);
    let n = 0;
    const accounts = staff.map(u => ({ id: +u.user_id, name: (u.first_name + ' ' + u.last_name).trim(), email: u.email,
        role: u.role === 'superadmin' ? 'Super Admin' : 'Administrator ' + (++n), status: u.status, lastActivity: ms(u.last_activity || u.created_at) }));
    const roleOf = id => (accounts.find(a => a.id === +id) || {}).role || 'Customer';
    const revMap = {}, exp = {};
    ledger.revenue.forEach(r => { revMap[r.m] = +r.v; });
    ledger.expenses.forEach(r => { const c = EXP_CATS.includes(r.c) ? r.c : 'Operations'; (exp[r.m] = exp[r.m] || {})[c] = ((exp[r.m] || {})[c] || 0) + +r.v; });
    const months = lastMonths(24), led = {};
    months.forEach(m => { led[m.key] = { rev: revMap[m.key] || 0, exp: exp[m.key] || {} }; });
    const hProj = {}, hQuote = {};
    ledger.projects.forEach(r => { hProj[r.m] = +r.v; }); ledger.quotes.forEach(r => { hQuote[r.m] = +r.v; });
    db = {
        quotes: quotes.filter(q => q.status !== 'Draft' || q.superadmin_comment).map(q => ({
            id: q.quotation_no, dbId: +q.quotation_id, client: q.customer, scope: q.project_title || 'Quotation ' + q.quotation_no, status: QSTATUS(q), serverStatus: q.status,
            date: ms(q.date_created), amount: +q.total_amount, notes: q.status === 'Draft' ? q.superadmin_comment || '' : '', sentAt: q.status !== 'Pending Superadmin' && q.status !== 'Draft' ? ms(q.sent_at || q.date_created) : null,
            validity: q.expiry_date ? Math.max(1, Math.min(30, Math.round((ms(q.expiry_date) - ms(String(q.date_created).slice(0, 10))) / 864e5))) : VALIDITY_DEFAULT, items: null })),
        projects: projects.map(p => ({ id: 'p' + p.project_id, dbId: +p.project_id, code: window.BW.prjNo(p.project_id), name: p.project_name || 'Project', client: p.customer,
            status: p.status === 'Done' ? 'completed' : p.status === 'Failed' ? 'hold' : 'active', start: ms(p.start_date || p.created_at) })),
        events: logs.filter(e => e.role !== 'customer').map(e => ({ id: +e.log_id, desc: e.action_type === 'LOGIN' ? (e.details || 'Signed in') : (EVENT_TEXT[e.action_type] || String(e.action_type).replace(/_/g, ' ').toLowerCase()) + (e.details ? ' ' + e.details : ''),
            name: e.user_name, user: roleOf(e.user_id), time: ms(e.timestamp), status: 'completed' })),
        ledger: led, sales: [], hProj, hQuote, accounts, receivables: ledger.receivables
    };
}
/* quotation lines are loaded when a quotation is opened */
async function loadQuote(x) {
    const d = await api('/admin/quotations/' + x.dbId);
    x.items = d.items.map(i => ({ product_id: +i.product_id, name: i.description, qty: +i.quantity, price: +i.unit_price, desc: i.product_description || i.category || '' }));
    x.charges = d.charges; x.transport = +d.other_charges_total; x.labor = +d.labor_total; x.noVat = +d.vat_amount === 0 && +d.total_amount > 0;
    x.laborLines = d.labor; x.address = d.site_address || d.installation_address; x.duration = d.duration; x.payTerms = d.payment_terms; x.incharge = d.project_incharge;
    x.scopeText = d.scope_of_work; x.quoteNotes = d.notes || ''; x.amount = +d.total_amount;
    return x;
}
function loadSettings() {
    const s = readJSON(SET_KEY, null);
    if (s) { ui.range = s.range || 6; ui.eventsShown = s.events || 5; ui.perPage = s.perPage || 5; }
}

const me = () => db.accounts.find(a => a.id === ME) || { name: profile.name, role: 'Super Admin' };
const activeProjects = () => db.projects.filter(p => p.status === 'active').length;
const pendingQuotes = () => db.quotes.filter(q => q.status === 'pending').length;
const salesIn = key => db.sales.filter(s => keyOf(new Date(s.ts)) === key);
const monthRevenue = key => r2(((db.ledger[key] || {}).rev || 0) + salesIn(key).reduce((a, s) => a + s.amount, 0));
function monthExpenses(key) {
    const base = (db.ledger[key] || {}).exp || {}, out = {};
    EXP_CATS.forEach(c => { out[c] = base[c] || 0; });
    out['Hardware / Supplies'] = r2(out['Hardware / Supplies'] + salesIn(key).reduce((a, s) => a + s.cost, 0));
    return out;
}
const monthExpTotal = key => r2(Object.values(monthExpenses(key)).reduce((a, b) => a + b, 0));
const curRevenue = () => monthRevenue(curKey());
function metricValue(metric, key) {
    if (key === curKey()) return metric === 'revenue' ? curRevenue() : metric === 'projects' ? activeProjects() : pendingQuotes();
    if (metric === 'revenue') return monthRevenue(key);
    return ((metric === 'projects' ? db.hProj : db.hQuote)[key]) || 0;
}


function toast(msg, type) {
    type = type || 'success';
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = `<i class="fa-solid ${type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check'}"></i> ${esc(msg)}`;
    $('toast-stack').appendChild(el);
    setTimeout(() => el.remove(), 3000);
}
/* reload everything from the server (the server already wrote the activity log entry) */
async function commit() {
    try { await load(); } catch (e) { toast(e.message, 'error'); }
    renderAll();
}
/* run a server action; shows the server's message if it refuses */
async function run(fn, okMsg) {
    try { await fn(); } catch (e) { if (e.status === 403) { toast('This browser is no longer signed in as the Super Admin (another account signed in on another tab). Please sign in again.', 'error'); setTimeout(() => window.BW.guard('superadmin'), 1800); return false; } toast(e.message, 'error'); return false; }
    await commit(); if (okMsg) toast(okMsg); return true;
}
function fmtTime(ts) {
    const d = new Date(ts), t = new Date(), y = new Date(); y.setDate(t.getDate() - 1);
    const day = d.toDateString() === t.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { main: `${day}, ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`, sub: fmtDate(ts) };
}
function ago(ts) {
    const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' mins ago';
    if (s < 86400) return Math.floor(s / 3600) + ' hours ago';
    return Math.floor(s / 86400) + ' days ago';
}
function downloadCSV(name, rows) {
    const q = v => '"' + String(v).replace(/"/g, '""') + '"';
    const url = URL.createObjectURL(new Blob(['\ufeff' + rows.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

function pager(id, st, total, noun, rerender) {
    const per = ui.perPage, pages = Math.max(1, Math.ceil(total / per));
    if (st.page > pages) st.page = pages;
    const start = (st.page - 1) * per, end = Math.min(start + per, total);
    let nums = '';
    for (let p = 1; p <= pages; p++) nums += `<button class="page-num ${p === st.page ? 'active' : ''}" data-page="${p}">${p}</button>`;
    const el = $(id);
    el.innerHTML = `<span class="pagination-info">SHOWING ${total ? start + 1 : 0}-${end} OF ${total} ${noun}</span>
        <div class="pagination-controls"><button class="page-btn" data-page="${st.page - 1}" ${st.page === 1 ? 'disabled' : ''}>Prev</button>${nums}
        <button class="page-btn" data-page="${st.page + 1}" ${st.page === pages ? 'disabled' : ''}>Next</button></div>`;
    el.onclick = e => { const b = e.target.closest('[data-page]'); if (b && !b.disabled) { st.page = parseInt(b.dataset.page, 10); rerender(); } };
}
const pageSlice = (list, st) => list.slice((st.page - 1) * ui.perPage, st.page * ui.perPage);

/* ===================== Dashboard ===================== */
function renderKPIs() {
    $('kpi-projects-val').textContent = activeProjects();
    const k = curKey(), added = db.projects.filter(p => keyOf(new Date(p.start)) === k).length;
    $('kpi-projects-sub').innerHTML = added ? `<i class="fa-solid fa-arrow-up"></i> +${added} this month` : 'No new projects this month';
    $('kpi-projects-sub').className = 'kpi-sub ' + (added ? 'up' : 'muted');
    const pq = pendingQuotes();
    $('kpi-quotes-val').textContent = pq;
    $('kpi-quotes-sub').innerHTML = pq ? '<i class="fa-solid fa-clock"></i> Requires review' : '<i class="fa-solid fa-circle-check"></i> All reviewed';
    $('kpi-quotes-sub').className = 'kpi-sub ' + (pq ? 'warn' : 'up');
    const cur = curRevenue(), prev = monthRevenue(lastMonths(2)[0].key), sub = $('kpi-revenue-sub');
    $('kpi-revenue-val').textContent = peso(cur);
    if (!prev) { sub.textContent = 'No previous month data'; sub.className = 'kpi-sub muted'; }
    else {
        const pct = (cur - prev) / prev * 100;
        sub.innerHTML = `<i class="fa-solid fa-arrow-${pct >= 0 ? 'up' : 'down'}"></i> ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% vs last month`;
        sub.className = 'kpi-sub ' + (pct >= 0 ? 'up' : 'down');
    }
}

const METRIC = {
    revenue: { fmt: peso, axis: v => v >= 1000 ? '₱' + (v / 1000) + 'k' : '₱' + v, color: '#2563eb', sub: 'Monthly incoming collections' },
    projects: { fmt: v => v + ' projects', axis: v => v, color: '#16a34a', sub: 'Active projects at month end' },
    quotes: { fmt: v => v + ' pending', axis: v => v, color: '#d97706', sub: 'Quotations waiting for review' }
};
let chartPts = [];
const CW = 720, CH = 260, PL = 52, PR = 18, PT = 18, PB = 32;

function renderStats() {
    const m = METRIC[ui.metric], months = lastMonths(ui.range), vals = months.map(x => metricValue(ui.metric, x.key));
    $('chart-subtitle').textContent = `${m.sub} · last ${ui.range} months`;
    const cur = vals[vals.length - 1], prev = vals.length > 1 ? vals[vals.length - 2] : 0;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length, peakI = vals.indexOf(Math.max(...vals));
    let chg = '—', cls = '';
    if (prev) { const p = (cur - prev) / prev * 100; chg = (p >= 0 ? '+' : '') + p.toFixed(1) + '%'; cls = p >= 0 ? 'up' : 'down'; }
    $('stat-tiles').innerHTML = `
        <div class="stat-tile"><span>CURRENT</span><strong>${m.fmt(cur)}</strong><small>${months[months.length - 1].full}</small></div>
        <div class="stat-tile"><span>AVERAGE</span><strong>${ui.metric === 'revenue' ? peso(avg) : avg.toFixed(1)}</strong><small>per month</small></div>
        <div class="stat-tile"><span>PEAK</span><strong>${m.fmt(vals[peakI])}</strong><small>${months[peakI].full}</small></div>
        <div class="stat-tile"><span>VS LAST MONTH</span><strong class="${cls}">${chg}</strong><small>change</small></div>`;
    const maxV = Math.max(...vals, 1);
    let top;
    if (ui.metric === 'revenue') {
        const raw = maxV * 1.1 / 4, mag = Math.pow(10, Math.floor(Math.log10(raw)));
        top = [1, 2, 2.5, 5, 10].map(k => k * mag).find(v => v >= raw) * 4;
    } else top = Math.max(4, Math.ceil(maxV * 1.1 / 4) * 4);
    const x = i => PL + (vals.length === 1 ? (CW - PL - PR) / 2 : i * (CW - PL - PR) / (vals.length - 1));
    const y = v => PT + (CH - PT - PB) * (1 - v / top), base = y(0);
    chartPts = vals.map((v, i) => ({ x: x(i), y: y(v), v, month: months[i] }));
    let svg = `<defs><linearGradient id="areaG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${m.color}" stop-opacity="0.28"/><stop offset="1" stop-color="${m.color}" stop-opacity="0"/></linearGradient></defs>`;
    for (let t = 0; t <= 4; t++) {
        const yy = y(top / 4 * t);
        svg += `<line x1="${PL}" x2="${CW - PR}" y1="${yy}" y2="${yy}" stroke="#94a3b8" stroke-opacity=".3" stroke-dasharray="${t === 0 ? '0' : '4 4'}"/>`;
        svg += `<text x="${PL - 8}" y="${yy + 3}" text-anchor="end" font-size="10" fill="#94a3b8">${m.axis(top / 4 * t)}</text>`;
    }
    let line = `M ${chartPts[0].x} ${chartPts[0].y}`;
    for (let i = 1; i < chartPts.length; i++) {
        const a = chartPts[i - 1], b = chartPts[i], mx = (a.x + b.x) / 2;
        line += ` C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
    }
    svg += `<path d="${line} L ${chartPts[chartPts.length - 1].x} ${base} L ${chartPts[0].x} ${base} Z" fill="url(#areaG)"/>`;
    svg += `<path d="${line}" fill="none" stroke="${m.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    chartPts.forEach((p, i) => {
        const last = i === chartPts.length - 1;
        svg += `<circle cx="${p.x}" cy="${p.y}" r="${last ? 5 : 3.5}" fill="#fff" stroke="${m.color}" stroke-width="2"/>`;
        svg += `<text x="${p.x}" y="${CH - 10}" text-anchor="middle" font-size="11" fill="${last ? m.color : '#94a3b8'}" font-weight="${last ? 700 : 500}">${p.month.label}</text>`;
    });
    svg += `<line id="hover-line" x1="0" x2="0" y1="${PT}" y2="${base}" stroke="${m.color}" stroke-opacity="0.35" stroke-dasharray="3 3" style="display:none"/>`;
    svg += `<circle id="hover-dot" r="6" fill="${m.color}" stroke="#fff" stroke-width="2" style="display:none"/>`;
    $('chart-svg').innerHTML = svg;
}
function chartHover(e) {
    if (!chartPts.length) return;
    const r = $('chart-svg').getBoundingClientRect(), vx = (e.clientX - r.left) / r.width * CW;
    let best = 0;
    chartPts.forEach((p, i) => { if (Math.abs(p.x - vx) < Math.abs(chartPts[best].x - vx)) best = i; });
    const p = chartPts[best], tip = $('chart-tip'), hl = $('hover-line'), hd = $('hover-dot');
    hl.setAttribute('x1', p.x); hl.setAttribute('x2', p.x); hl.style.display = '';
    hd.setAttribute('cx', p.x); hd.setAttribute('cy', p.y); hd.style.display = '';
    tip.innerHTML = `${METRIC[ui.metric].fmt(p.v)}<small>${p.month.full}</small>`;
    tip.style.left = (p.x / CW * r.width) + 'px'; tip.style.top = (p.y / CH * r.height) + 'px';
    tip.classList.add('show');
}
function chartLeave() {
    $('chart-tip').classList.remove('show');
    ['hover-line', 'hover-dot'].forEach(id => { const el = $(id); if (el) el.style.display = 'none'; });
}
function bar(label, count, total, cls) {
    const pct = total ? Math.round(count / total * 100) : 0;
    return `<div class="bd-row"><div class="bd-label"><span>${label}</span><span>${count} · ${pct}%</span></div><div class="bd-track"><div class="bd-fill ${cls}" style="width:${pct}%"></div></div></div>`;
}
function renderBreakdown() {
    const P = db.projects, Q = db.quotes, c = (arr, s) => arr.filter(x => x.status === s).length;
    const approved = c(Q, 'approved'), decided = approved + c(Q, 'rejected');
    $('breakdown').innerHTML =
        `<div class="breakdown-title">PROJECTS (${P.length})</div>` + bar('Active', c(P, 'active'), P.length, 'primary') + bar('Completed', c(P, 'completed'), P.length, 'success') + bar('On Hold', c(P, 'hold'), P.length, 'warning') +
        `<div class="bd-divider"></div><div class="breakdown-title">QUOTATIONS (${Q.length}) · APPROVAL RATE ${decided ? Math.round(approved / decided * 100) + '%' : '—'}</div>` +
        bar('Pending', c(Q, 'pending'), Q.length, 'warning') + bar('Approved', approved, Q.length, 'success') + bar('Rejected', c(Q, 'rejected'), Q.length, 'danger');
}
function renderEvents() {
    const rows = db.events.slice(0, ui.eventsShown);
    $('events-tbody').innerHTML = rows.length ? rows.map(e => `<tr>
        <td><span class="req-id">#EVT-${e.id}</span></td><td>${esc(e.desc)}</td><td>${esc(e.user)}</td><td>${fmtTime(e.time).main}</td>
        <td class="text-right"><span class="status-badge completed"><i class="fa-solid fa-circle-check"></i> Success</span></td></tr>`).join('') : emptyRow(5, 'No recent operations.');
}


function renderRevenueModal() {
    $('rev-list').innerHTML = lastMonths(12).reverse().map((m, i) => `
        <div class="item-row"><div class="item-info"><strong>${m.full}</strong><span>${i === 0 ? 'Current month' : ''}</span></div>
        <div class="item-actions"><strong style="font-size:13px;">${peso(monthRevenue(m.key))}</strong></div></div>`).join('');
}



/* ===================== Quotations ===================== */
const QBADGE = {
    pending: '<span class="status-badge pending"><i class="fa-solid fa-clock"></i> Pending</span>',
    approved: '<span class="status-badge approved"><i class="fa-solid fa-circle-check"></i> Approved</span>',
    rejected: '<span class="status-badge rejected"><i class="fa-solid fa-circle-xmark"></i> Rejected</span>'
};
const QLABEL = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };
function renderQuotes() {
    const term = ui.q.search.toLowerCase();
    const searched = db.quotes.filter(x => (x.id + ' ' + x.client + ' ' + x.scope + ' ' + fmtDate(x.date) + ' ' + x.amount).toLowerCase().includes(term));
    const cnt = s => s === 'all' ? searched.length : searched.filter(x => x.status === s).length;
    $('q-tabs').innerHTML = ['all', 'pending', 'approved', 'rejected'].map(s =>
        `<button class="seg-btn ${ui.q.status === s ? 'active' : ''}" data-qs="${s}" role="tab">${s === 'all' ? 'All' : QLABEL[s]}<b>${cnt(s)}</b></button>`).join('');
    const list = searched.filter(x => ui.q.status === 'all' || x.status === ui.q.status).sort((a, b) => b.date - a.date);
    const pages = Math.max(1, Math.ceil(list.length / ui.perPage));
    if (ui.q.page > pages) ui.q.page = pages;
    $('q-tbody').innerHTML = list.length ? pageSlice(list, ui.q).map(x => {
        const view = `<button class="icon-action" title="View quotation" data-qact="view" data-id="${x.id}"><i class="fa-solid fa-eye"></i></button>`;
        const actions = x.status === 'approved'
            ? view + (x.sentAt
                ? `<button class="icon-action success" title="Sent to customer on ${fmtDate(x.sentAt)}" disabled><i class="fa-solid fa-check-double"></i></button>`
                : `<button class="icon-action send" title="Send to customer" data-qact="send" data-id="${x.id}"><i class="fa-solid fa-paper-plane"></i></button>`)
            : x.status === 'rejected' ? view
            : view + `<button class="icon-action success" title="Approve" data-qact="approve" data-id="${x.id}"><i class="fa-solid fa-check"></i></button>
               <button class="icon-action revision" title="Edit quotation" data-qact="revise" data-id="${x.id}"><i class="fa-solid fa-pen-to-square"></i></button>
               <button class="icon-action delete" title="Reject" data-qact="reject" data-id="${x.id}"><i class="fa-solid fa-xmark"></i></button>`;
        const note = x.status === 'rejected' && x.notes ? `<div class="note-line">${esc(x.notes)}</div>`
            : x.status === 'rejected' ? '<div class="note-line">Returned to the admin for changes</div>'
        : x.status === 'approved' ? `<div class="note-line">${x.sentAt ? 'Sent to customer · ' + fmtDate(x.sentAt) : 'Not yet sent to customer'}</div>` : '';
        return `<tr><td><span class="req-id">#${x.id}</span></td>
            <td><div class="client-cell">${badge(x.client)}<div class="client-info"><strong>${esc(x.client)}</strong><span>Project: ${esc(x.scope)}</span></div></div></td>
            <td>${fmtDate(x.date)}</td><td><strong>${peso(x.amount)}</strong></td><td>${QBADGE[x.status]}${note}</td>
            <td class="text-right"><div class="action-icons">${actions}</div></td></tr>`;
    }).join('') : emptyRow(6, 'No quotations match your search or filter.');
    pager('q-pager', ui.q, list.length, 'QUOTATIONS', renderQuotes);
}
function closePanels() { $('panel-revision').classList.remove('active'); $('panel-reject').classList.remove('active'); ui.activeQuote = null; }
const quoteById = id => db.quotes.find(q => q.id === id);
/* Quotation document: same letterhead + table template the admin side uses */
const ITEM_DESC = {
    '16-Channel DVR': 'Recorders & Storage', '8-Channel DVR': 'Recorders & Storage', '1TB Surveillance HDD': 'Recorders & Storage',
    'IP Camera (Dome)': 'Cameras', 'IP Camera (Bullet)': 'Cameras', 'Wi-Fi Indoor Camera': 'Cameras',
    'Power Adapter & Connectors': 'Power & Cabling', 'PoE Switch 8-Port': 'Power & Cabling', 'Cat6 Cable (305m Box)': 'Power & Cabling', 'UPS 650VA': 'Power & Cabling',
    'Fingerprint Door Lock': 'Access Control', 'Gate Access Controller': 'Access Control', 'Video Doorbell': 'Access Control',
    'Cabling & Installation': 'Labor and materials for cabling and mounting', 'System Configuration & Commissioning': 'Setup, testing and customer handover'
};
const CLIENT_ADDR = {
    'Apex Inc.': 'Rizal Ave., Caloocan City', 'Nova Retail': 'EDSA, Quezon City', 'Orion Clinic': 'Taft Ave., Manila',
    'Vortex Logistics': 'MacArthur Hwy., Valenzuela City', 'Helios Tower': 'Ayala Ave., Makati City', 'Atlas Factory': 'C-5 Road, Pasig City',
    'Harbor Hotel': 'Roxas Blvd., Pasay City', 'Zenith School': 'Katipunan Ave., Quezon City'
};
function quoteDocHTML(x) {
    const t = quoteCalc(x), adj = r2(x.amount - t.total), vd = x.validity || VALIDITY_DEFAULT;
    const rows = (x.items || []).map(i => ({ qty: i.qty + (i.qty > 1 ? ' pcs' : ' pc'), name: i.name, desc: i.desc || ITEM_DESC[i.name] || '', unit: i.price, amt: i.qty * i.price }));
    if (t.tr > 0) rows.push({ qty: '1 lot', name: 'Extra expenses', desc: '', unit: t.tr, amt: t.tr });
    (x.laborLines || []).forEach(w => rows.push({ qty: w.workers + ' pax', name: 'Labor: ' + w.role, desc: w.days + ' day(s) @ ' + peso(w.daily_rate) + ' per day', unit: w.days * w.daily_rate, amt: +w.amount }));
    const rowHTML = r => `<tr><td class="c">${esc(r.qty)}</td><td><b>${esc(r.name)}</b></td><td class="d">${esc(r.desc)}</td><td class="r">${peso(r.unit)}</td><td class="r">${peso(r.amt)}</td></tr>`;
    const table = list => `<table class="qd-tbl"><thead><tr><th>QTY</th><th>PRODUCT / SERVICE</th><th>DESCRIPTION</th><th class="r">UNIT PRICE</th><th class="r">AMOUNT</th></tr></thead><tbody>${list.map(rowHTML).join('') || '<tr><td colspan="5" class="c">No items listed.</td></tr>'}</tbody></table>`;
    const head = `<div class="qd-lh"><div class="wm">Beyond<span>wires</span></div><div class="sub">SECURITY SYSTEM SERVICES</div>
        <p>Rosal St., Tala, Caloocan City | beyondwires.info@gmail.com | +63945-329-6845<br>DTI-BRN: 6145128 | NON-VAT TIN: 421-649-525</p></div>
        <div class="qd-top"><span>${fmtDate(x.date)}</span><span>Quotation No. <b>${esc(x.id)}</b></span></div>
        <p class="qd-intro"><b>Dear Ma'am/Sir,</b><br>Thank you for your interest in doing business with BEYONDWIRES SECURITY SYSTEM SERVICES. Below are the items and overall price we curated for you.</p>
        <div class="qd-info"><div><span>Customer Name</span><b>${esc(x.client)}</b></div><div><span>Address</span><b>${esc(x.address || CLIENT_ADDR[x.client] || '—')}</b></div>
        <div><span>Project</span><b>${esc(x.scope)}</b></div><div><span>Scope of work</span><em>${esc(x.scopeText || 'Scope of work: supply and installation of CCTV and related accessories, including testing and commissioning.')}</em></div></div>`;
    const cont = `<div class="qd-lh slim"><div class="wm">Beyond<span>wires</span></div><span>Quotation ${esc(x.id)} (continued)</span></div>`;
    const notes = ['Prices are based on the items listed above. Changes in scope will be quoted separately.']
        .concat(String(x.quoteNotes || '').split('\n').map(s => s.trim()).filter(Boolean));
    const closing = `<div class="qd-totals"><div><span>Subtotal</span><b>${peso(t.sub + t.tr + t.lab)}</b></div><div><span>VAT (12%)</span><b>${peso(t.vat)}</b></div>
        ${Math.abs(adj) > 0.009 ? `<div><span>Price adjustment</span><b>${peso(adj)}</b></div>` : ''}<div class="g"><span>TOTAL PROJECT COST</span><b>${peso(x.amount)}</b></div></div>
        <div class="qd-meta"><div><span>Project Duration</span>${esc(x.duration || 'To be confirmed after site assessment')}</div>
        <div><span>Terms of Payment</span>Half payment upon quotation or Full payment upon quotation (chosen by the customer upon approval)</div>
        <div><span>Validity</span>${vd} day${vd === 1 ? '' : 's'} from the date issued (until ${fmtDate(x.date + vd * 864e5)})</div></div>
        <ul class="qd-notes">${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
        <div class="qd-sign2"><div><small>Project In-charge:</small><u>${esc(x.incharge || profile.name)}</u><span>BeyondWires Representative</span></div>
        <div><small>Conformé:</small><u></u><span>${esc(x.client)} Representative</span></div></div>`;
    const pages = []; let rest = rows.slice(), first = true;
    for (;;) {
        const withClose = first ? 7 : 13, noClose = first ? 14 : 21;
        if (rest.length <= withClose) { pages.push((first ? head : cont) + table(rest) + closing); break; }
        const n = Math.min(noClose, rest.length - 1);
        pages.push((first ? head : cont) + table(rest.slice(0, n))); rest = rest.slice(n); first = false;
    }
    return '<div class="qd-scale">' + pages.map((p, i) => `<div class="qd-page qd-q">${p}<div class="qd-foot">Page ${i + 1} of ${pages.length}</div></div>`).join('') + '</div>';
}
async function viewQuote(id) {
    const x = quoteById(id); if (!x) return;
    try { await loadQuote(x); } catch (e) { return toast(e.message, 'error'); }
    $('qv-title').textContent = 'Quotation #' + x.id;
    $('qv-sub').innerHTML = QBADGE[x.status] + ' &nbsp;' + esc(x.client) + ' · ' + peso(x.amount);
    $('qv-docs').innerHTML = quoteDocHTML(x); $('qv-docs').scrollLeft = 0;
    $('qv-note').hidden = !x.notes; $('qv-note').textContent = x.notes ? 'Your comment: ' + x.notes : '';
    $('qv-send').hidden = !(x.status === 'approved' && !x.sentAt); $('qv-send').dataset.id = x.id;
    openModal('modal-viewquote');
}
/* Approving sends the quotation straight to the customer (the server publishes it and notifies the customer and the admin). */
function approveQuote(id) {
    closePanels();
    const x = quoteById(id); if (!x) return;
    run(() => api('/owner/quotations/' + x.dbId + '/approve', { body: {} }), `Quotation #${id} approved and sent to ${x.client}.`);
}
function sendQuote(id) {
    const x = quoteById(id); if (!x) return;
    toast(x.sentAt ? `Quotation #${id} was sent to the customer on ${fmtDate(x.sentAt)}` : `Approve quotation #${id} to send it to the customer`, x.sentAt ? 'success' : 'error');
}
/* ---- edit validation ---- */
function revIssue(f, v) {
    if (f === 'qty') {
        if (!Number.isInteger(v)) return 'Enter a whole number';
        if (v < QTY_MIN) return 'Minimum is ' + QTY_MIN;
        if (v > QTY_MAX) return 'Maximum is ' + QTY_MAX + ' per item';
    } else if (f === 'price') {
        if (!isFinite(v)) return 'Enter a unit price';
        if (v < PRICE_MIN) return 'Minimum is ' + peso(PRICE_MIN);
        if (v > PRICE_MAX) return 'Maximum is ' + peso(PRICE_MAX);
        if (Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) return 'Use up to 2 decimal places';
    } else if (f === 'transport') {
        if (!isFinite(v) || v < 0) return 'Cannot be negative';
        if (v > EXP_MAX) return 'Maximum is ' + peso(EXP_MAX);
        if (Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) return 'Use up to 2 decimal places';
    } else if (f === 'validity') {
        if (!Number.isInteger(v)) return 'Enter whole days';
        if (v < VALIDITY_MIN || v > VALIDITY_MAX) return 'Must be ' + VALIDITY_MIN + ' to ' + VALIDITY_MAX + ' days';
    }
    return '';
}
const numVal = el => el.value.trim() === '' ? NaN : Number(el.value);
function markField(input, msg) {
    input.classList.toggle('invalid', !!msg);
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    const field = input.closest('.field'); if (!field) return;
    let el = field.querySelector('.rv-err');
    if (!el) { el = document.createElement('small'); el.className = 'rv-err'; field.appendChild(el); }
    el.textContent = msg || '';
}
async function openRevision(id) {
    const x = quoteById(id); if (!x) return;
    try { await loadQuote(x); } catch (e) { return toast(e.message, 'error'); }
    ui.activeQuote = id; $('panel-reject').classList.remove('active');
    ui.draft = { items: (x.items || []).map(i => ({ product_id: i.product_id, name: i.name, qty: i.qty, price: i.price })), transport: x.transport || 0, labor: x.labor || 0, noVat: x.noVat };
    $('rev-title').textContent = 'Edit Quotation: #' + id;
    $('rev-transport').value = ui.draft.transport || '';
    $('rev-validity').value = x.validity || VALIDITY_DEFAULT;
    ['rev-transport', 'rev-validity'].forEach(k => markField($(k), ''));
    $('rev-notes').value = x.quoteNotes || ''; $('rev-notes').maxLength = 400;
    renderRevItems();
    $('panel-revision').classList.add('active');
    $('panel-revision').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function renderRevItems() {
    $('rev-items').innerHTML = `<label style="display:block;font-size:11px;font-weight:700;margin-bottom:6px">LINE ITEMS (QUANTITY ${QTY_MIN}&ndash;${QTY_MAX} / UNIT PRICE ${peso(PRICE_MIN)}&ndash;${peso(PRICE_MAX)})</label>` +
        ui.draft.items.map((it, i) => `<div class="form-row" style="align-items:flex-start;margin-bottom:6px"><div class="field" style="flex:2"><input type="text" value="${esc(it.name)}" disabled></div><div class="field" style="flex:.6"><input type="number" min="${QTY_MIN}" max="${QTY_MAX}" step="1" data-rv="qty" data-i="${i}" value="${it.qty}" aria-label="Quantity"></div><div class="field" style="flex:1"><input type="number" min="${PRICE_MIN}" max="${PRICE_MAX}" step="0.01" data-rv="price" data-i="${i}" value="${it.price}" aria-label="Unit price"></div></div>`).join('');
    updateRevTotals();
}
function updateRevTotals() {
    const t = quoteCalc({ items: ui.draft.items.map(i => ({ qty: +i.qty || 0, price: +i.price || 0 })), transport: +ui.draft.transport || 0, labor: ui.draft.labor });   // the server adds VAT on save
    $('rev-totals').innerHTML = `Subtotal: <b>${peso(t.sub)}</b> &nbsp;|&nbsp; Transport: <b>${peso(t.tr)}</b>${t.lab ? ` &nbsp;|&nbsp; Labor: <b>${peso(t.lab)}</b>` : ''} &nbsp;|&nbsp; VAT (12%): <b>${peso(t.vat)}</b> &nbsp;|&nbsp; New total: <b>${peso(t.total)}</b>`;
}
function openReject(id) {
    const x = quoteById(id); if (!x) return;
    ui.activeQuote = id; $('panel-revision').classList.remove('active');
    $('rej-title').textContent = 'Reject with Feedback: #' + id;
    $('rej-notes').value = ''; $('rej-notes').maxLength = 400; markField($('rej-notes'), '');
    $('panel-reject').classList.add('active');
    $('panel-reject').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function submitRevision() {
    const x = quoteById(ui.activeQuote); if (!x || !ui.draft) return;
    const issues = [];
    $$('#rev-items [data-rv]').forEach(inp => {
        const it = ui.draft.items[+inp.dataset.i], m = revIssue(inp.dataset.rv, numVal(inp));
        markField(inp, m); if (m) issues.push(it.name + ': ' + m);
    });
    const trIn = $('rev-transport'), tr = trIn.value.trim() === '' ? 0 : Number(trIn.value), trMsg = revIssue('transport', tr);
    markField(trIn, trMsg); if (trMsg) issues.push('Transport / other expenses: ' + trMsg);
    const vIn = $('rev-validity'), validity = numVal(vIn), vMsg = revIssue('validity', validity);
    markField(vIn, vMsg); if (vMsg) issues.push('Validity: ' + vMsg);
    const notesTxt = $('rev-notes').value.trim();
    if (notesTxt.length > 400) issues.push('Terms / scope notes: 400 characters or fewer');
    if (notesTxt.split('\n').length > 8) issues.push('Terms / scope notes: at most 8 lines');
    if (issues.length) { toast(issues[0] + (issues.length > 1 ? ` (+${issues.length - 1} more)` : ''), 'error'); return; }
    const same = ui.draft.items.every((it, i) => x.items[i] && +it.qty === +x.items[i].qty && Math.abs(+it.price - +x.items[i].price) < 0.009) &&
        Math.abs(r2(tr) - r2(x.transport || 0)) < 0.009 && validity === (x.validity || VALIDITY_DEFAULT) && notesTxt === String(x.quoteNotes || '').trim();
    if (same) { toast('No changes to save', 'error'); return; }
    /* unchanged extra expenses keep the admin's itemised list; a new amount becomes one "Extra expenses" line */
    const charges = Math.abs(r2(tr) - r2(x.transport || 0)) < 0.009 ? (x.charges || []).map(c => ({ label: c.label, amount: +c.amount })) : (tr > 0 ? [{ label: 'Extra expenses', amount: r2(tr) }] : []);
    const body = { items: ui.draft.items.map(i => ({ product_id: i.product_id, quantity: Math.round(i.qty), unit_price: r2(i.price) })), charges, validity_days: validity, notes: $('rev-notes').value.trim() };
    const id = x.id; closePanels();
    run(() => api('/owner/quotations/' + x.dbId, { method: 'PUT', body }), `Quotation #${id} updated`);
}
function submitRejection() {
    const x = quoteById(ui.activeQuote); if (!x) return;
    const notes = $('rej-notes').value.trim();
    /* strict: feedback is required when the reason is "Other", and must be meaningful and not too long */
    if (/^Other/.test($('rej-reason').value) && notes.length < 10) { markField($('rej-notes'), 'Explain the reason (at least 10 characters)'); return toast('Explain the reason for rejecting (at least 10 characters)', 'error'); }
    if (notes && notes.length < 10) { markField($('rej-notes'), 'At least 10 characters'); return toast('Feedback must be at least 10 characters', 'error'); }
    if (notes.length > 400) { markField($('rej-notes'), '400 characters or fewer'); return toast('Feedback must be 400 characters or fewer', 'error'); }
    markField($('rej-notes'), '');
    const comment = $('rej-reason').value + (notes ? ': ' + notes : '');
    const id = x.id; closePanels();
    run(() => api('/owner/quotations/' + x.dbId + '/reject', { body: { comment } }), `Quotation #${id} returned to the admin with your feedback`);
}

/* ===================== Projects ===================== */
const PSTATUS = {
    active: '<span class="status-badge progress">Active</span>',
    completed: '<span class="status-badge completed">Completed</span>',
    hold: '<span class="status-badge hold">On Hold</span>'
};
function projFiltered(ignoreStatus) {
    const t = ui.p.search.toLowerCase();
    const from = ui.p.from ? new Date(ui.p.from + 'T00:00:00').getTime() : -Infinity;
    const to = ui.p.to ? new Date(ui.p.to + 'T23:59:59').getTime() : Infinity;
    return db.projects.filter(p => (p.code + ' ' + p.client + ' ' + p.name + ' ' + fmtDate(p.start)).toLowerCase().includes(t)
        && p.start >= from && p.start <= to && (ignoreStatus || ui.p.status === 'all' || p.status === ui.p.status));
}
function renderProjectsTab() {
    const base = projFiltered(true), c = s => base.filter(p => p.status === s).length;
    $('p-counts').innerHTML = `<div class="count-chip"><span>TOTAL PROJECTS</span><strong>${base.length}</strong></div>
        <div class="count-chip active"><span>ACTIVE</span><strong>${c('active')}</strong></div>
        <div class="count-chip completed"><span>COMPLETED</span><strong>${c('completed')}</strong></div>
        <div class="count-chip hold"><span>ON HOLD</span><strong>${c('hold')}</strong></div>`;
    const list = projFiltered(false), pages = Math.max(1, Math.ceil(list.length / ui.perPage));
    if (ui.p.page > pages) ui.p.page = pages;
    $('p-tbody').innerHTML = list.length ? pageSlice(list, ui.p).map(p => `<tr>
        <td><span class="req-id">#${esc(p.code)}</span></td>
        <td><div class="client-cell">${badge(p.client)}<div class="client-info"><strong>${esc(p.client)}</strong><span>${esc(p.name)}</span></div></div></td>
        <td>${fmtDate(p.start)}</td><td>${PSTATUS[p.status] || ''}</td></tr>`).join('') : emptyRow(4, 'No projects match your filters.');
    pager('p-pager', ui.p, list.length, 'PROJECTS', renderProjectsTab);
}

/* ===================== Financial (computed from the ledger + approved quotations) ===================== */
const FIN_COLORS = ['#1e293b', '#2563eb', '#10b981', '#f59e0b', '#64748b'];
const FSORT = [
    ['default', 'Newest first'], ['rev-desc', 'Gross Revenue: highest to lowest'], ['rev-asc', 'Gross Revenue: lowest to highest'],
    ['exp-desc', 'Expenses: highest to lowest'], ['exp-asc', 'Expenses: lowest to highest'],
    ['net-desc', 'Net Profit: highest to lowest'], ['net-asc', 'Net Profit: lowest to highest'],
    ['margin-desc', 'Margin: highest to lowest'], ['margin-asc', 'Margin: lowest to highest']
];
let finSort = 'default', finPeriod = 'YTD', finReady = false, finCharts = [];
const pesoK = v => '₱' + (Math.abs(v) >= 1000 ? Math.round(v / 1000).toLocaleString('en-US') + 'k' : Math.round(v));
const shiftKey = (k, n) => { const [y, m] = k.split('-').map(Number); return keyOf(new Date(y, m - 1 - n, 1)); };
/* months (YYYY-MM) in a period of the current year, up to this month */
function periodMonths(p) {
    const now = new Date(), y = now.getFullYear(), cur = now.getMonth();
    const span = { Q1: [0, 2], Q2: [3, 5], Q3: [6, 8], Q4: [9, 11], YTD: [0, cur] }[p] || [0, cur];
    const out = [];
    for (let m = span[0]; m <= Math.min(span[1], cur); m++) out.push(y + '-' + String(m + 1).padStart(2, '0'));
    return out;
}
function periodTotals(keys) {
    const cats = {}; EXP_CATS.forEach(c => { cats[c] = 0; });
    let rev = 0;
    keys.forEach(k => { rev += monthRevenue(k); const e = monthExpenses(k); EXP_CATS.forEach(c => { cats[c] += e[c]; }); });
    const exp = Object.values(cats).reduce((a, b) => a + b, 0);
    return { rev: r2(rev), exp: r2(exp), net: r2(rev - exp), cats };
}
const pctChange = (a, b) => b ? (a - b) / Math.abs(b) * 100 : null;
function setTrend(id, pct, goodWhenUp) {
    const el = $(id);
    if (pct == null) { el.className = 'kpi-trend'; el.textContent = 'New'; return; }
    const up = pct >= 0;
    el.className = 'kpi-trend ' + (up === goodWhenUp ? 'positive' : 'negative');
    el.innerHTML = `<i class="fa-solid fa-arrow-${up ? 'up' : 'down'}"></i> ${Math.abs(pct).toFixed(1)}%`;
}
function finTotalsNow() {
    const keys = periodMonths(finPeriod), cur = periodTotals(keys);
    const prevKeys = keys.map(k => shiftKey(k, finPeriod === 'YTD' ? 12 : 3)).filter(k => db.ledger[k]);
    return { cur, prev: prevKeys.length === keys.length ? periodTotals(prevKeys) : null };
}
function renderFinance() {
    const { cur, prev } = finTotalsNow();
    $('fin-revenue').textContent = peso(cur.rev); $('fin-expenses').textContent = peso(cur.exp); $('fin-profit').textContent = peso(cur.net);
    setTrend('fin-rev-trend', prev && pctChange(cur.rev, prev.rev), true);
    setTrend('fin-exp-trend', prev && pctChange(cur.exp, prev.exp), false);
    setTrend('fin-profit-trend', prev && pctChange(cur.net, prev.net), true);
    $('fin-rev-prev').textContent = prev ? 'vs ' + peso(prev.rev) + ' last period' : 'No earlier period to compare';
    $('fin-exp-prev').textContent = prev ? 'vs ' + peso(prev.exp) + ' last period' : 'No earlier period to compare';
    const margin = cur.rev ? cur.net / cur.rev * 100 : 0;
    $('fin-margin').textContent = 'Profit Margin: ' + margin.toFixed(1) + '%';
    $('fin-health').textContent = margin >= 40 ? 'Excellent' : margin >= 25 ? 'Good' : margin >= 10 ? 'Fair' : 'Weak';
    $('fin-health-bar').style.width = Math.max(4, Math.min(100, margin * 2)) + '%';
    const t = prev ? pctChange(cur.net, prev.net) : null;
    $('fin-health-tag').textContent = t == null ? 'Stable' : t > 5 ? 'Improving' : t < -5 ? 'Declining' : 'Stable';
    $('fin-donut-legend').innerHTML = EXP_CATS.map((c, i) => `<div class="legend-row"><span><span class="dot" style="background:${FIN_COLORS[i]}"></span> ${c}</span><strong>${pesoK(cur.cats[c])}</strong></div>`).join('');
    $$('#fin-period .filter-tab').forEach(b => { b.classList.toggle('active', b.dataset.period === finPeriod); b.disabled = !periodMonths(b.dataset.period).length; });
    renderFinTable(); updateFinCharts(cur);
}
/* last 12 months, newest first */
function finData() {
    return lastMonths(12).reverse().map((m, i) => {
        const rev = monthRevenue(m.key), exp = monthExpTotal(m.key);
        return { i, m: m.full, rev, exp, net: r2(rev - exp), margin: rev ? (rev - exp) / rev * 100 : 0 };
    });
}
const finRows = () => {
    const rows = finData();
    if (finSort === 'default') return rows;
    const [k, d] = finSort.split('-');
    return rows.sort((a, b) => d === 'desc' ? b[k] - a[k] : a[k] - b[k]);
};
function renderFinTable() {
    $('fin-tbody').innerHTML = finRows().map(r => `<tr><td><strong>${r.m}</strong></td><td>${peso(r.rev)}</td><td class="text-danger">${peso(r.exp)}</td><td class="text-success bold">${peso(r.net)}</td><td><span class="badge-soft">${r.margin.toFixed(1)}%</span></td></tr>`).join('');
    $('fin-sort-menu').innerHTML = '<span class="menu-label" style="display:block;padding:6px 16px">SORT BY</span>' +
        FSORT.map(o => `<button class="menu-btn ${o[0] === finSort ? 'on' : ''}" data-fsort="${o[0]}">${o[1]}</button>`).join('');
    $('fin-sort-label').textContent = finSort === 'default' ? 'Filter' : FSORT.find(o => o[0] === finSort)[1].split(':')[0] + (finSort.endsWith('desc') ? ' ↓' : ' ↑');
}
function exportFinReport() {
    const { cur } = finTotalsNow();
    const rows = [['BEYOND WIRES - FINANCIAL REPORT'], ['Period', finPeriod + ' ' + new Date().getFullYear()], ['Generated', new Date().toLocaleString()], ['Prepared by', profile.name], [],
        ['SUMMARY'], ['Total Revenue', cur.rev], ['Total Expenses', cur.exp], ['Net Profit', cur.net], [],
        ['EXPENSE BREAKDOWN'], ['Category', 'Amount']].concat(EXP_CATS.map(c => [c, r2(cur.cats[c])])).concat([[],
        ['MONTHLY PERFORMANCE (LAST 12 MONTHS)'], ['Month', 'Gross Revenue', 'Operating Expenses', 'Net Profit', 'Margin %']])
        .concat(finRows().map(r => [r.m, r.rev, r.exp, r.net, r.margin.toFixed(1) + '%']));
    downloadCSV(`financial-report-${finPeriod}.csv`, rows);
    toast('Financial report downloaded');
}
function finChartData() {
    const ms = lastMonths(12);
    return { labels: ms.map(m => m.label), rev: ms.map(m => Math.round(monthRevenue(m.key) / 1000)), exp: ms.map(m => Math.round(monthExpTotal(m.key) / 1000)) };
}
function updateFinCharts(tot) {
    if (finCharts.length < 2) return;
    const d = finChartData(), [tr, dn] = finCharts;
    tr.data.labels = d.labels; tr.data.datasets[0].data = d.rev; tr.data.datasets[1].data = d.exp; tr.update();
    dn.data.datasets[0].data = EXP_CATS.map(c => Math.round(tot.cats[c] / 1000)); dn.update();
}
function initFinance() {
    if (typeof Chart === 'undefined') return;
    if (finReady) { finCharts.forEach(c => c.resize()); return; }
    finReady = true;
    const d = finChartData();
    finCharts.push(new Chart($('trendChart'), {
        type: 'line',
        data: {
            labels: d.labels,
            datasets: [
                { label: 'Revenue', data: d.rev, borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.05)', borderWidth: 3, tension: 0.35, fill: true, pointRadius: 3, pointBackgroundColor: '#2563eb' },
                { label: 'Expenses', data: d.exp, borderColor: '#ef4444', backgroundColor: 'transparent', borderWidth: 2, tension: 0.35, pointRadius: 3, pointBackgroundColor: '#ef4444' }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.dataset.label + ': ₱' + c.parsed.y + 'k' } } },
            scales: { y: { beginAtZero: true, grid: { color: 'rgba(148,163,184,.2)' }, ticks: { callback: v => '₱' + v + 'k', color: '#94a3b8', font: { size: 11 } } }, x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 11 } } } }
        }
    }));
    finCharts.push(new Chart($('expenseDonutChart'), {
        type: 'doughnut',
        data: { labels: EXP_CATS, datasets: [{ data: EXP_CATS.map(() => 0), backgroundColor: FIN_COLORS, borderWidth: 2, borderColor: '#ffffff' }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '72%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.label + ': ₱' + c.parsed + 'k' } } } }
    }));
    updateFinCharts(finTotalsNow().cur);
}

/* ===================== Activity ===================== */
function avatar(name) {
    let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56"><rect width="56" height="56" fill="hsl(${h},55%,48%)"/><text x="50%" y="54%" font-family="Arial" font-size="22" font-weight="700" fill="#fff" text-anchor="middle" dominant-baseline="middle">${esc(initials(name))}</text></svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
const userCell = (name, sub, extra) => `<div class="user-cell"><div class="avatar-wrap"><img class="user-avatar" src="${avatar(name)}" alt=""></div>
    <div class="user-details"><strong>${esc(name)}${extra || ''}</strong><span>${esc(sub)}</span></div></div>`;

function renderLog() {
    const sel = $('l-admin'), roles = db.accounts.map(a => a.role).sort();
    sel.innerHTML = '<option value="all">All Administrators</option>' + roles.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
    if (!roles.includes(ui.l.admin)) ui.l.admin = 'all';
    sel.value = ui.l.admin;
    const q = ui.l.search.toLowerCase();
    const list = db.events.filter(e => (ui.l.admin === 'all' || e.user === ui.l.admin) && (!q || (e.desc + ' ' + e.name + ' ' + e.user).toLowerCase().includes(q)));
    $('l-tbody').innerHTML = list.length ? pageSlice(list, ui.l).map(e => {
        const t = fmtTime(e.time);
        return `<tr><td>${userCell(e.name || e.user, e.user)}</td><td>${esc(e.desc)}</td><td><div class="timestamp-cell"><strong>${t.main}</strong><span>${t.sub}</span></div></td></tr>`;
    }).join('') : emptyRow(3, 'No activity matches your search or filter.');
    pager('l-pager', ui.l, list.length, 'ACTIVITIES', renderLog);
}
function renderAccounts() {
    const list = db.accounts, pages = Math.max(1, Math.ceil(list.length / ui.perPage));
    if (ui.a.page > pages) ui.a.page = pages;
    $('a-tbody').innerHTML = pageSlice(list, ui.a).map(a => {
        const t = fmtTime(a.lastActivity), self = a.id === ME;
        return `<tr><td>${userCell(a.name, a.email, self ? '<span class="you-tag">YOU</span>' : '')}</td><td>${esc(a.role)}</td>
            <td><div class="timestamp-cell"><strong>${t.main}</strong><span>${t.sub}</span></div></td>
            <td class="text-right"><button class="icon-btn" data-del="${a.id}" ${self ? 'disabled title="You cannot delete your own account"' : 'title="Delete account"'}><i class="fa-solid fa-trash-can"></i></button></td></tr>`;
    }).join('');
    pager('a-pager', ui.a, list.length, 'ACCOUNTS', renderAccounts);
    TABS.activity.sub = `${db.events.length} logged activities · ${db.accounts.length} administrator accounts`;
    if (ui.tab === 'activity') $('page-sub').textContent = TABS.activity.sub;
}
const validName = v => /^\p{L}+(?:[\s.'-]\p{L}+)*$/u.test(v);
const validEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const validPass = v => v.length >= 8 && v.length <= 64 && /\d/.test(v) && /[A-Za-z]/.test(v) && !/\s/.test(v);   // 8-64 characters, a letter and a number, no spaces
function nextAdminRole() {
    const n = db.accounts.reduce((m, a) => Math.max(m, parseInt((a.role.match(/(\d+)$/) || [0, 0])[1], 10)), 0) + 1;
    return 'Administrator ' + n;
}
function openAdd() {
    ['add-name', 'add-email', 'add-pass'].forEach(i => $(i).value = '');
    ['fg-name', 'fg-email', 'fg-pass'].forEach(i => $(i).classList.remove('invalid'));
    openModal('modal-add'); setTimeout(() => $('add-name').focus(), 50);
}
function submitAdd() {
    const name = $('add-name').value.trim().replace(/\s+/g, ' '), email = $('add-email').value.trim(), pass = $('add-pass').value;
    const okE = validEmail(email) && email.length <= 100 && !/\.\./.test(email), dup = db.accounts.some(a => a.email.toLowerCase() === email.toLowerCase());
    const okN = validName(name) && name.length >= 2 && name.length <= 60;
    $('fg-name').classList.toggle('invalid', !okN);
    $('name-error').textContent = !name ? 'Please enter a name.' : !validName(name) ? 'Names can contain letters and spaces only.' : 'Name must be 2 to 60 characters.';
    $('email-error').textContent = dup ? 'This email already exists.' : 'Please enter a valid email.';
    $('fg-email').classList.toggle('invalid', !okE || dup);
    $('fg-pass').classList.toggle('invalid', !validPass(pass));
    if (!okN || !okE || dup || !validPass(pass)) return;
    // The server hashes and stores the password (it is never kept in the browser).
    const sp = name.lastIndexOf(' ');
    if (sp < 1) { $('fg-name').classList.add('invalid'); $('name-error').textContent = 'Please enter the first and last name.'; return; }
    const role = nextAdminRole();
    run(() => api('/owner/users', { body: { first_name: name.slice(0, sp), last_name: name.slice(sp + 1), email, password: pass, role: 'admin' } }), `Account added: ${name} (${role})`)
        .then(ok => { if (!ok) return; ui.l = { page: 1, search: '', admin: 'all' }; $('l-search').value = ''; closeModal('modal-add'); });
}
function openDeleteList() {
    const items = db.accounts.filter(a => a.id !== ME);
    $('delete-list').innerHTML = items.length ? items.map(a => `<div class="item-row pick" data-pick="${a.id}"><div class="item-info"><strong>${esc(a.name)}</strong><span>${esc(a.role)} · ${esc(a.email)}</span></div><i class="fa-solid fa-trash-can" style="color:#94a3b8"></i></div>`).join('') : '<div class="list-empty">No other accounts to delete.</div>';
    openModal('modal-delacct');
}
function askDeleteAccount(id) {
    const a = db.accounts.find(x => x.id === id); if (!a) return;
    if (id === ME) return toast('You cannot delete your own account.', 'error');
    closeModal('modal-delacct');
    confirmDelete(`Are you sure you want to permanently delete <strong>${esc(a.name)}</strong> (${esc(a.role)})? This cannot be undone.`, async () => {
        try { await api('/owner/users/' + a.id, { method: 'DELETE' }); }
        catch (e) {
            // accounts with history (quotations, logs) are disabled instead, so the records stay intact
            if (e.status === 409 && /disable/i.test(e.message) && confirm(e.message + '\n\nDisable this account now? The person will no longer be able to sign in.'))
                return run(() => api('/owner/users/' + a.id + '/status', { body: { status: 'Disabled' } }), `Account disabled: ${a.name}`);
            return toast(e.message, 'error');
        }
        await commit(); toast(`Account deleted: ${a.name}`);
    });
}

/* ===================== Settings ===================== */
const validGmail = v => {
    const m = v.toLowerCase().match(/^([a-z0-9.]+)@gmail\.com$/); if (!m) return false;
    const u = m[1]; return u.length >= 6 && u.length <= 30 && !u.startsWith('.') && !u.endsWith('.') && !u.includes('..');
};
let savedTheme = readJSON(THEME_KEY, 'light'), selectedTheme = savedTheme;
const dirty = new Set();
function setErr(id, msg) { $(id).closest('.st-input').classList.toggle('invalid', !!msg); $(id + 'Err').textContent = msg || ''; }
function paintStatus() {
    const d = dirty.size > 0 || selectedTheme !== savedTheme;
    $('stStatus').classList.toggle('dirty', d);
    $('stStatus').firstElementChild.className = 'fa-solid ' + (d ? 'fa-circle-exclamation' : 'fa-circle-check');
    $('stStatusText').textContent = d ? 'Unsaved changes' : 'All settings up to date';
}
function applyTheme(t) { document.documentElement.setAttribute('data-theme', t); }
function paintTheme() {
    $$('.st-theme').forEach(b => {
        const t = b.dataset.themeOpt;
        b.classList.toggle('selected', t === selectedTheme); b.classList.toggle('is-active', t === savedTheme);
        b.setAttribute('aria-pressed', String(t === selectedTheme));
    });
    paintStatus();
}
function syncProfile() {
    const a = db.accounts.find(x => x.id === ME);
    if (a) { a.name = profile.name; a.email = profile.email; }
    $('top-name').textContent = profile.name;
    setDashSub();
    if (ui.tab === 'dashboard') $('page-sub').textContent = TABS.dashboard.sub;
}
function fillProfile() { $('stFullName').value = profile.name; $('stEmail').value = profile.email; }
function saveProfileField(field) {
    if (field === 'name') {
        const v = $('stFullName').value.trim().replace(/\s+/g, ' ');
        if (!v) return setErr('stFullName', 'Please enter your full name.');
        if (!validName(v)) return setErr('stFullName', 'Full name can contain letters and spaces only.');
        if (v.length > 60) return setErr('stFullName', 'Full name must be 60 characters or fewer.');
        if (v === profile.name) { setErr('stFullName', ''); return paintStatus(); }
        if (v.indexOf(' ') < 1) return setErr('stFullName', 'Please enter your first and last name.');
        profile.name = v;
    } else {
        const v = $('stEmail').value.trim().toLowerCase();
        if (!validGmail(v)) return setErr('stEmail', 'Enter a valid Gmail address (6–30 letters, numbers or periods before @gmail.com).');
        if (v === profile.email) { setErr('stEmail', ''); return paintStatus(); }
        profile.email = v;
    }
    const next = Object.assign({}, profile);
    api('/auth/profile', { body: { full_name: next.name, email: next.email } }).then(async () => {
        fillProfile(); syncProfile(); dirty.delete(field); paintStatus();
        await commit(); toast('Account details updated');
    }).catch(err => setErr(field === 'name' ? 'stFullName' : 'stEmail', err.message));
}
const EYE_ON = '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24"><path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.1 4.1"/><path d="M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7c1.2 0 2.3-.2 3.3-.6"/></svg>';
function initSettings() {
    [['stFullName', 60], ['stEmail', 100], ['stCurPw', 64], ['stNewPw', 64], ['stConfPw', 64], ['add-name', 60], ['add-email', 100], ['add-pass', 64]].forEach(([id, n]) => { if ($(id)) $(id).maxLength = n; });
    { const pe = $('fg-pass') && $('fg-pass').querySelector('.form-error'); if (pe) pe.textContent = 'Use 8 to 64 characters with at least one letter and one number (no spaces).'; }
    fillProfile(); applyTheme(savedTheme); paintTheme();
    $$('#tab-settings .st-input input').forEach(inp => inp.addEventListener('input', () => {
        setErr(inp.id, '');
        dirty.add(inp.id === 'stFullName' ? 'name' : inp.id === 'stEmail' ? 'email' : 'pw'); paintStatus();
    }));
    ['stFullName', 'stEmail'].forEach(id => {
        const f = id === 'stFullName' ? 'name' : 'email';
        $(id).addEventListener('change', () => saveProfileField(f));
        $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $(id).blur(); } });
    });
    $$('.st-theme').forEach(b => b.addEventListener('click', () => { selectedTheme = b.dataset.themeOpt; paintTheme(); }));
    $('stSaveTheme').addEventListener('click', () => {
        savedTheme = selectedTheme; writeJSON(THEME_KEY, savedTheme); applyTheme(savedTheme); paintTheme();
        toast(`${savedTheme === 'dark' ? 'Dark' : 'Light'} mode applied`);
    });
    $$('.st-eye').forEach(btn => {
        btn.innerHTML = EYE_ON;
        btn.addEventListener('click', () => {
            const input = $(btn.dataset.target), reveal = input.type === 'password';
            input.type = reveal ? 'text' : 'password'; btn.innerHTML = reveal ? EYE_OFF : EYE_ON;
            btn.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
        });
    });
    $('stPwForm').addEventListener('submit', e => {
        e.preventDefault();
        const cur = $('stCurPw').value, nw = $('stNewPw').value, cf = $('stConfPw').value;
        let ok = true;
        if (!cur) { setErr('stCurPw', 'Please enter your current password.'); ok = false; }
        if (!validPass(nw)) { setErr('stNewPw', 'Use 8 to 64 characters with at least one letter and one number, and no spaces.'); ok = false; }
        else if (nw === cur) { setErr('stNewPw', 'New password must be different from the current one.'); ok = false; }
        if (!cf) { setErr('stConfPw', 'Please confirm your new password.'); ok = false; }
        else if (cf !== nw) { setErr('stConfPw', 'Passwords do not match.'); ok = false; }
        if (!ok) return;
        api('/auth/password', { body: { current_password: cur, new_password: nw, confirm_password: cf } }).then(async () => {
            $('stPwForm').reset();
            $$('.st-eye').forEach(b => { $(b.dataset.target).type = 'password'; b.innerHTML = EYE_ON; });
            dirty.delete('pw'); paintStatus();
            await commit(); toast('Password changed successfully');
        }).catch(err => setErr(err.status === 403 ? 'stCurPw' : 'stNewPw', err.message));
    });
}

/* ===================== Shared chrome ===================== */
/* Notifications come from the server. Clicking one opens the right place and marks it as read. */
let bell = null;
function renderNotifs() { if (bell) bell.load(); }
async function openLink(link) {
    const [kind, id] = String(link).split(':');
    if (kind === 'quotation') {
        if (!db.quotes.some(q => q.dbId === +id)) await commit();
        const x = db.quotes.find(q => q.dbId === +id);
        showTab('quotations');
        if (x) { ui.q = { page: 1, search: x.id, status: x.status }; $('q-search').value = x.id; renderQuotes(); viewQuote(x.id); }
        return;
    }
    showTab(kind === 'project' ? 'projects' : 'dashboard');
}
function renderAll() { renderKPIs(); renderStats(); renderBreakdown(); renderEvents(); renderNotifs(); renderQuotes(); renderProjectsTab(); renderLog(); renderAccounts(); renderFinance(); }
function closeDropdowns() { $$('.dropdown-menu').forEach(m => m.classList.remove('show')); }
function openModal(id) { closeDropdowns(); $(id).classList.add('active'); }
function closeModal(id) { $(id).classList.remove('active'); }
function confirmDelete(html, fn, title, yes) {
    ui.confirm = fn; $('confirm-text').innerHTML = html;
    $('modal-confirm').querySelector('.modal-header h3').textContent = title || 'Confirm Delete';
    $('confirm-yes').textContent = yes || 'Yes, Delete';
    openModal('modal-confirm');
}

function showTab(name) {
    if (!TABS[name]) name = 'dashboard';
    ui.tab = name;
    $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
    $$('.sidebar .nav-item').forEach(a => a.classList.toggle('active', a.dataset.tab === name));
    $('page-crumb').textContent = TABS[name].crumb;
    $('page-title').textContent = TABS[name].title;
    $('page-sub').textContent = TABS[name].sub;
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    closeDropdowns(); window.scrollTo(0, 0);
    if (name === 'financial') initFinance();
}
function setCollapsed(c) {
    $('app').classList.toggle('collapsed', c);
    $('sidebar-toggle').innerHTML = `<i class="fa-solid ${c ? 'fa-angles-right' : 'fa-angles-left'}"></i>`;
    $('sidebar-toggle').title = c ? 'Expand sidebar' : 'Minimize sidebar';
    $('sidebar-toggle').setAttribute('aria-label', $('sidebar-toggle').title);
    try { localStorage.setItem(SIDEBAR_KEY, c ? '1' : '0'); } catch (e) {}
    finCharts.forEach(ch => setTimeout(() => ch.resize(), 300));
}
const syncRange = () => $$('#range-tabs .seg-btn').forEach(x => x.classList.toggle('active', parseInt(x.dataset.range, 10) === ui.range));

/* ===================== Wiring ===================== */
async function init() {
    const user = await window.BW.guard('superadmin');
    ME = user.id; profile = { name: user.name, email: user.email };
    setDashSub();
    try { await load(); }
    catch (e) { document.body.innerHTML = '<div style="font:14px sans-serif;padding:40px;max-width:640px;margin:auto"><h2>Cannot load the dashboard</h2><p>' + esc(e.message) + '</p></div>'; return; }
    loadSettings();
    syncProfile();

    $('sidebar').addEventListener('click', e => { const a = e.target.closest('[data-tab]'); if (a) { e.preventDefault(); showTab(a.dataset.tab); } });
    window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));
    $('sidebar-toggle').onclick = () => setCollapsed(!$('app').classList.contains('collapsed'));
    let startCollapsed = false; try { startCollapsed = localStorage.getItem(SIDEBAR_KEY) === '1'; } catch (e) {}
    setCollapsed(startCollapsed);

    // header dropdowns
    $$('[data-dd]').forEach(b => b.addEventListener('click', e => {
        e.stopPropagation();
        const el = $(b.dataset.dd), open = el.classList.contains('show');
        closeDropdowns(); if (!open) { el.classList.add('show'); renderNotifs(); }
    }));
    $$('.dropdown-menu[data-keep]').forEach(m => m.addEventListener('click', e => e.stopPropagation()));
    document.addEventListener('click', closeDropdowns);
    bell = window.BW.Notifications({ list: 'notif-list', dot: 'notif-dot', markAll: 'mark-read', close: closeDropdowns, toast: m => toast(m), open: openLink });
    $('my-profile').onclick = () => showTab('settings');
    $('logout').onclick = () => { closeDropdowns(); toast('Logged out successfully.'); window.BW.logout(LANDING); };

    // modals
    $$('[data-close]').forEach(b => b.addEventListener('click', () => closeModal(b.dataset.close)));
    $$('.modal-overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o) o.classList.remove('active'); }));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { $$('.modal-overlay.active').forEach(o => o.classList.remove('active')); closeDropdowns(); } });
    $('confirm-yes').onclick = () => { closeModal('modal-confirm'); const f = ui.confirm; ui.confirm = null; if (f) f(); };

    // dashboard
    const press = (id, fn) => { $(id).addEventListener('click', fn); $(id).addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } }); };
    press('kpi-projects', () => showTab('projects'));
    press('kpi-quotes', () => showTab('quotations'));
    press('kpi-revenue', () => { renderRevenueModal(); openModal('modal-revenue'); });
    $('view-activity').onclick = e => { e.preventDefault(); showTab('activity'); };
    $('metric-tabs').addEventListener('click', e => {
        const b = e.target.closest('[data-metric]'); if (!b) return;
        ui.metric = b.dataset.metric; $$('#metric-tabs .seg-btn').forEach(x => x.classList.toggle('active', x === b)); renderStats();
    });
    $('range-tabs').addEventListener('click', e => { const b = e.target.closest('[data-range]'); if (b) { ui.range = parseInt(b.dataset.range, 10); syncRange(); renderStats(); } });
    syncRange();
    $('chart-svg').addEventListener('mousemove', chartHover);
    $('chart-svg').addEventListener('mouseleave', chartLeave);
    $('chart-svg').addEventListener('touchstart', e => chartHover(e.touches[0]), { passive: true });
    $('chart-svg').addEventListener('touchmove', e => chartHover(e.touches[0]), { passive: true });


    // quotations
    $('q-search').addEventListener('input', e => { ui.q.search = e.target.value; ui.q.page = 1; renderQuotes(); });
    $('q-tabs').addEventListener('click', e => { const b = e.target.closest('[data-qs]'); if (b) { ui.q.status = b.dataset.qs; ui.q.page = 1; renderQuotes(); } });
    $('q-tbody').addEventListener('click', e => {
        const b = e.target.closest('[data-qact]'); if (!b || b.disabled) return;
        ({ view: viewQuote, approve: approveQuote, revise: openRevision, reject: openReject, send: sendQuote })[b.dataset.qact](b.dataset.id);
    });
    $$('[data-panel-close]').forEach(b => b.addEventListener('click', closePanels));
    $('rev-send').onclick = submitRevision;
    $('rev-items').addEventListener('input', e => {
        const f = e.target.dataset.rv; if (!f || !ui.draft) return;
        const v = numVal(e.target);
        ui.draft.items[+e.target.dataset.i][f] = v;
        markField(e.target, revIssue(f, v)); updateRevTotals();
    });
    $('rev-transport').addEventListener('input', e => {
        if (!ui.draft) return;
        const v = e.target.value.trim() === '' ? 0 : Number(e.target.value);
        ui.draft.transport = v; markField(e.target, revIssue('transport', v)); updateRevTotals();
    });
    $('rev-validity').addEventListener('input', e => markField(e.target, revIssue('validity', numVal(e.target))));
    $('qv-send').onclick = () => { const id = $('qv-send').dataset.id; closeModal('modal-viewquote'); sendQuote(id); };
    $('rej-send').onclick = submitRejection;

    // projects
    $('p-search').addEventListener('input', e => { ui.p.search = e.target.value; ui.p.page = 1; renderProjectsTab(); });
    $('p-status').addEventListener('change', e => { ui.p.status = e.target.value; ui.p.page = 1; renderProjectsTab(); });
    /* the From date can never be after the To date */
    $('p-from').addEventListener('change', e => { if (e.target.value && ui.p.to && e.target.value > ui.p.to) { e.target.value = ui.p.from; return toast('The From date cannot be after the To date', 'error'); } ui.p.from = e.target.value; ui.p.page = 1; renderProjectsTab(); });
    $('p-to').addEventListener('change', e => { if (e.target.value && ui.p.from && e.target.value < ui.p.from) { e.target.value = ui.p.to; return toast('The To date cannot be before the From date', 'error'); } ui.p.to = e.target.value; ui.p.page = 1; renderProjectsTab(); });
    $('p-reset').onclick = () => {
        ui.p = { page: 1, search: '', status: 'all', from: '', to: '' };
        $('p-search').value = ''; $('p-status').value = 'all'; $('p-from').value = ''; $('p-to').value = '';
        renderProjectsTab(); toast('Filters reset');
    };

    // financial
    $('fin-period').addEventListener('click', e => {
        const b = e.target.closest('[data-period]'); if (!b) return;
        if (b.disabled) return;
        finPeriod = b.dataset.period; renderFinance();
    });
    $('fin-export').onclick = exportFinReport;
    $('fin-sort-menu').addEventListener('click', e => { const b = e.target.closest('[data-fsort]'); if (b) { finSort = b.dataset.fsort; renderFinTable(); } });
    $('fin-csv').onclick = () => {
        downloadCSV('monthly-performance.csv', [['Month', 'Gross Revenue', 'Operating Expenses', 'Net Profit', 'Margin %']].concat(finRows().map(r => [r.m, r.rev, r.exp, r.net, r.margin.toFixed(1) + '%'])));
        toast('Monthly performance CSV downloaded');
    };

    // activity
    $('act-add').onclick = openAdd;
    $('act-del').onclick = openDeleteList;
    $('confirm-add').onclick = submitAdd;
    ['add-name', 'add-email', 'add-pass'].forEach(i => $(i).addEventListener('keydown', e => { if (e.key === 'Enter') submitAdd(); }));
    $('l-search').addEventListener('input', e => { ui.l.search = e.target.value; ui.l.page = 1; renderLog(); });
    $('l-admin').addEventListener('change', e => { ui.l.admin = e.target.value; ui.l.page = 1; renderLog(); });
    $('l-reset').onclick = () => { ui.l = { page: 1, search: '', admin: 'all' }; $('l-search').value = ''; renderLog(); toast('Filters reset'); };
    $('a-tbody').addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (b && !b.disabled) askDeleteAccount(+b.dataset.del); });
    $('delete-list').addEventListener('click', e => { const it = e.target.closest('[data-pick]'); if (it) askDeleteAccount(+it.dataset.pick); });

    initSettings();
    renderAll();
    showTab(location.hash.slice(1));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

/* ===== Shared: date limits (2019-2028, same as the customer page) + mobile drawer ===== */
(function () {
  'use strict';
  const MIN = '2019-01-01', MAX = '2028-12-31', MN = 2019, MX = 2028;
  const MON = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  function toast(msg) {
    const t = document.createElement('div'); t.className = 'bw-toast'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 2800);
  }
  const limitInputs = () => document.querySelectorAll('input[type=date]').forEach(i => { i.min = MIN; i.max = MAX; });
  limitInputs();
  document.addEventListener('change', e => {
    const i = e.target;
    if (i.type === 'date' && i.value && (i.value < MIN || i.value > MAX)) { i.value = ''; toast('Please choose a date between 2019 and 2028.'); }
  }, true);

  const parse = t => { const m = /([A-Za-z]+)\s+(\d{4})/.exec(t || ''); const i = m ? MON.indexOf(m[1]) : -1; return i < 0 ? null : { m: i, y: +m[2] }; };
  const lock = (b, on) => {
    if (!b) return;
    if (on) { b.dataset.bwLock = 1; b.disabled = true; }
    else if (b.dataset.bwLock) { delete b.dataset.bwLock; b.disabled = false; }
  };
  function syncCals() {
    document.querySelectorAll('.si-cal-head,.cp-head').forEach(h => {
      const p = parse((h.querySelector('b') || {}).textContent); if (!p) return;
      const k = p.y * 12 + p.m;
      lock(h.firstElementChild, k <= MN * 12);
      lock(h.lastElementChild, k >= MX * 12 + 11);
    });
  }
  let raf; new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { limitInputs(); syncCals(); }); })
    .observe(document.body, { subtree: true, childList: true, characterData: true });
  syncCals();

  const mq = matchMedia('(max-width: 900px)');
  const bd = document.createElement('div'); bd.className = 'bw-backdrop'; document.body.appendChild(bd);
  const closeNav = () => document.body.classList.remove('nav-open');
  document.addEventListener('click', e => {
    if (mq.matches && e.target.closest('.sidebar-toggle')) {
      e.stopImmediatePropagation(); e.preventDefault(); document.body.classList.toggle('nav-open'); return;
    }
    if (e.target === bd || (mq.matches && e.target.closest('.sidebar .nav-item'))) closeNav();
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeNav(); });
  mq.addEventListener('change', closeNav);
})();