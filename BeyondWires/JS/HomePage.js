/* =====================================================================
   BeyondWires customer page  |  JS/HomePage.js
   All data comes from the server (api/customer.php) through JS/api.js:
   - BWC.state:   inquiries, quotations, payments, projects, schedules, documents, dashboard
   - catalog:     Products / Services / Packages from the Admin "Products" tab (no prices)
   - calendar:    the slots the Admin published minus the booked ones, so the customer
                  calendar and the Admin calendar always agree
   The server also enforces every rule (10-inquiry limit, service-area addresses, free slots, dates).
   ===================================================================== */
(async function bwCustomerPage() {
const ME = await window.BW.guard('customer');
const api = window.BW.api;

const BWC = window.BWC = (function () {
  const listeners = [];
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const data = { state: null, catalog: [], avail: { days: {}, min_date: '', max_date: '', today: '' } };
  async function loadState() { data.state = await api('/customer/state'); }
  async function loadCatalog() { data.catalog = await api('/catalog'); }
  async function loadAvail() {
    const from = new Date(), to = new Date(); to.setDate(to.getDate() + 130);
    data.avail = await api('/availability', { query: { from: iso(from), to: iso(to) } });
  }
  return {
    data,
    get state() { return data.state; },
    async init() { await Promise.all([loadState(), loadCatalog(), loadAvail()]); },
    /* reload after every change, then repaint every section */
    async reload(what) {
      const jobs = [loadState()];
      if (!what || what === 'all' || what === 'calendar') jobs.push(loadAvail());
      if (what === 'all') jobs.push(loadCatalog());
      try { await Promise.all(jobs); } catch (e) {
        /* 403 = another account (admin / super admin) signed in on this browser in another tab */
        if (e.status === 403) { window.BW.toast('This browser is no longer signed in to your customer account (another account signed in on another tab). Please sign in again.'); setTimeout(() => window.BW.guard('customer'), 1800); return; }
        window.BW.toast(e.message); return; }
      listeners.forEach(fn => { try { fn(); } catch (err) { console.error(err); } });
    },
    on(fn) { listeners.push(fn); }
  };
})();
try { await BWC.init(); }
catch (e) { document.body.innerHTML = '<div style="font:14px sans-serif;padding:40px;max-width:640px;margin:auto"><h2>Cannot load your dashboard</h2><p>' + window.BW.esc(e.message) + '</p></div>'; return; }

const C = {
  inqNo: i => window.BW.inqNo(i.inquiry_id, i.date_submitted),
  prjNo: id => window.BW.prjNo(id),
  TYPE: { product: 'Product', service: 'Service', package: 'Package', both: 'Both' },
  /* what the customer is inquiring about: label on the page <-> value the server stores */
  OPTION: { product: 'Products', service: 'Services', package: 'Package', both: 'Products and Services' },
  OPTION_KEY: { 'Products': 'product', 'Services': 'service', 'Package': 'package', 'Products and Services': 'both' },
  INQ_STATUS: s => s === 'New Inquiry' ? 'Pending' : s === 'Failed' ? 'Failed' : 'Acknowledged',
  ymd: v => String(v || '').slice(0, 10),
  schedule: id => (BWC.state.schedules || []).find(s => +s.schedule_id === +id),
  /* "Pending" | "Approved" | "Completed" | "Declined" (quotation list) */
  quoteStatus(q) {
    if (q.status === 'Sent to Customer') return 'Pending';
    if (q.status === 'Declined' || q.status === 'Revision Requested') return 'Declined';
    const p = (BWC.state.projects || []).find(x => +x.project_id === +q.project_id);
    return p && p.status === 'Done' ? 'Completed' : 'Approved';
  },
  /* payment column: Pending | Submitted | Approved | Completed | Declined */
  payStatus(q) {
    if (q.status === 'Declined' || q.status === 'Revision Requested') return 'Declined';
    const pays = (BWC.state.payments || []).filter(p => +p.quotation_id === +q.quotation_id);
    if (!pays.length) return 'Pending';
    if (pays.some(p => p.status === 'Under Review')) return 'Submitted';
    if (pays.every(p => p.status === 'Confirmed')) return 'Completed';
    if (pays.some(p => p.status === 'Confirmed')) return 'Approved';
    return 'Pending';
  },
  /* the payment the customer can pay right now for a quotation (Awaiting Payment / Rejected) */
  duePayment: qid => (BWC.state.payments || []).find(p => +p.quotation_id === +qid && (p.status === 'Awaiting Payment' || p.status === 'Rejected')),
  /* project status in the My Projects list: Scheduled | In Progress | Completed */
  projStatus: p => p.status === 'Done' ? 'Completed' : p.install_status === 'In progress' ? 'In Progress' : 'Scheduled'
};

/* ---------- calendar + catalog helpers used by the inquiry form, payment step and reschedule popup ---------- */
window.bwShared = (function () {
  'use strict';
  const av = () => BWC.data.avail;
  const slotsOf = date => (av().days[date] || []).map(s => s.time);
  /* a slot held by the customer's own booking (exclude = schedule id) counts as free while moving that booking */
  const isTaken = (date, time, exclude) => {
    const s = (av().days[date] || []).find(x => x.time === time);
    if (!s || !s.taken) return false;
    const own = exclude && C.schedule(exclude);
    return !(own && own.scheduled_date === date && own.time_slot === time);
  };
  function dayStatus(date, exclude) {
    if (!date || date < av().min_date || date > av().max_date) return 'unavailable';
    const all = slotsOf(date);
    if (!all.length) return 'unavailable';
    const free = all.filter(t => !isTaken(date, t, exclude)).length;
    return free === 0 ? 'unavailable' : free / all.length <= 0.5 ? 'limited' : 'available';
  }
  function slotButtons(date, selected, exclude) {
    if (!date) return '<p class="si-hint">Choose a date to see its available time slots.</p>';
    const list = slotsOf(date);
    if (!list.length) return '<p class="si-hint">No time slots are open on this date. Please choose another date.</p>';
    return list.map(t => {
      const taken = isTaken(date, t, exclude);
      return `<button type="button" data-time="${t}" class="${t === selected && !taken ? 'selected' : ''}${taken ? ' taken' : ''}"${taken ? ' disabled title="Already booked"' : ''}>${t}</button>`;
    }).join('');
  }
  const canBook = (date, time, exclude) => dayStatus(date, exclude) !== 'unavailable' && slotsOf(date).includes(time) && !isTaken(date, time, exclude);
  /* catalog for the inquiry form: never contains prices */
  const catalog = () => BWC.data.catalog.map(c => ({ id: +c.product_id, type: c.item_type, cat: c.category || '', name: c.name, desc: c.description || c.category || '' }));
  return { catalog, dayStatus, slotsOf, isTaken, slotButtons, canBook, customerName: () => ME.name, ADMIN_KEY: '' };
})();

{
    const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('sidebarToggle');
  const navItems = [...document.querySelectorAll('.nav-item[data-section]')];
  const views = [...document.querySelectorAll('.section-view')];
  const inquireBtn = document.getElementById('inquireBtn');

  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    toggle.title = sidebar.classList.contains('collapsed')
      ? 'Expand sidebar'
      : 'Minimize sidebar';
  });

  function openSection(sectionName) {
    navItems.forEach(item => {
      const isActive = item.dataset.section === sectionName;
      item.classList.toggle('active', isActive);
      if (isActive) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });

    views.forEach(view => view.classList.toggle('active', view.id === sectionName));
    history.replaceState(null, '', '#' + sectionName);
  }

  navItems.forEach(item => {
    item.addEventListener('click', () => openSection(item.dataset.section));
  });

  // Restore the active section from the URL when the page is loaded.
  const initial = location.hash.replace('#', '');
  if (initial && document.getElementById(initial) && navItems.some(n => n.dataset.section === initial)) {
    openSection(initial);
  }

  inquireBtn.addEventListener('click', () => openSection('inquiries'));

  }

/* ===== Dashboard: stats, recent activity and upcoming schedules from the server ===== */
(function () {
  const $ = s => document.querySelector(s);
  const esc = window.BW.esc;
  const MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const fmtDay = v => { const d = window.BW.toDate(v); return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''; };
  const fmtWhen = v => { const d = window.BW.toDate(v); if (!d) return ''; const t = new Date(), y = new Date(); y.setDate(t.getDate() - 1);
    const day = d.toDateString() === t.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return String(v).length > 10 ? day + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : day; };
  const city = a => { const m = String(a || '').split(',').map(x => x.trim()).filter(Boolean); return m.length ? m[m.length - 1] : '\u2014'; };
  let rows = [];
  function activity() {
    const st = BWC.state, out = [];
    (st.inquiries || []).forEach(i => out.push({ t: i.date_submitted, text: 'Inquiry ' + C.inqNo(i) + ' submitted' + (+i.needs_site_visit ? ' (site visit requested)' : ''), where: city(i.installation_address),
      status: C.INQ_STATUS(i.status) === 'Acknowledged' ? 'CONFIRMED' : C.INQ_STATUS(i.status) === 'Failed' ? 'FAILED' : 'PENDING', dot: i.status === 'Failed' ? 'orange' : 'green' }));
    (st.quotations || []).forEach(q => out.push({ t: q.date_created, text: 'Quotation ' + q.quotation_no + ' received', where: 'Online', status: C.quoteStatus(q).toUpperCase(), dot: 'green' }));
    (st.payments || []).filter(p => p.transaction_date).forEach(p => out.push({ t: p.transaction_date, text: 'Payment: ' + p.installment, where: p.payment_method, status: p.status === 'Confirmed' ? 'COMPLETED' : p.status === 'Under Review' ? 'PENDING' : p.status.toUpperCase(), dot: p.status === 'Rejected' ? 'orange' : 'green' }));
    return out.sort((a, b) => String(b.t).localeCompare(String(a.t))).slice(0, 5);
  }
  function render() {
    const st = BWC.state, d = st.dashboard || {};
    const first0 = ME.name.split(/\s+/)[0] || '';
    const first = first0.charAt(0).toUpperCase() + first0.slice(1);
    $('.welcome h1').textContent = first ? `Welcome back, ${first}!` : 'Welcome back!';
    $('.welcome p').textContent = 'Here is the latest on your inquiries, quotations, schedules and projects.';
    const active = (st.inquiries || []).filter(i => !['Failed', 'Completed'].includes(i.status)).length;
    const visits = (st.schedules || []).filter(x => x.activity_type === 'Site Inspection').length;
    const cards = document.querySelectorAll('#dashboard .stats .stat');
    const set = (i, v, note) => { if (!cards[i]) return; cards[i].querySelector('.stat-value').textContent = v; cards[i].querySelector('.stat-note').innerHTML = note; };
    set(0, active, `<b>${visits} site inspection${visits === 1 ? '' : 's'}</b> scheduled`);
    set(1, d.quotations_to_review || 0, d.quotations_to_review ? `<b>Review</b> valid until ${esc(fmtDay(d.next_expiry))}` : '<b>All reviewed</b> nothing waiting for you');
    set(2, d.completed_projects || 0, `<b>${d.active_projects || 0} active</b> project${d.active_projects === 1 ? '' : 's'} in progress`);
    set(3, '\u20B1' + Number(d.total_paid || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }), `<b>${d.payments_due || 0} payment${d.payments_due === 1 ? '' : 's'}</b> due`);
    rows = activity();
    $('#dashboard .panel tbody').innerHTML = rows.length ? rows.map(r => `<tr><td class="activity"><span class="dot ${r.dot}"></span>${esc(r.text)}</td><td>${esc(r.where)}</td><td>${esc(fmtWhen(r.t))}</td><td class="status ${r.status === 'COMPLETED' ? 'completed' : 'confirmed'}">${esc(r.status)}</td></tr>`).join('')
      : '<tr><td colspan="4" class="inq-empty">No activity yet. Click "Inquire Now!" to send your first inquiry.</td></tr>';
    const up = (st.schedules || []).slice(0, 4);
    $('#dashboard .schedule-list').innerHTML = up.length ? up.map(x => { const dd = window.BW.toDate(x.scheduled_date); return `<div class="schedule">
      <div class="date"><strong>${dd.getDate()}</strong>${MON[dd.getMonth()]}</div>
      <div><div class="schedule-name">${esc(x.activity_type === 'Installation' ? 'Installation' : 'Site Inspection')} \u2022 ${esc(x.time_slot)}</div>
        <div class="schedule-meta">${esc(x.installation_address || '')}<br>Status: <b>${esc(x.status === 'Confirmed' ? 'Confirmed' : 'Waiting for confirmation')}</b></div>
        <button type="button" class="inq-link-btn sch-change" data-id="${x.schedule_id}">Change schedule</button></div></div>`; }).join('')
      : '<p class="si-hint" style="padding:8px 0">No upcoming site visits or installations.</p>';
  }
  document.getElementById('exportCsv').addEventListener('click', () => {
    const data = [['Activity / Device', 'Location', 'Timestamp', 'Status']].concat(rows.map(r => [r.text, r.where, fmtWhen(r.t), r.status]));
    const csv = data.map(row => row.map(cell => '"' + String(cell).replaceAll('"', '""') + '"').join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), a = document.createElement('a');
    a.href = url; a.download = 'beyondwires-activity.csv'; a.click(); URL.revokeObjectURL(url);
  });
  BWC.on(render);
  render();
})();

/* ===== Header: notifications (same layout + behaviour as the Super Admin page) =====
   Notifications come from the server. Clicking one (or Enter / Space) opens the related
   page or record and marks it as read. */
(function () {
  const $ = id => document.getElementById(id);
  const closeDropdowns = () =>
    document.querySelectorAll('.dropdown-menu.show').forEach(m => m.classList.remove('show'));
  const nav = sec => { const n = document.querySelector(`.nav-item[data-section="${sec}"]`); if (n) n.click(); };

  const bell = window.BW.Notifications({
    list: 'notifList', dot: 'notifDot', markAll: 'markAllRead', close: closeDropdowns,
    toast: msg => { const t = document.createElement('div'); t.className = 'bw-toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2400); },
    open(link) {
      const [kind, id] = link.split(':');
      if (kind === 'quotation' && window.bwQuo) return window.bwQuo.open(+id);
      if (kind === 'inquiry' && window.bwInq) return window.bwInq.open(+id);
      if (kind === 'project' && window.bwPrj) return window.bwPrj.open(+id);
      if (kind === 'documents') return nav('documents');
      nav('dashboard');                       // schedules are listed on the dashboard
    }
  });

  document.querySelectorAll('[data-dd]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const el = $(b.dataset.dd), open = el.classList.contains('show');
    closeDropdowns();
    if (!open) { el.classList.add('show'); if (b.dataset.dd === 'notifMenu') bell.load(); }
  }));
  document.querySelectorAll('[data-keep]').forEach(m => m.addEventListener('click', e => e.stopPropagation()));
  document.addEventListener('click', closeDropdowns);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDropdowns(); });

  $('myAccountLink').onclick = e => {
    e.preventDefault(); closeDropdowns();
    document.querySelector('.nav-item[data-section="settings"]').click();
  };
  $('logoutBtn').onclick = () => { closeDropdowns(); window.BW.logout('LandingPage.html'); };

  window.bwNotifs = { render: bell.load };
  BWC.on(bell.load);
})();

/* ===== My Inquiries ===== */
(function () {
  const PAGE_SIZE = 6;
  const MIN_DATE = '2019-01-01', MAX_DATE = '2028-12-31';
  /* Inquiries come from the server. Each inquiry is one row (a form with "Add more inquiry"
     creates one row per inquiry, like on the Admin page). */
  const toBlock = r => ({
    address: r.installation_address, place: r.place_type, option: C.OPTION[r.purchase_option] || 'Products and Services',
    site: +r.needs_site_visit ? 'Yes' : 'No',
    visitDate: r.visit_date || (r.preferred_visit_at ? String(r.preferred_visit_at).slice(0, 10) : ''),
    visitTime: r.visit_slot || '',
    bookingId: r.visit_status === 'Requested' || r.visit_status === 'Confirmed' ? +r.visit_schedule_id : 0,
    visitDone: r.visit_status === 'Completed',
    items: (r.items || []).map(x => x.name),
    itemsFull: (r.items || []).map(x => ({ name: x.name, desc: x.description || x.category || '' })),
    budget: r.budget_range || ''
  });
  const mapInquiries = () => (BWC.state.inquiries || []).map(r => ({
    id: C.inqNo(r), dbId: +r.inquiry_id, date: C.ymd(r.date_submitted), type: C.TYPE[r.purchase_option] || 'Both',
    site: +r.needs_site_visit ? 'Yes' : 'No', status: C.INQ_STATUS(r.status), serverStatus: r.status, mine: true,
    submittedAt: window.BW.toDate(r.date_submitted).getTime(), group: r.submission_ref,
    rejection: r.rejection_reason ? { reason: r.rejection_reason, note: r.rejection_note } : null,
    notes: r.requirements || '', details: { name: ME.name, email: ME.email, blocks: [toBlock(r)] }
  }));
  let inquiries = mapInquiries();

  /* Each customer may submit at most 10 inquiries. The server enforces it; the page shows it early. */
  const lim = () => BWC.state.limit || { max: 10, used: inquiries.length };
  window.__inqData = () => inquiries;
  window.__inqLimit = {
    get max() { return lim().max; },
    remaining: () => Math.max(0, lim().max - lim().used),
    reached: () => lim().used >= lim().max,
    notify() {
      const t = document.createElement('div'); t.className = 'bw-toast';
      t.textContent = 'You have reached the limit of ' + lim().max + ' inquiries.';
      document.body.appendChild(t); setTimeout(() => t.remove(), 3200);
    }
  };

  const state = { search:'', status:'all', from:'', to:'', page:1 };

  const $ = id => document.getElementById(id);
  const body = $('inqBody'), countEl = $('inqCount'), pager = $('inqPager');
  const searchEl = $('inqSearch'), statusEl = $('inqStatus');
  const dateBtn = $('inqDateBtn'), dateLabel = $('inqDateLabel'), datePop = $('inqDatePop');
  const fromEl = $('inqFrom'), toEl = $('inqTo'), dateErr = $('inqDateErr');
  const viewModal = $('inqViewModal'), newModal = $('inqNewModal'), newForm = $('inqNewForm');
  const toast = $('inqToast');

  const slug = s => s.toLowerCase().replace(/\s+/g, '-');
  const fmt = iso => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month:'short', day:'2-digit', year:'numeric' });
  };
  const pill = text => `<span class="pill ${slug(text)}">${text}</span>`;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function getFiltered() {
    const q = state.search.trim().toLowerCase();
    return inquiries.filter(i => {
      if (state.status !== 'all' && i.status !== state.status) return false;
      if (state.from && i.date < state.from) return false;
      if (state.to && i.date > state.to) return false;
      if (q) {
        const hay = [i.id, fmt(i.date), i.type, i.site, i.status].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function render() {
    const list = getFiltered();
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    state.page = Math.min(Math.max(state.page, 1), totalPages);

    const startIdx = (state.page - 1) * PAGE_SIZE;
    const rows = list.slice(startIdx, startIdx + PAGE_SIZE);

    body.innerHTML = rows.length
      ? rows.map(i => `
        <tr>
          <td class="inq-id">${i.id}</td>
          <td>${fmt(i.date)}</td>
          <td>${pill(i.type)}</td>
          <td>${i.site}</td>
          <td>${pill(i.status)}</td>
          <td class="inq-right"><button type="button" class="inq-view" data-id="${i.id}">View</button></td>
        </tr>`).join('')
      : `<tr><td colspan="6" class="inq-empty">No inquiries found.</td></tr>`;

    const from = total ? startIdx + 1 : 0;
    const to = Math.min(startIdx + PAGE_SIZE, total);
    countEl.textContent = `Showing ${from}–${to} of ${total} results`;

    let pagerHtml = `<button type="button" class="pg-btn" data-nav="prev" ${state.page === 1 ? 'disabled' : ''}>Previous</button>`;
    for (let p = 1; p <= totalPages; p++) {
      pagerHtml += `<button type="button" class="pg-btn ${p === state.page ? 'active' : ''}" data-page="${p}">${p}</button>`;
    }
    pagerHtml += `<button type="button" class="pg-btn" data-nav="next" ${state.page === totalPages ? 'disabled' : ''}>Next</button>`;
    pager.innerHTML = pagerHtml;
  }

  searchEl.addEventListener('input', () => { state.search = searchEl.value; state.page = 1; render(); });
  statusEl.addEventListener('change', () => { state.status = statusEl.value; state.page = 1; render(); });

  function updateDateLabel() {
    if (state.from && state.to) dateLabel.textContent = `${fmt(state.from)} – ${fmt(state.to)}`;
    else if (state.from) dateLabel.textContent = `From ${fmt(state.from)}`;
    else if (state.to) dateLabel.textContent = `Until ${fmt(state.to)}`;
    else dateLabel.textContent = 'Choose Date Range';
  }

  dateBtn.addEventListener('click', e => { e.stopPropagation(); datePop.classList.toggle('show'); });
  datePop.addEventListener('click', e => e.stopPropagation());
  document.addEventListener('click', () => datePop.classList.remove('show'));

  $('inqDateApply').addEventListener('click', () => {
    let f = fromEl.value, t = toEl.value;
    if ((f && (f < MIN_DATE || f > MAX_DATE)) || (t && (t < MIN_DATE || t > MAX_DATE))) {
      dateErr.textContent = 'Please choose dates from 2019 to 2028.';
      dateErr.hidden = false;
      return;
    }
    dateErr.hidden = true;
    if (f && t && f > t) [f, t] = [t, f];
    state.from = f; state.to = t; state.page = 1;
    fromEl.value = f; toEl.value = t;
    updateDateLabel(); datePop.classList.remove('show'); render();
  });
  $('inqDateClear').addEventListener('click', () => {
    dateErr.hidden = true;
    fromEl.value = toEl.value = ''; state.from = state.to = ''; state.page = 1;
    updateDateLabel(); datePop.classList.remove('show'); render();
  });

  pager.addEventListener('click', e => {
    const btn = e.target.closest('.pg-btn');
    if (!btn || btn.disabled) return;
    if (btn.dataset.nav === 'prev') state.page--;
    else if (btn.dataset.nav === 'next') state.page++;
    else state.page = Number(btn.dataset.page);
    render();
  });

  const openModal = m => { m.classList.add('show'); m.setAttribute('aria-hidden', 'false'); };
  const closeModals = () => [viewModal, newModal].forEach(m => { m.classList.remove('show'); m.setAttribute('aria-hidden', 'true'); });

  [viewModal, newModal].forEach(m => {
    m.addEventListener('click', e => { if (e.target === m || e.target.hasAttribute('data-close')) closeModals(); });
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModals(); });

let viewing = null;

function openView(i) {
  viewing = i;
  const d = i.details;
  const cell = (label, value, full) => `<div${full ? ' class="inq-view-full"' : ''}><span>${label}</span><b>${esc(value) || '\u2014'}</b></div>`;
  const canMove = i.status !== 'Failed';
  const rej = i.rejection ? `<div class="inq-view-block"><div class="inq-view-grid"><div class="inq-view-full"><span>Not accepted</span><b>${esc(i.rejection.reason)}</b>${i.rejection.note ? `<small>${esc(i.rejection.note)}</small>` : ''}</div></div></div>` : '';

  $('vSub').textContent = `${i.id} \u2022 ${fmt(i.date)}`;
  $('vName').textContent = d.name || '\u2014';
  $('vEmail').textContent = d.email || '\u2014';
  $('vBlocks').innerHTML = d.blocks.map((b, n) => {
    const cat = window.bwCatalogFor && window.bwCatalogFor(b.option);
    const items = (b.itemsFull || []).map(it => `<div class="inq-view-item"><div><b>${esc(it.name)}</b>${it.desc ? `<small>${esc(it.desc)}</small>` : ''}</div></div>`).join('');
    return `
    <div class="inq-view-block">
      ${d.blocks.length > 1 ? `<div class="inq-view-title">Inquiry ${n + 1}</div>` : ''}
      <div class="inq-view-grid">
        ${cell('Address', b.address, true)}
        ${cell('Type of Place', b.place)}
        ${cell('Inquiring About', b.option)}
        ${cell('Would you like a site visit?', b.site, true)}
        ${b.site === 'Yes'
          ? `${cell('Preferred Date', b.visitDate ? fmt(b.visitDate) : (b.visit || '').split(' \u2022 ')[0])}
             ${cell('Time Slot', b.visitTime || (b.visit || '').split(' \u2022 ')[1])}
             ${canMove && b.bookingId ? `<div class="inq-view-full"><button type="button" class="inq-outline-btn rs-btn" data-resched="${n}">Change schedule</button></div>` : ''}`
          : `<div class="inq-view-full"><span>${esc((cat && cat.label) || 'Selection').replace('&amp;', '&amp;')}</span>${items || '<b>\u2014</b>'}</div>
             ${cell('Budget Range', b.budget, true)}`}
      </div>
    </div>`;
  }).join('') + `<div class="inq-view-block"><div class="inq-view-grid">${cell('Submitted together with other inquiries', i.group ? 'Yes' : 'No', true)}</div></div>` + rej;
  openModal(viewModal);
}

body.addEventListener('click', e => {
  const btn = e.target.closest('.inq-view');
  if (!btn) return;
  const i = inquiries.find(x => x.id === btn.dataset.id);
  if (i) openView(i);
});

$('vBlocks').addEventListener('click', e => {
  const btn = e.target.closest('[data-resched]');
  if (!btn || !viewing) return;

  const b = viewing.details.blocks[Number(btn.dataset.resched)];

  window.bwReschedule.open({
    title: 'Change Site Visit Schedule',
    sub: viewing.id,
    date: b.visitDate || '',
    time: b.visitTime || '',
    bookingId: b.bookingId || '',

    onSave: async (date, time, reason) => {
      const id = viewing.dbId;
      await api(`/customer/schedules/${b.bookingId}/reschedule`, { body: { date, slot: time, reason } });
      await BWC.reload('calendar');
      const again = inquiries.find(x => x.dbId === id); if (again) openView(again);
    }
  });
});

/* New Inquiry (the button is redirected to the Service Inquiry page by the later script) */
$('newInquiryBtn').addEventListener('click', () => {
  newForm.reset();
  openModal(newModal);
});

newForm.addEventListener('submit', e => { e.preventDefault(); closeModals(); });   // inquiries are sent from the New Service Inquiry page

/* Fresh data from the server: repaint the list (and the open popup) */
BWC.on(() => {
  inquiries = mapInquiries(); render();
  if (viewing && viewModal.classList.contains('show')) { const again = inquiries.find(x => x.dbId === viewing.dbId); if (again) openView(again); }
});
window.__inqShowNew = ids => {   // called after a new submission
  state.search = ''; state.status = 'all'; state.from = state.to = ''; state.page = 1;
  searchEl.value = ''; statusEl.value = 'all'; fromEl.value = toEl.value = ''; updateDateLabel(); render();
  toast.textContent = ids.length > 1 ? ids.length + ' inquiries submitted' : `Inquiry ${(inquiries.find(x => x.dbId === ids[0]) || {}).id || ''} submitted`;
  toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2500);
};

/* Open an inquiry from anywhere (notifications, dashboard) */
window.bwInq = {
  open(id) {
    const i = inquiries.find(x => x.dbId === +id || x.id === id);
    const nav = document.querySelector('.nav-item[data-section="inquiries"]');
    if (nav) nav.click();
    if (i) openView(i);
  }
};

render();
})();
/* ===== Quotations ===== */
(function () {
  const PAGE_SIZE = 6;

  /* Quotations the customer can see (sent to them, approved or declined) come from the server. */
  const mapQuotes = () => (BWC.state.quotations || []).map(q => ({
    id: q.quotation_no, dbId: +q.quotation_id, date: C.ymd(q.date_created), status: C.quoteStatus(q), payment: C.payStatus(q), raw: q
  }));
  let quotations = mapQuotes();

  const state = { search:'', status:'all', from:'', to:'', page:1 };

  const $ = id => document.getElementById(id);
  const body = $('quoBody'), countEl = $('quoCount'), pager = $('quoPager');
  const searchEl = $('quoSearch'), statusEl = $('quoStatus');
  const dateBtn = $('quoDateBtn'), dateLabel = $('quoDateLabel'), datePop = $('quoDatePop');
  const fromEl = $('quoFrom'), toEl = $('quoTo');
  const viewModal = $('quoViewModal');

  const slug = s => s.toLowerCase().replace(/\s+/g, '-');
  const fmt = iso => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month:'short', day:'2-digit', year:'numeric' });
  };

  const pill = t => `<span class="pill ${slug(t)}">${t}</span>`;

  function getFiltered() {
    const q = state.search.trim().toLowerCase();
    return quotations.filter(i => {
      if (state.status !== 'all' && i.status !== state.status) return false;
      if (state.from && i.date < state.from) return false;
      if (state.to && i.date > state.to) return false;
      if (q && ![i.id, fmt(i.date), i.status, i.payment].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function render() {
    const list = getFiltered();
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    state.page = Math.min(Math.max(state.page, 1), totalPages);
    const startIdx = (state.page - 1) * PAGE_SIZE;
    const rows = list.slice(startIdx, startIdx + PAGE_SIZE);

    body.innerHTML = rows.length
      ? rows.map(i => `
        <tr>
          <td class="inq-id">${i.id}</td>
          <td>${fmt(i.date)}</td>
          <td>${pill(i.status)}</td>
          <td>${pill(i.payment)}</td>
          <td class="inq-right"><button type="button" class="inq-view" data-id="${i.id}">View</button></td>
        </tr>`).join('')
      : `<tr><td colspan="5" class="inq-empty">No quotations found.</td></tr>`;

    countEl.textContent = `Showing ${total ? startIdx + 1 : 0}–${Math.min(startIdx + PAGE_SIZE, total)} of ${total} results`;

    let html = `<button type="button" class="pg-btn" data-nav="prev" ${state.page === 1 ? 'disabled' : ''}>Previous</button>`;
    for (let p = 1; p <= totalPages; p++) {
      html += `<button type="button" class="pg-btn ${p === state.page ? 'active' : ''}" data-page="${p}">${p}</button>`;
    }
    html += `<button type="button" class="pg-btn" data-nav="next" ${state.page === totalPages ? 'disabled' : ''}>Next</button>`;
    pager.innerHTML = html;
  }

  searchEl.addEventListener('input', () => { state.search = searchEl.value; state.page = 1; render(); });
  statusEl.addEventListener('change', () => { state.status = statusEl.value; state.page = 1; render(); });

  function updateDateLabel() {
    if (state.from && state.to) dateLabel.textContent = `${fmt(state.from)} – ${fmt(state.to)}`;
    else if (state.from) dateLabel.textContent = `From ${fmt(state.from)}`;
    else if (state.to) dateLabel.textContent = `Until ${fmt(state.to)}`;
    else dateLabel.textContent = 'Choose Date Range';
  }
  dateBtn.addEventListener('click', e => { e.stopPropagation(); datePop.classList.toggle('show'); });
  datePop.addEventListener('click', e => e.stopPropagation());
  document.addEventListener('click', () => datePop.classList.remove('show'));

  $('quoDateApply').addEventListener('click', () => {
    let f = fromEl.value, t = toEl.value;
    if (f && t && f > t) [f, t] = [t, f];
    state.from = f; state.to = t; state.page = 1;
    fromEl.value = f; toEl.value = t;
    updateDateLabel(); datePop.classList.remove('show'); render();
  });
  $('quoDateClear').addEventListener('click', () => {
    fromEl.value = toEl.value = ''; state.from = state.to = ''; state.page = 1;
    updateDateLabel(); datePop.classList.remove('show'); render();
  });

  pager.addEventListener('click', e => {
    const btn = e.target.closest('.pg-btn');
    if (!btn || btn.disabled) return;
    if (btn.dataset.nav === 'prev') state.page--;
    else if (btn.dataset.nav === 'next') state.page++;
    else state.page = Number(btn.dataset.page);
    render();
  });

  const closeModal = () => { viewModal.classList.remove('show'); viewModal.setAttribute('aria-hidden', 'true'); };
  viewModal.addEventListener('click', e => { if (e.target === viewModal || e.target.hasAttribute('data-close')) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* View -> opens the Quotation Approval page (document built from the server's quotation) */
let current = null;
const peso = n => '₱' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function detailsPage(q) {
  const e = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const row = (a, b) => `<div class="qa-row"><span>${a}</span><b>${e(b) || '—'}</b></div>`;
  const d = q.detail, ap = d.approval || {}, sc = d.schedule;
  const pays = (d.payments || []).map(p => row(p.installment, peso(p.amount_due) + ' • ' + (p.status === 'Under Review' ? 'Proof submitted' : p.status))).join('');
  return `<div class="qa-page">
    <h4>Schedule &amp; Payment</h4>
    ${row('Installation', sc ? fmt(sc.scheduled_date) + ' • ' + sc.time_slot : '')}
    ${row('Agreement', ap.payment_agreement)}
    ${row('Method', ap.payment_method)}
    ${pays}
    <div class="qa-foot">Page 2 of 2</div>
  </div>`;
}

function pagesHtml(q) {
  const paper = window.bwTpl.quotation(window.bwTpl.fromServer(q.detail));
  return `<div class="qa-page bwd-qpage">${paper}</div>` + (q.detail.approval ? detailsPage(q) : '');
}

/* Approve / Reject only work while the quotation is still Pending */
function paintActions() {
  const pending = current.status === 'Pending';
  $('qaApprove').disabled = !pending;
  $('qaReject').disabled = !pending;
  const sc = current.detail && current.detail.schedule;
  current.schedule = sc && (sc.status === 'Requested' || sc.status === 'Confirmed') ? { date: sc.scheduled_date, time: sc.time_slot, bookingId: +sc.schedule_id } : null;
  $('qaResched').hidden = !current.schedule;
  const due = C.duePayment(current.dbId);
  $('qaPay').hidden = !due;
  if (due) $('qaPay').textContent = (due.status === 'Rejected' ? 'Re-upload payment proof' : 'Proceed to payment') + ' (' + due.installment + ')';
  const res = $('qaResult');
  res.hidden = pending;
  res.className = 'qa-result ' + current.status.toLowerCase();
  res.textContent = pending ? '' : `${current.id} is ${current.status.toLowerCase()}.`;
}

/* Approve -> Step 2, Reject -> declined card.
   The flow itself lives in the Payment Flow script (end of HomePage.js). */
$('qaApprove').addEventListener('click', () => {
  if (!current || current.status !== 'Pending') return;
  document.dispatchEvent(new CustomEvent('quo:approve', { detail: current }));
});

$('qaReject').addEventListener('click', () => {
  if (!current || current.status !== 'Pending') return;
  document.dispatchEvent(new CustomEvent('quo:reject', { detail: current }));
});
$('qaPay').addEventListener('click', () => {
  if (current) document.dispatchEvent(new CustomEvent('quo:pay', { detail: current }));
});
$('qaResched').addEventListener('click', () => {
  if (!current || !current.schedule) return;
  window.bwReschedule.open({
    title:'Change Installation Schedule', sub:current.id,
    date:current.schedule.date, time:current.schedule.time, bookingId:current.schedule.bookingId || '',
    onSave: async (date, time, reason) => {
      await api(`/customer/schedules/${current.schedule.bookingId}/reschedule`, { body: { date, slot: time, reason } });
      await BWC.reload('calendar');
      await openQuote(quotations.find(x => x.dbId === current.dbId) || current);
    }
  });
});
/* ===== Customer: Back button + reschedule reason ===== */
(function () {
  document.addEventListener('click', e => {
    if (!e.target.closest('#siBack')) return;
    const n = document.querySelector('.nav-item[data-section="inquiries"]'); if (n) n.click();
  });
  setTimeout(() => {   // runs once every section below is set up
    const $ = s => document.querySelector(s);
    const rs = window.bwReschedule, sel = $('#rsReason'), other = $('#rsOther'),
          wrap = $('#rsOtherWrap'), err = $('#rsReasonErr'), save = $('#rsSave');
    if (!rs || !sel || !save) return;
    const reason = () => sel.value === 'Other' ? other.value.trim() : sel.value;
    const reset = () => { sel.value = ''; other.value = ''; wrap.hidden = true; err.hidden = true; };
    sel.addEventListener('change', () => { wrap.hidden = sel.value !== 'Other'; err.hidden = true; if (!wrap.hidden) other.focus(); });
    save.addEventListener('click', e => {
      if (!sel.value || (sel.value === 'Other' && reason().length < 5)) {
        e.stopImmediatePropagation();
        err.textContent = sel.value ? 'Please describe your reason (at least 5 characters).' : 'Please select a reason for rescheduling.';
        err.hidden = false;
      }
    }, true);
    const open = rs.open.bind(rs);
    rs.open = o => { reset(); const cb = o.onSave; return open(Object.assign({}, o, { onSave: (d, t) => cb && cb(d, t, reason()) })); };
  });
})();

/* Download: uses q.file if you add one to a quotation, otherwise builds a summary PDF */
$('qaDownload').addEventListener('click', () => {
  if (!current) return;
  const a = document.createElement('a');
  let url = '';
  {
    window.bwTpl.print($('qaDocs').querySelector('.bwd-paper').outerHTML, 'Quotation ' + current.id);
    return;
    const blob = window.bwBuildPdf('BeyondWires - Quotation ' + current.id, [
      'Quotation ID: ' + current.id, 'Date: ' + fmt(current.date),
      'Status: ' + current.status, 'Payment: ' + current.payment
    ]);
    url = URL.createObjectURL(blob);
    a.href = url;
  }
  a.download = current.id + '.pdf';
  document.body.appendChild(a); a.click(); a.remove();
  if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
});

/* Mouse wheel scrolls the files sideways (until the first or last page is reached) */
$('qaDocs').addEventListener('wheel', e => {
  const el = e.currentTarget;
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
  const max = el.scrollWidth - el.clientWidth;
  if ((e.deltaY > 0 && el.scrollLeft >= max) || (e.deltaY < 0 && el.scrollLeft <= 0)) return;
  e.preventDefault();
  el.scrollLeft += e.deltaY;
}, { passive: false });

body.addEventListener('click', e => {
  const btn = e.target.closest('.inq-view');
  if (!btn) return;
  const q = quotations.find(x => x.id === btn.dataset.id);
  if (q) openQuote(q);
});

async function openQuote(q) {
  let detail;
  try { detail = await api('/customer/quotations/' + q.dbId); }
  catch (e) { window.BW.toast(e.message); return; }
  current = Object.assign({}, q, { detail });
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.section === 'quotations'));
  $('qaDocs').innerHTML = pagesHtml(current);
  $('qaDocs').scrollLeft = 0;
  paintActions();
  document.querySelectorAll('.section-view').forEach(v => v.classList.toggle('active', v.id === 'quotation-view'));
  $('qaDocs').querySelectorAll('.bwd-qpage .bwd-paper').forEach(p => { p.style.zoom = Math.min(0.8, ($('qaDocs').clientWidth - 6) / 720).toFixed(3); });   // the quotation fits its space instead of being cut off
  const content = document.querySelector('.content');
  if (content) content.scrollTop = 0;
  document.dispatchEvent(new CustomEvent('bw:section', { detail: 'quotation-view' }));
}

document.addEventListener('click', e => {
  if (!e.target.closest('#qaBack')) return;
  const n = document.querySelector('.nav-item[data-section="quotations"]'); if (n) n.click();
});

window.bwQuo = {
  render,
  list: () => quotations,
  current: () => current,
  open(id) {
    const q = quotations.find(x => x.dbId === +id || x.id === id);
    if (q) openQuote(q);
    else { const n = document.querySelector('.nav-item[data-section="quotations"]'); if (n) n.click(); }
  },
  repaint: paintActions,
  refresh: () => current && openQuote(quotations.find(x => x.dbId === current.dbId) || current)
};
  BWC.on(() => {
    quotations = mapQuotes(); render();
    if (current && document.getElementById('quotation-view').classList.contains('active')) window.bwQuo.refresh();
  });
  render();
})();

/* ===== Documents shown from live data (used by Documents and My Projects) ===== */
window.bwDocs = (function () {
  const cache = {};
  const map = d => ({ id: d.kind + '-' + d.id, kind: d.kind, srvId: d.id, title: d.title, type: d.type, date: C.ymd(d.date), status: d.status, project_id: d.project_id ? +d.project_id : null });
  async function load(d) {
    const key = d.kind + d.srvId;
    if (cache[key]) return cache[key];
    const url = { quotation: '/customer/quotations/', receipt: '/customer/receipts/', certificate: '/customer/certificates/', report: '/customer/certificates/' }[d.kind];
    if (!url) return null;
    return (cache[key] = await api(url + d.srvId));
  }
  async function html(d) {
    let v;
    try { v = await load(d); } catch (e) { window.BW.toast(e.message); return ''; }
    if (!v) return '';
    const T = window.bwTpl;
    if (d.kind === 'quotation') return T.quotation(T.fromServer(v));
    if (d.kind === 'receipt') {
      /* computation shown on the receipt: project total, payments before this one, this payment and the balance left */
      const p2 = n => '\u20B1' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const qt = (BWC.state.quotations || []).find(x => x.quotation_no === v.quotation_no || (v.quotation_id && +x.quotation_id === +v.quotation_id));
      const total = +v.total_amount || +(qt && qt.total_amount) || 0, paid = +v.amount_paid || 0;
      const others = (BWC.state.payments || []).filter(x => qt && +x.quotation_id === +qt.quotation_id && x.status === 'Confirmed' && String(x.receipt_no || '') !== String(v.receipt_no || '') &&
        (v.payment_id ? +x.payment_id < +v.payment_id : v.installment === 'Final balance'));
      const earlier = v.earlier || [];   // receipts issued before this one (e.g. the down payment, shown on the final receipt)
      const before = earlier.length ? Math.round(earlier.reduce((s, x) => s + (+x.amount_paid || 0), 0) * 100) / 100
        : Math.round(others.reduce((s, x) => s + (+x.amount_paid || +x.amount_due || 0), 0) * 100) / 100;
      const lessRows = earlier.length ? earlier.map(x => ['Less: Receipt No. ' + x.receipt_no + ' (' + x.installment + ', ' + new Date(C.ymd(x.issued_at) + 'T00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ')', p2(x.amount_paid)])
        : [['Less: payments received before this receipt', p2(before)]];
      const comp = total > 0 ? [['Total project cost (' + (v.quotation_no || 'quotation') + ')', p2(total)]].concat(lessRows, [
        ['This payment (' + Math.round(paid / total * 100) + '% of the total)', p2(paid)], ['Remaining balance after this payment', p2(Math.max(0, Math.round((total - before - paid) * 100) / 100))]]) : [];
      return T.invoice({ no: v.receipt_no, date: C.ymd(v.issued_at), method: v.payment_method === 'Online' ? 'Online' : 'Cash', ref: v.reference_no,
        customer: v.first_name + ' ' + v.last_name, address: v.installation_address, style: v.place_type === 'Commercial' ? v.first_name + ' ' + v.last_name : 'N/A',
        rows: [{ name: v.quotation_no + ' - ' + v.installment, qty: 1, price: paid }], comp });
    }
    const c = v.data || {}, photos = (v.photos || []).map(p => ({ src: window.BW.fileUrl('/customer/certificates/' + d.srvId + '/photos/' + p.photo_id), caption: p.caption }));
    const base = { title: c.system ? String(c.system).toUpperCase() + ' INSTALLATION CERTIFICATE' : '', project: c.title || v.project_name, work: c.work, location: c.location,
      manager: c.manager, team: c.team, contractor: c.contractor, residence: c.residence, overview: c.overview, scope: c.scope,
      start: c.start || C.ymd(v.start_date), end: c.end || C.ymd(v.end_date || v.sent_at), photos };
    return d.kind === 'certificate' ? T.certificate(base) : T.report(base);
  }
  const fileUrl = d => window.BW.fileUrl('/customer/documents/' + d.srvId + '/download');
  BWC.on(() => { Object.keys(cache).forEach(k => delete cache[k]); });
  return { map, html, fileUrl };
})();

/* ===== Documents ===== */
(function () {
  /* Documents come from the server: quotations sent to you, receipts and certificates the admin sent, uploaded files */
  let documents = (BWC.state.documents || []).map(d => window.bwDocs.map(d));

  const state = { search:'', type:'all', view:'grid' };

  const $ = id => document.getElementById(id);
  const grid = $('docGrid'), emptyEl = $('docEmpty');
  const searchEl = $('docSearch'), typeEl = $('docType');
  const tabs = [...document.querySelectorAll('#docTabs .doc-tab')];
  const gridBtn = $('docGridBtn'), listBtn = $('docListBtn');
  const viewModal = $('docViewModal');
  let currentDoc = null;

  const slug = s => s.toLowerCase().replace(/\s+/g, '-');
  const fmt = iso => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month:'short', day:'2-digit', year:'numeric' });
  };

  const ICON_DOC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 13h5M10 17h5"/></svg>';
  const ICON_AWARD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="9" r="5"/><path d="m9 13-1 8 4-2 4 2-1-8"/></svg>';
  const ICON_DL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/></svg>';

  function getFiltered() {
    const q = state.search.trim().toLowerCase();
    return documents.filter(d => {
      if (state.type !== 'all' && d.type !== state.type) return false;
      if (q && ![d.title, d.type, fmt(d.date), d.status].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function render() {
    const list = getFiltered();
    grid.className = 'doc-grid' + (state.view === 'list' ? ' list' : '');
    emptyEl.style.display = list.length ? 'none' : 'block';

    grid.innerHTML = list.map(d => `
      <div class="doc-card">
        <div class="doc-top">
          <span class="doc-icon ${slug(d.type)}">${d.type === 'Certificate' ? ICON_AWARD : ICON_DOC}</span>
          <span class="pill ${slug(d.status)}">${d.status}</span>
        </div>
        <div class="doc-info">
          <div class="doc-kind">${d.type}</div>
          <div class="doc-title">${d.title}</div>
          <div class="doc-date">${fmt(d.date)}</div>
        </div>
        <div class="doc-actions">
          <button type="button" class="doc-btn-view" data-act="view" data-id="${d.id}">View</button>
          <button type="button" class="doc-btn-pdf" data-act="pdf" data-id="${d.id}">${ICON_DL} PDF</button>
        </div>
      </div>`).join('');
  }

  searchEl.addEventListener('input', () => { state.search = searchEl.value; render(); });

  /* All Types dropdown and sub-tabs stay in sync */
  function setType(type) {
    state.type = type;
    if (typeEl) typeEl.value = type;
    tabs.forEach(t => t.classList.toggle('active', t.dataset.type === type));
    render();
  }
  if (typeEl) typeEl.addEventListener('change', () => setType(typeEl.value));
  tabs.forEach(t => t.addEventListener('click', () => setType(t.dataset.type)));

  function setView(view) {
    state.view = view;
    gridBtn.classList.toggle('active', view === 'grid');
    listBtn.classList.toggle('active', view === 'list');
    render();
  }
  gridBtn.addEventListener('click', () => setView('grid'));
  listBtn.addEventListener('click', () => setView('list'));


  /* PDF download: builds a simple one-page PDF in the browser */
  function buildPdf(title, lines) {
    const clean = s => String(s).replace(/[^\x20-\x7E]/g, '-').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    let content = `BT /F1 18 Tf 72 730 Td (${clean(title)}) Tj ET\n`;
    let y = 690;
    lines.forEach(l => { content += `BT /F1 12 Tf 72 ${y} Td (${clean(l)}) Tj ET\n`; y -= 22; });

    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      `<< /Length ${content.length} >>\nstream\n${content}endstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [];
    objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = pdf.length;
    pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
           offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') +
           `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return new Blob([pdf], { type:'application/pdf' });
  }

  window.bwBuildPdf = buildPdf;

  async function downloadPdf(d) {
    if (d.kind === 'file') { window.open(window.bwDocs.fileUrl(d), '_blank'); return; }
    const tpl = await window.bwDocs.html(d);
    if (tpl) { window.bwTpl.print(tpl, d.title); return; }
    const blob = buildPdf('BeyondWires - ' + d.title, [
      'Document ID: ' + d.id,
      'Type: ' + d.type,
      'Date: ' + fmt(d.date),
      'Status: ' + d.status
    ]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = d.title.replace(/[^\w\-]+/g, '_') + '.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const openModal = () => { viewModal.classList.add('show'); viewModal.setAttribute('aria-hidden', 'false'); };
  const closeModal = () => { viewModal.classList.remove('show'); viewModal.setAttribute('aria-hidden', 'true'); };
  viewModal.addEventListener('click', e => { if (e.target === viewModal || e.target.hasAttribute('data-close')) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  $('dvDownload').addEventListener('click', () => { if (currentDoc) downloadPdf(currentDoc); });

  grid.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const d = documents.find(x => x.id === btn.dataset.id);
    if (!d) return;
    if (btn.dataset.act === 'pdf' || d.kind === 'file') { downloadPdf(d); return; }
    currentDoc = d;
    $('dvTitle').textContent = d.title;
    $('dvType').textContent = d.type;
    $('dvDate').textContent = fmt(d.date);
    $('dvStatus').textContent = d.status;
    const tpl = await window.bwDocs.html(d);
    $('dvPaper').innerHTML = tpl;
    viewModal.querySelector('.inq-modal-card').classList.toggle('has-paper', !!tpl);
    openModal();
  });

  BWC.on(() => { documents = (BWC.state.documents || []).map(d => window.bwDocs.map(d)); render(); });
  render();
})();

/* ===== Installation address: Province -> City -> (District, Manila only) -> Barangay -> Street =====
   Service area: mainland Luzon. The provinces, cities, Manila districts and barangays are in JS/luzon-address.json
   (official PSA PSGC list). The server checks the same file, so only real addresses in the service area are accepted. */
(function () {
  let PROVS = [];                                // [{ name, cities:[{ name, barangays } or { name, districts:[{ name, barangays }] }] }]
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const opts = (list, first) => `<option value="" selected disabled>${first}</option>` + list.map(n => `<option>${esc(n)}</option>`).join('');
  const provOf = el => PROVS.find(p => p.name === el.querySelector('.b-prov').value);
  const cityOf = el => { const p = provOf(el); return p && p.cities.find(c => c.name === el.querySelector('.b-city').value); };
  const STREET_OK = /^[\p{L}\p{N}\s.,#\-\/'()&]+$/u;

  function fieldsHtml() {
    return `
      <div class="si-addr">
        <div class="si-label">Installation Address <span class="si-addr-note">(mainland Luzon only)</span></div>
        <div class="si-addr-row">
          <label class="si-field">Province<select class="b-prov"><option value="" selected disabled>Loading...</option></select></label>
          <label class="si-field">City / Municipality<select class="b-city" disabled><option value="" selected disabled>Choose a province first</option></select></label>
          <label class="si-field b-district-wrap" hidden>District<select class="b-district"></select></label>
          <div class="si-combo">
            <label class="si-field">Barangay<input type="text" class="b-brgy" role="combobox" aria-autocomplete="list" aria-expanded="false" autocomplete="off" placeholder="Choose a city first" disabled></label>
            <div class="si-combo-list" role="listbox" hidden></div>
          </div>
        </div>
        <label class="si-field">House / Unit No., Building, Street
          <input type="text" class="b-street" maxlength="120" placeholder="e.g. Lot 5 Blk 2 Rosal St." autocomplete="address-line1">
        </label>
        <label class="si-field">Landmark (optional)
          <input type="text" class="b-landmark" maxlength="120" placeholder="e.g. Beside 7-Eleven, blue gate">
        </label>
        <small class="pl-status b-addr-status"></small>
      </div>`;
  }

  /* barangays for the chosen city (and district, for Manila) */
  function brgyList(el) {
    const c = cityOf(el);
    if (!c) return null;
    if (!c.districts) return c.barangays;
    const d = c.districts.find(x => x.name === el.querySelector('.b-district').value);
    return d ? d.barangays : null;
  }
  function paintBrgy(el) {
    const list = brgyList(el), input = el.querySelector('.b-brgy');
    input.value = ''; input.disabled = !list; closeList(el);
    input.placeholder = list ? 'Click to choose, or type to search (e.g. 187)'
      : (cityOf(el) ? 'Choose a district first' : 'Choose a city first');
  }

  /* ---- Barangay search dropdown ----
     Click: shows every barangay of the city (even when one is already chosen).
     Type: the list narrows down. Pick with the mouse, or with the arrow keys and Enter. */
  const match = (list, text) => list.find(n => n.toLowerCase() === text.toLowerCase() || n.toLowerCase() === ('barangay ' + text).toLowerCase());
  function openList(el, filter) {
    const list = brgyList(el) || [], input = el.querySelector('.b-brgy'), box = el.querySelector('.si-combo-list');
    const q = (filter || '').trim().toLowerCase();
    const items = q ? list.filter(n => n.toLowerCase().includes(q)).sort((a, b) => (b === match(list, q)) - (a === match(list, q))) : list;
    box.innerHTML = items.map((n, i) => `<div class="si-combo-opt${n === input.value ? ' on' : ''}" role="option" data-i="${i}">${esc(n)}</div>`).join('')
      || '<div class="si-combo-none">No barangay matches. Check the spelling or number.</div>';
    box.hidden = false; input.setAttribute('aria-expanded', 'true');
    const on = box.querySelector('.on') || (q && box.querySelector('.si-combo-opt'));
    if (on) { on.classList.add('active'); on.scrollIntoView({ block: 'nearest' }); }
  }
  function closeList(el) {
    const box = el.querySelector('.si-combo-list'); box.hidden = true; box.innerHTML = '';
    el.querySelector('.b-brgy').setAttribute('aria-expanded', 'false');
  }
  function pick(el, name) {
    el.querySelector('.b-brgy').value = name; closeList(el); paintStatus(el);
  }
  function setup(el) {
    const sel = el.querySelector('.b-prov');
    if (PROVS.length) { sel.innerHTML = opts(PROVS.map(p => p.name), 'Select province...'); return; }
    if (failed) { sel.innerHTML = FAIL_MSG; load(); }        // the list did not load: say so and try again
  }

  /* reads the address parts of one inquiry block; errors are shown on submit */
  function read(el) {
    const v = s => (el.querySelector(s).value || '').replace(/\s+/g, ' ').trim();
    const province = v('.b-prov'), city = v('.b-city'), c = cityOf(el), list = brgyList(el) || [];
    const district = c && c.districts ? v('.b-district') : '';
    const typed = v('.b-brgy'), hit = match(list, typed), barangay = hit || typed;
    const street = v('.b-street'), landmark = v('.b-landmark');
    const errors = [];
    if (!provOf(el)) errors.push('Please choose your province.');
    else if (!c) errors.push('Please choose your city or municipality.');
    else if (c.districts && !district) errors.push('Please choose your district in Manila.');
    else if (!typed) errors.push('Please choose your barangay.');
    else if (!hit) errors.push('Please choose your barangay from the list (' + city + ').');
    if (street.length < 3) errors.push('Please enter your house / unit number, building and street.');
    else if (!STREET_OK.test(street)) errors.push('The street can contain letters, numbers, spaces and . , # - / \' ( ) & only.');
    if (landmark && !STREET_OK.test(landmark)) errors.push('The landmark can contain letters, numbers, spaces and . , # - / \' ( ) & only.');
    const address = [street, barangay, district, city, province].filter(Boolean).join(', ');
    return { errors, address, province, city, district, barangay, street, landmark };
  }

  /* small status line under the address: shows the full address once it is complete */
  function paintStatus(el) {
    const st = el.querySelector('.b-addr-status'), r = read(el);
    const touched = el.querySelector('.b-street').value.trim() || el.querySelector('.b-brgy').value.trim();
    if (!touched) { st.className = 'pl-status b-addr-status'; st.textContent = ''; return; }
    st.className = 'pl-status b-addr-status ' + (r.errors.length ? 'bad' : 'ok');
    st.textContent = r.errors.length ? r.errors[0] : '✓ ' + r.address;
  }

  const wrap = document.getElementById('siBlocks');
  wrap.addEventListener('change', e => {
    const el = e.target.closest('.si-addr'); if (!el) return;
    if (e.target.matches('.b-prov')) {                   // new province: fill its cities, clear the rest
      const city = el.querySelector('.b-city'), p = provOf(el);
      city.innerHTML = opts(p ? p.cities.map(c => c.name) : [], 'Select city / municipality...'); city.disabled = !p;
    }
    if (e.target.matches('.b-prov, .b-city')) {
      const c = cityOf(el), dw = el.querySelector('.b-district-wrap');
      dw.hidden = !(c && c.districts);
      el.querySelector('.b-district').innerHTML = c && c.districts ? opts(c.districts.map(d => d.name), 'Select district...') : '';
      paintBrgy(el);
    }
    if (e.target.matches('.b-district')) paintBrgy(el);
    paintStatus(el);
  });
  wrap.addEventListener('focusout', e => {
    const el = e.target.closest('.si-addr'); if (!el || !e.target.matches('input')) return;
    if (e.target.matches('.b-brgy')) {                   // leaving the box: close the list and tidy what was typed
      closeList(el);
      const hit = match(brgyList(el) || [], e.target.value.trim()); if (hit) e.target.value = hit;
    }
    paintStatus(el);
  });
  /* Barangay search dropdown: open on click, filter while typing, keyboard support */
  wrap.addEventListener('focusin', e => { if (e.target.matches('.b-brgy')) { const el = e.target.closest('.si-addr'); openList(el); e.target.select(); } });
  wrap.addEventListener('click', e => {
    if (!e.target.matches('.b-brgy')) return;
    const el = e.target.closest('.si-addr'); if (el.querySelector('.si-combo-list').hidden) openList(el);
  });
  wrap.addEventListener('input', e => { if (e.target.matches('.b-brgy')) openList(e.target.closest('.si-addr'), e.target.value); });
  wrap.addEventListener('mousedown', e => {
    const opt = e.target.closest('.si-combo-opt'); if (!opt) return;
    e.preventDefault();                                   // keep the focus in the box while picking
    pick(opt.closest('.si-addr'), opt.textContent);
  });
  wrap.addEventListener('keydown', e => {
    if (!e.target.matches('.b-brgy')) return;
    const el = e.target.closest('.si-addr'), box = el.querySelector('.si-combo-list');
    if (e.key === 'Escape') { closeList(el); return; }
    if (box.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { openList(el); e.preventDefault(); return; }
    const opts2 = [...box.querySelectorAll('.si-combo-opt')]; if (!opts2.length) return;
    let i = opts2.findIndex(o => o.classList.contains('active'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      i = e.key === 'ArrowDown' ? Math.min(opts2.length - 1, i + 1) : Math.max(0, i - 1);
      opts2.forEach(o => o.classList.remove('active')); opts2[i].classList.add('active'); opts2[i].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();                                 // Enter picks; it does not submit the form
      pick(el, (opts2[i] || opts2[0]).textContent);
    }
  });

  window.bwNcr = { fieldsHtml, setup, read };
  /* Loads JS/luzon-address.json. If it cannot be loaded (file missing or renamed), every province box says so. */
  const FAIL_MSG = '<option value="" selected disabled>Could not load the address list (JS/luzon-address.json). Please reload the page.</option>';
  let failed = false, busy = false;
  function load() {
    if (busy) return; busy = true;
    fetch('../JS/luzon-address.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(d => { PROVS = d.provinces || []; failed = !PROVS.length; document.querySelectorAll('#siBlocks .si-addr').forEach(el => { if (!el.querySelector('.b-prov').value) setup(el); }); })
      .catch(err => { failed = true; console.error('Address list (JS/luzon-address.json) could not be loaded:', err.message);
        document.querySelectorAll('#siBlocks .b-prov').forEach(s => { if (!s.value) s.innerHTML = FAIL_MSG; }); })
      .finally(() => { busy = false; });
  }
  load();
})();

/* ===== Service Inquiry form ===== */
(function () {
  const $ = id => document.getElementById(id);
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const pad = n => String(n).padStart(2, '0');
  const toIso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fmtDate = iso => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month:'short', day:'2-digit', year:'numeric' });
  };
  const MAX_BLOCKS = 5;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const form = $('siForm'), wrap = $('siBlocks'), errorEl = $('siError');
  let blocks = [];   // one entry per inquiry: { el, site, year, month, date, time, items, more }

  /* Products, Services and Packages come from the Admin "Products" tab (window.bwShared.catalog()).
     Prices are never shown to the customer during an inquiry. */
  const OPTION_TYPES = {
    'Package':  { label:'Choose one or more packages', multi:true, types:['package'], extras:true },   // extras: optional products added to the package
    'Services': { label:'Choose services',  multi:true,  types:['service'] },
    'Products': { label:'Choose products',  multi:true,  types:['product'] }
  };
  const CUSTOM = { label:'Choose products and services', multi:true, types:['service', 'product'] };
  function getCat(opt) {
    if (!opt) return null;
    const o = OPTION_TYPES[opt] || CUSTOM;   // Products and Services -> both lists
    const all = window.bwShared.catalog();
    const items = o.types.flatMap(t => all.filter(c => c.type === t)).map(c => ({ name:c.name, desc:c.desc || c.cat || '', cat:c.cat || '' }));
    return { label:o.label, multi:o.multi, extras:!!o.extras, items };
  }
  window.bwCatalogFor = getCat;

  function show(name, navName) {
    document.querySelectorAll('.section-view').forEach(v => v.classList.toggle('active', v.id === name));
    document.querySelectorAll('.nav-item[data-section]').forEach(n => {
      const on = n.dataset.section === navName;
      n.classList.toggle('active', on);
      if (on) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current');
    });
    history.replaceState(null, '', '#' + name);
    const content = document.querySelector('.content');
    if (content) content.scrollTop = 0;
  }

  /* Same calendar as the Admin schedule: the Admin's open slots minus the slots already booked */
  const availability = d => window.bwShared.dayStatus(toIso(d));
  const paintSlots = b => { b.el.querySelector('.b-slots').innerHTML = window.bwShared.slotButtons(b.date, b.time); };

  function setError(msg) { errorEl.textContent = msg || ''; errorEl.hidden = !msg; }
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  /* ---------- one inquiry block ---------- */
  function blockHtml(n) {
    return `
    <div class="si-block">
      ${n > 1 ? `<div class="si-block-title">Inquiry ${n}</div>` : ''}
      ${window.bwNcr.fieldsHtml()}
      <label class="si-field">Type of Place
        <select class="b-place">
          <option value="" selected disabled>Select type...</option>
          <option>Residential</option>
          <option>Commercial</option>
        </select>
      </label>
      <label class="si-field">What are you inquiring about?
        <select class="b-option">
          <option value="" selected disabled>Select one...</option>
          <option>Package</option>
          <option>Products</option>
          <option>Services</option>
          <option>Products and Services</option>
        </select>
      </label>

      <div class="si-field">Would you like a site visit?
        <div class="si-toggle">
          <button type="button" class="b-yes" data-site="Yes">Yes</button>
          <button type="button" class="b-no" data-site="No">No</button>
        </div>
      </div>

      <div class="si-schedule b-schedule" hidden>
        <div class="si-sched-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>
          Select Preferred Schedule
        </div>
        <div class="si-cal">
          <div class="si-cal-head">
            <button type="button" class="b-prev" aria-label="Previous month">&lsaquo;</button>
            <b class="b-month"></b>
            <button type="button" class="b-next" aria-label="Next month">&rsaquo;</button>
          </div>
          <div class="si-days b-days"></div>
          <div class="si-legend">
            <span><i style="background:var(--blue)"></i>Available</span>
            <span><i style="background:var(--orange)"></i>Limited Slots</span>
            <span><i style="background:#b5bfcd"></i>Unavailable</span>
          </div>
        </div>
        <div class="si-label">Available Time Slots</div>
        <div class="si-slots b-slots"></div>
      </div>

      <div class="si-novisit b-novisit" hidden>
        <div class="si-label b-catalog-label">Selection</div>
        <div class="si-packages b-catalog"></div>
        <label class="si-field">Budget Range
          <select class="b-budget">
            <option value="" selected disabled>Select budget range...</option>
            <option>\u20B110,000 - \u20B125,000</option>
            <option>\u20B125,000 - \u20B150,000</option>
            <option>\u20B150,000 - \u20B1100,000</option>
            <option>\u20B1100,000 and above</option>
            <option value="custom">Custom amount</option>
          </select>
        </label>
        <label class="si-field b-budget-custom-wrap" hidden>Custom Budget (\u20B1)
          <input type="number" class="b-budget-custom" min="5000" max="10000000" step="1" placeholder="\u20B15,000 to \u20B110,000,000">
        </label>
      </div>

      <div class="si-field">Add another inquiry?
        <div class="si-toggle">
          <button type="button" class="b-more-yes" data-more="Yes">Yes</button>
          <button type="button" class="b-more-no" data-more="No">No</button>
        </div>
      </div>
    </div>`;
  }

  function newBlock() {
    const holder = document.createElement('div');
    holder.innerHTML = blockHtml(blocks.length + 1).trim();
    const el = holder.firstElementChild;
    wrap.appendChild(el);
    const b = { el, site:'', year:today.getFullYear(), month:today.getMonth(), date:'', time:'', items:[], extras:[], more:'' };    blocks.push(b);
    window.bwNcr.setup(el);
    renderCalendar(b);
    paintSlots(b);
    renderCatalog(b);
    return b;
  }

  function renderCalendar(b) {
    const q = s => b.el.querySelector(s);
    q('.b-month').textContent = `${MONTHS[b.month]} ${b.year}`;
    q('.b-prev').disabled = b.year === today.getFullYear() && b.month === today.getMonth();

    const firstDow = new Date(b.year, b.month, 1).getDay();
    const daysInMonth = new Date(b.year, b.month + 1, 0).getDate();
    let html = ['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => `<span class="si-dow">${d}</span>`).join('');
    for (let i = 0; i < firstDow; i++) html += '<span></span>';
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(b.year, b.month, day);
      const a = availability(d);
      const iso = toIso(d);
      html += `<button type="button" class="si-day ${a}${iso === b.date ? ' selected' : ''}" data-iso="${iso}" ${a === 'unavailable' ? 'disabled' : ''}>${day}</button>`;
    }
    q('.b-days').innerHTML = html;
  }

  /* Long lists (products) get a search box and a category filter, so the customer is not shown everything at once. */
  const FILTER_FROM = 7;
  function renderCatalog(b) {
    const cat = getCat(b.el.querySelector('.b-option').value);
    b.el.querySelector('.b-catalog-label').textContent = cat ? cat.label : 'Selection';
    const box = b.el.querySelector('.b-catalog');
    if (!cat) { box.innerHTML = '<p class="si-hint">Choose a purchase option above to see what is available.</p>'; return; }
    if (!cat.items.length) { box.innerHTML = '<p class="si-hint">Nothing is available for this option right now.</p>'; return; }
    const cats = [...new Set(cat.items.map(it => it.cat).filter(Boolean))].sort((x, y) => x.localeCompare(y));
    if (b.catF && b.catF !== 'all' && !cats.includes(b.catF)) b.catF = 'all';
    box.innerHTML = (cat.items.length >= FILTER_FROM ? `<div class="si-cat-tools">
        <label class="si-field">Search<input type="search" class="b-cat-q" placeholder="Type a name, e.g. Wi-Fi, 4-Channel, Dahua" value="${esc(b.catQ || '')}" autocomplete="off"></label>
        ${cats.length > 1 ? `<label class="si-field">Category<select class="b-cat-f"><option value="all">All categories</option>${cats.map(c => `<option${c === b.catF ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>` : ''}
      </div>` : '') + '<div class="b-cat-list si-cat-list"></div>' + (cat.extras ? extrasHtml(b) : '');
    renderCatList(b, cat);
    if (cat.extras) renderExList(b);
  }
  /* one list of tick boxes; "picked" = names already chosen, x = true for the extra-products list */
  function listHtml(items, picked, multi, q, f, showPicked, x) {
    q = (q || '').trim().toLowerCase(); f = f || 'all';
    const list = items.filter(it => (f === 'all' || it.cat === f) && (!q || (it.name + ' ' + it.desc + ' ' + it.cat).toLowerCase().includes(q)));
    return (showPicked && picked.length ? `<p class="si-hint si-cat-picked">Selected (${picked.length}): ${esc(picked.join(', '))}</p>` : '') +
      (list.map(it => `
        <button type="button" class="si-pkg${picked.includes(it.name) ? ' selected' : ''}" data-name="${esc(it.name)}"${x ? ' data-x="1"' : ''}>
          <span class="si-pkg-mark ${multi ? 'check' : 'radio'}"></span>
          <span class="si-pkg-info"><b>${esc(it.name)}</b>${it.desc ? `<small>${esc(it.desc)}</small>` : ''}</span>
        </button>`).join('') || '<p class="si-hint">Nothing matches. Try another word or category.</p>');
  }
  function renderCatList(b, cat) {
    cat = cat || getCat(b.el.querySelector('.b-option').value);
    const el = b.el.querySelector('.b-cat-list'); if (!cat || !el) return;
    el.innerHTML = listHtml(cat.items, b.items, cat.multi, b.catQ, b.catF, cat.items.length >= FILTER_FROM);
  }
  /* Package only: optional extra products (e.g. an additional camera or a bigger hard drive) */
  const extraItems = () => getCat('Products').items;
  function extrasHtml(b) {
    const cats = [...new Set(extraItems().map(it => it.cat).filter(Boolean))].sort((x, y) => x.localeCompare(y));
    return `<div class="si-label si-extra-label">Add extra products (optional)</div>
      <p class="si-hint si-extra-hint">Need something more than the package, like an extra camera or a bigger hard drive? Add it here.</p>
      <div class="si-cat-tools">
        <label class="si-field">Search<input type="search" class="b-ex-q" placeholder="Type a name, e.g. camera, 1TB, Wi-Fi" value="${esc(b.exQ || '')}" autocomplete="off"></label>
        <label class="si-field">Category<select class="b-ex-f"><option value="all">All categories</option>${cats.map(c => `<option${c === b.exF ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      </div><div class="b-ex-list si-cat-list"></div>`;
  }
  function renderExList(b) {
    const el = b.el.querySelector('.b-ex-list'); if (!el) return;
    el.innerHTML = listHtml(extraItems(), b.extras, true, b.exQ, b.exF, true, true);
  }

  function setSite(b, v) {
    b.site = v;
    b.el.querySelector('.b-yes').classList.toggle('active', v === 'Yes');
    b.el.querySelector('.b-no').classList.toggle('active', v === 'No');
    b.el.querySelector('.b-schedule').hidden = v !== 'Yes';
    b.el.querySelector('.b-novisit').hidden = v !== 'No';
    if (v === 'No') renderCatalog(b);
  }

  function paintMore(b) {
    b.el.querySelector('.b-more-yes').classList.toggle('active', b.more === 'Yes');
    b.el.querySelector('.b-more-no').classList.toggle('active', b.more === 'No');
  }

  /* Yes adds another inquiry block below; No removes every block after this one */
  function setMore(b, v) {
    const idx = blocks.indexOf(b);
    if (v === 'Yes') {
      if (idx === blocks.length - 1 && blocks.length >= MAX_BLOCKS) {
        return setError(`You can add up to ${MAX_BLOCKS} inquiries in one submission.`);
      }
      b.more = 'Yes'; paintMore(b);
      if (idx === blocks.length - 1) newBlock().el.scrollIntoView({ behavior:'smooth', block:'start' });
    } else {
      b.more = 'No'; paintMore(b);
      blocks.splice(idx + 1).forEach(x => x.el.remove());
    }
  }

  /* ---------- events (delegated, so they work for every block) ---------- */
  const blockOf = target => {
    const el = target.closest('.si-block');
    return el ? blocks.find(x => x.el === el) : null;
  };

  wrap.addEventListener('click', e => {
    const b = blockOf(e.target);
    if (!b) return;
    setError('');

    const siteBtn = e.target.closest('[data-site]');
    if (siteBtn) return setSite(b, siteBtn.dataset.site);

    const moreBtn = e.target.closest('[data-more]');
    if (moreBtn) return setMore(b, moreBtn.dataset.more);

    if (e.target.closest('.b-prev')) {
      if (b.month === 0) { b.month = 11; b.year--; } else b.month--;
      return renderCalendar(b);
    }
    if (e.target.closest('.b-next')) {
      if (b.month === 11) { b.month = 0; b.year++; } else b.month++;
      return renderCalendar(b);
    }

    const day = e.target.closest('.si-day');
    if (day && !day.disabled) {
      if (day.dataset.iso !== b.date) b.time = '';     // a new date needs a new time slot
      b.date = day.dataset.iso; renderCalendar(b); return paintSlots(b);
    }

    const slot = e.target.closest('.b-slots button');
    if (slot) {
      if (slot.disabled) return;
      b.time = slot.dataset.time;
      return paintSlots(b);
    }

    const pkg = e.target.closest('.si-pkg');
    if (pkg && pkg.dataset.x) {                       // extra product under a package
      const name = pkg.dataset.name;
      b.extras = b.extras.includes(name) ? b.extras.filter(n => n !== name) : [...b.extras, name];
      return renderExList(b);
    }
    if (pkg) {
      const cat = getCat(b.el.querySelector('.b-option').value);
      if (!cat) return;
      const name = pkg.dataset.name;
      if (cat.multi) b.items = b.items.includes(name) ? b.items.filter(n => n !== name) : [...b.items, name];
      else b.items = [name];
      renderCatList(b, cat);
    }
  });

  wrap.addEventListener('change', e => {
    const b = blockOf(e.target);
    if (!b) return;
    /* typing fields fire "change" when they lose focus; clearing the error then moved the Submit button
       away from the mouse, so the first click on Submit was lost. Only dropdowns clear the error now. */
    if (!e.target.matches('input')) setError('');
    if (e.target.matches('.b-option')) { b.items = []; b.extras = []; b.catQ = ''; b.catF = 'all'; b.exQ = ''; b.exF = 'all'; renderCatalog(b); }
    if (e.target.matches('.b-cat-f')) { b.catF = e.target.value; renderCatList(b); }
    if (e.target.matches('.b-ex-f')) { b.exF = e.target.value; renderExList(b); }
    if (e.target.matches('.b-budget')) {
      const custom = e.target.value === 'custom';
      b.el.querySelector('.b-budget-custom-wrap').hidden = !custom;
      if (custom) b.el.querySelector('.b-budget-custom').focus();
    }
  });

  wrap.addEventListener('input', e => {
    if (e.target.matches('.b-ex-q')) { const b = blockOf(e.target); if (b) { b.exQ = e.target.value; renderExList(b); } return; }
    if (!e.target.matches('.b-cat-q')) return;
    const b = blockOf(e.target); if (!b) return;
    b.catQ = e.target.value; renderCatList(b);
  });

  /* ---------- validate + submit ---------- */
function validate(b) {
  const q = s => b.el.querySelector(s);
  const errs = [];
    { const r = window.bwNcr.read(b.el); errs.push(...r.errors); }
  if (!q('.b-place').value) errs.push('Please select the type of place.');
  if (!q('.b-option').value) errs.push('Please select a purchase option.');
  if (!b.site) errs.push('Please choose whether you would like a site visit.');
  if (b.site === 'Yes') {
    if (!b.date) errs.push('Please select a preferred date.');
    if (!b.time) errs.push('Please select a preferred time slot.');
    else if (!window.bwShared.canBook(b.date, b.time)) {
      b.time = ''; renderCalendar(b); paintSlots(b);
      errs.push('That time slot was just booked. Please choose another one.');
    } else if (blocks.some(x => x !== b && blocks.indexOf(x) < blocks.indexOf(b) && x.site === 'Yes' && x.date === b.date && x.time === b.time)) {
      errs.push('This time slot is already used by another inquiry in this form. Please choose a different one.');
    }
  }
  if (b.site === 'No') {
    if (!b.items.length) errs.push(q('.b-option').value === 'Package' ? 'Please choose at least one package.' : 'Please select at least one item from the list.');
    const budget = q('.b-budget').value;
    if (!budget) errs.push('Please select a budget range.');
    else if (budget === 'custom') {
      const raw = String(q('.b-budget-custom').value).trim(), n = Number(raw);
      if (!raw || !/^\d+$/.test(raw)) errs.push('Please enter your custom budget as a whole number of pesos (no decimals or symbols).');
      else if (n < 5000) errs.push('The custom budget must be at least \u20B15,000.');
      else if (n > 10000000) errs.push('The custom budget cannot be more than \u20B110,000,000.');
    }
  }
  return errs;
}

  function describe(b, i) {
    const q = s => b.el.querySelector(s);
    const parts = [`Address: ${window.bwNcr.read(b.el).address}`, `Place: ${q('.b-place').value}`, `Purchase: ${q('.b-option').value}`];
    if (b.site === 'Yes') {
      parts.push(`Preferred visit: ${fmtDate(b.date)}, ${b.time}`);
    } else {
      const budget = q('.b-budget').value === 'custom'
        ? '\u20B1' + Number(q('.b-budget-custom').value).toLocaleString('en-US')
        : q('.b-budget').value;
      parts.push(`Selected: ${b.items.concat(b.extras).join(', ')}`, `Budget: ${budget}`);
    }
    return (blocks.length > 1 ? `#${i + 1} ` : '') + parts.join(' | ');
  }

  /* Structured copy of one inquiry block, used by the View popup */

function collect(b) {
  const q = s => b.el.querySelector(s);
  const budget = q('.b-budget').value === 'custom'
    ? '\u20B1' + Number(q('.b-budget-custom').value).toLocaleString('en-US')
    : q('.b-budget').value;
  const a = window.bwNcr.read(b.el);
  return {
    address: a.address, province: a.province, city: a.city, district: a.district, barangay: a.barangay, street: a.street, landmark: a.landmark,
    place: q('.b-place').value,
    option: q('.b-option').value,
    site: b.site,
    visit: b.site === 'Yes' ? `${fmtDate(b.date)} \u2022 ${b.time}` : '',
    visitDate: b.site === 'Yes' ? b.date : '',
    visitTime: b.site === 'Yes' ? b.time : '',
    items: b.site === 'No' ? [...b.items, ...b.extras] : [],   // packages + optional extra products
    budget: b.site === 'No' ? budget : ''
  };
};


  function resetForm() {
    form.reset();
    wrap.innerHTML = '';
    blocks = [];
    newBlock();
    setError('');
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (window.__inqLimit.reached()) return setError('You have reached the limit of ' + window.__inqLimit.max + ' inquiries.');
    if (blocks.length > window.__inqLimit.remaining()) return setError(`You can submit ${window.__inqLimit.remaining()} more inquir${window.__inqLimit.remaining() === 1 ? 'y' : 'ies'} (limit ${window.__inqLimit.max}). Remove some inquiries from this form.`);
    const all = [];
    blocks.forEach((b, i) => {
      const errs = validate(b);
      if (!errs.length) return;
      if (blocks.length > 1) all.push(`Inquiry ${i + 1}:`);
      errs.forEach(m => all.push('• ' + m));
    });
    if (all.length) return setError(all.join('\n'));

    /* Each block becomes one inquiry on the server, which re-checks everything
       (address in the service area, free published slot, items, budget, the 10-inquiry limit) and books the site visit. */
    const ids = name => { const c = window.bwShared.catalog().find(x => x.name === name); return c ? c.id : 0; };
    const payload = blocks.map(b => {
      const d = collect(b);
      return { installation_address: d.address, province: d.province, city: d.city, district: d.district, barangay: d.barangay, street: d.street, landmark: d.landmark,
        place_type: d.place, purchase_option: C.OPTION_KEY[d.option] || 'both',
        needs_site_visit: d.site === 'Yes', visit_date: d.visitDate, visit_slot: d.visitTime,
        items: d.items.map(ids).filter(Boolean), budget_range: d.budget };
    });
    const btn = form.querySelector('button[type="submit"]'); btn.disabled = true;
    let res;
    try { res = await api('/customer/inquiries', { body: { blocks: payload } }); }
    catch (err) {
      btn.disabled = false;
      if (err.status === 409) { await BWC.reload('calendar'); blocks.forEach(b => { if (b.time && !window.bwShared.canBook(b.date, b.time)) b.time = ''; renderCalendar(b); paintSlots(b); }); }
      if (err.status === 401 || err.status === 403) {
        // session expired or not recognised as a customer: re-check it (sends you to sign-in if needed)
        try { await window.BW.guard('customer'); } catch (e2) {}
        return setError('We could not submit your inquiry. Please refresh the page and try again. If it keeps happening, sign in again.');
      }
      return setError(err.message);
    }
    btn.disabled = false;
    resetForm();
    show('inquiries', 'inquiries');
    await BWC.reload('calendar');
    if (window.__inqShowNew) window.__inqShowNew(res.inquiry_ids || [res.inquiry_id]);
  });

/* "+ New Inquiry" and the dashboard "Inquire Now!" button both open the form directly. */
document.addEventListener('click', e => {
  if (!e.target.closest('#newInquiryBtn, #inquireBtn')) return;
  e.stopPropagation();
  if (window.__inqLimit && window.__inqLimit.reached()) { window.__inqLimit.notify(); return; }
  document.querySelectorAll('.dropdown-menu.show,.inq-date-pop.show')
    .forEach(el => el.classList.remove('show'));
  resetForm();
  show('service-inquiry', 'inquiries');      // keeps "My Inquiries" highlighted
}, true);

$('siBack').addEventListener('click', () => {
  resetForm();
  show('inquiries', 'inquiries');
});

/* Fresh server data (catalog or calendar changed): keep the open form valid */
BWC.on(() => {
  blocks.forEach(b => {
    if (b.time && !window.bwShared.canBook(b.date, b.time)) b.time = '';
    const names = (getCat(b.el.querySelector('.b-option').value) || { items:[] }).items.map(x => x.name);
    b.items = b.items.filter(n => names.includes(n));
    const extra = getCat('Products').items.map(x => x.name); b.extras = b.extras.filter(n => extra.includes(n));
    renderCalendar(b); paintSlots(b); renderCatalog(b);
  });
});
/* the read-only name and email are the signed-in account */
form.querySelectorAll('input[readonly]').forEach((el, i) => { if (i > 1) return; el.value = i === 0 ? (ME.name || '') : [ME.email, ME.phone_number].filter(Boolean).join(' / '); });

  resetForm();
})();

/* ===== Quotation Payment Flow (steps 2 & 3 + declined card) ===== */
(function () {
  const $ = id => document.getElementById(id);
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const pad = n => String(n).padStart(2, '0');
  const toIso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fmtDate = iso => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month:'short', day:'2-digit', year:'numeric' });
  };
  const peso = n => '\u20B1' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const AGREE = { 'Half payment upon quotation': 'Half upon quotation', 'Full payment upon quotation': 'Full upon quotation' };   // page label -> server value
  const METHOD = { 'Online Payment': 'Online', 'Over the counter': 'Over the counter' };

  /* Replace img with your real QR image paths, e.g. img:'../IMG/gcash-qr.png' */
  const CHANNELS = [
    { name:'GCash',     acct:'CL******N I. \u2022 +63 975 203 \u2022\u2022\u2022\u2022', img:'../Assets/gcash-qr.png' },
    { name:'UnionBank', acct:'CLARISSAN ISABELO \u2022 **** **** 7466',               img:'../Assets/unionbank-qr.png' },
    { name:'MariBank',  acct:'CLARISSAN ISABELO \u2022 ****3823',                     img:'../Assets/maribank-qr.png' }
  ];

  let q = null;           // quotation currently going through the flow
  let plan = null;        // step 2 answers (sent to the server when step 2 is submitted)
  let payment = null;     // the payment row being paid in step 3
  let channelIdx = 0;
  let proofFile = null, proofData = '';
  const s = { year:today.getFullYear(), month:today.getMonth(), date:'', time:'' };

  /* Same calendar as the Admin schedule (published slots minus booked slots) */
  const availability = d => window.bwShared.dayStatus(toIso(d));
  const paintSlots = () => { $('qpSlots').innerHTML = window.bwShared.slotButtons(s.date, s.time); };

  function go(name) {
    document.querySelectorAll('.section-view').forEach(v => v.classList.toggle('active', v.id === name));
    document.querySelectorAll('.nav-item[data-section]').forEach(n => {
      const on = n.dataset.section === 'quotations';
      n.classList.toggle('active', on);
      if (on) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current');
    });
    history.replaceState(null, '', '#' + name);
    const c = document.querySelector('.content'); if (c) c.scrollTop = 0;
  }
  function toast(msg) {
    const t = $('qpToast'); t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2800);
  }
  function setErr(el, msg) { el.textContent = msg || ''; el.hidden = !msg; }

  /* ---------- Declined card ---------- */
  const decl = $('quoDeclineModal');
  const openDecl = () => { decl.classList.add('show'); decl.setAttribute('aria-hidden', 'false'); };
  const closeDecl = () => { decl.classList.remove('show'); decl.setAttribute('aria-hidden', 'true'); };
  decl.addEventListener('click', e => { if (e.target === decl) closeDecl(); });   // click outside = nothing changes
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDecl(); });

  document.addEventListener('quo:reject', e => { q = e.detail; openDecl(); });

  async function decline(action) {
    if (!q) return;
    try { await api(`/customer/quotations/${q.dbId}/decline`, { body: { action } }); }
    catch (e) { closeDecl(); return toast(e.message); }
    const id = q.id; closeDecl(); q = null;
    await BWC.reload();
    go('quotations');
    toast(action === 'revise' ? `Thanks! We'll prepare a revised quotation for ${id}.` : `Got it. We've closed ${id} for now.`);
  }
  $('qdRequest').addEventListener('click', () => decline('revise'));
  $('qdCancel').addEventListener('click', () => decline('cancel'));

  /* ---------- Step 2 ---------- */
  document.addEventListener('quo:approve', e => {
    q = e.detail; plan = null;
    s.year = today.getFullYear(); s.month = today.getMonth(); s.date = ''; s.time = '';
    $('qpForm').reset();
    setErr($('qpError'), '');
    renderCal(); paintSlots();
    go('quotation-schedule');
  });

  function renderCal() {
    $('qpMonth').textContent = `${MONTHS[s.month]} ${s.year}`;
    $('qpPrev').disabled = s.year === today.getFullYear() && s.month === today.getMonth();
    const firstDow = new Date(s.year, s.month, 1).getDay();
    const dim = new Date(s.year, s.month + 1, 0).getDate();
    let html = ['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => `<span class="si-dow">${d}</span>`).join('');
    for (let i = 0; i < firstDow; i++) html += '<span></span>';
    for (let day = 1; day <= dim; day++) {
      const d = new Date(s.year, s.month, day), a = availability(d), iso = toIso(d);
      html += `<button type="button" class="si-day ${a}${iso === s.date ? ' selected' : ''}" data-iso="${iso}" ${a === 'unavailable' ? 'disabled' : ''}>${day}</button>`;
    }
    $('qpDays').innerHTML = html;
  }
  $('qpPrev').addEventListener('click', () => { if (s.month === 0) { s.month = 11; s.year--; } else s.month--; renderCal(); });
  $('qpNext').addEventListener('click', () => { if (s.month === 11) { s.month = 0; s.year++; } else s.month++; renderCal(); });
  $('qpDays').addEventListener('click', e => {
    const d = e.target.closest('.si-day');
    if (d && !d.disabled) {
      if (d.dataset.iso !== s.date) s.time = '';
      s.date = d.dataset.iso; setErr($('qpError'), ''); renderCal(); paintSlots();
    }
  });
  $('qpSlots').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    s.time = b.dataset.time; setErr($('qpError'), '');
    $('qpSlots').querySelectorAll('button').forEach(x => x.classList.toggle('selected', x === b));
  });

  $('qpBack').addEventListener('click', () => go('quotation-view'));
  // step 2 is already saved on the server, so "Back" returns to the quotation itself
  if ($('qpPayBack')) $('qpPayBack').addEventListener('click', () => { if (window.bwQuo.current()) window.bwQuo.open(window.bwQuo.current().dbId); else go('quotations'); });
  // keep the calendar in step with the Admin schedule while it is open
  window.addEventListener('storage', e => {
    if (e.key === window.bwShared.ADMIN_KEY && $('quotation-schedule').classList.contains('active')) {
      if (s.time && !window.bwShared.canBook(s.date, s.time)) s.time = '';
      renderCal(); paintSlots();
    }
  });

  $('qpForm').addEventListener('submit', async e => {
    e.preventDefault();
    const errs = [];
    if (!s.date) errs.push('\u2022 Please select an installation date.');
    if (!s.time) errs.push('\u2022 Please select a time slot.');
    if (!$('qpAgreement').value) errs.push('\u2022 Please select a payment agreement.');
    if (!$('qpMethod').value) errs.push('\u2022 Please select a payment method.');
    if (s.date && s.time && !window.bwShared.canBook(s.date, s.time)) {
      s.time = ''; renderCal(); paintSlots();
      errs.push('\u2022 That time slot was just booked. Please choose another one.');
    }
    if (errs.length) return setErr($('qpError'), errs.join('\n'));
    plan = { date:s.date, time:s.time, agreement:$('qpAgreement').value, method:$('qpMethod').value };
    // the server books the installation slot, creates the project and the payment(s)
    const btn = $('qpForm').querySelector('.qp-submit'); btn.disabled = true;
    try {
      await api(`/customer/quotations/${q.dbId}/approve`, { body: {
        payment_agreement: AGREE[plan.agreement] || plan.agreement, payment_method: METHOD[plan.method] || plan.method,
        install_date: plan.date, install_slot: plan.time } });
    } catch (err) {
      btn.disabled = false;
      if (err.status === 409) { s.time = ''; await BWC.reload('calendar'); renderCal(); paintSlots(); }
      return setErr($('qpError'), '\u2022 ' + err.message);
    }
    btn.disabled = false;
    await BWC.reload('calendar');
    payment = C.duePayment(q.dbId);
    if (!payment) { go('quotations'); return toast(`Quotation ${q.id} approved. Your installation is booked.`); }
    preparePayment();
    go('quotation-payment');
  });
  /* "Proceed to payment" on an approved quotation (down payment, final balance or a re-upload) */
  document.addEventListener('quo:pay', e => {
    q = e.detail; payment = C.duePayment(q.dbId); if (!payment) return;
    const ap = (q.detail && q.detail.approval) || {};
    plan = { agreement: ap.payment_agreement || payment.payment_agreement, method: payment.payment_method === 'Online' ? 'Online Payment' : 'Over the counter' };
    preparePayment();
    go('quotation-payment');
  });

  /* ---------- Step 3 ---------- */
  function qrSvg(seed) {   // placeholder QR, replaced by CHANNELS[i].img when provided
    const N = 25; let x = seed * 9301 + 49297;
    const rnd = () => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
    const inF = (i, j) => (i < 8 && j < 8) || (i >= N - 8 && j < 8) || (i < 8 && j >= N - 8);
    const finder = (ox, oy) => `<rect x="${ox}" y="${oy}" width="7" height="7"/><rect x="${ox+1}" y="${oy+1}" width="5" height="5" fill="#fff"/><rect x="${ox+2}" y="${oy+2}" width="3" height="3"/>`;
    let r = '';
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (!inF(i, j) && rnd() > .52) r += `<rect x="${i}" y="${j}" width="1" height="1"/>`;
    return `<svg class="qr-img" viewBox="-1 -1 27 27" shape-rendering="crispEdges" fill="#0d2143">${r}${finder(0,0)}${finder(N-7,0)}${finder(0,N-7)}</svg>`;
  }

  const strip = $('qpQrStrip');
  function buildQr() {
    strip.innerHTML = CHANNELS.map((c, i) => `
      <div class="qp-qr">
        ${c.img ? `<img class="qr-img" src="${c.img}" alt="${c.name} QR">` : qrSvg(i + 3)}
        <b>${c.name}</b><small>${c.acct}</small>
      </div>`).join('');
    $('qpDots').innerHTML = CHANNELS.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('');
    strip.scrollLeft = 0; channelIdx = 0;
  }
  strip.addEventListener('scroll', () => {
    const i = Math.round(strip.scrollLeft / (strip.clientWidth + 12));
    if (i === channelIdx) return;
    channelIdx = Math.min(Math.max(i, 0), CHANNELS.length - 1);
    $('qpDots').querySelectorAll('i').forEach((d, n) => d.classList.toggle('on', n === channelIdx));
    updateMethodView();
  });
  const step = dir => strip.scrollBy({ left: dir * (strip.clientWidth + 12), behavior:'smooth' });
  $('qpQrPrev').addEventListener('click', () => step(-1));
  $('qpQrNext').addEventListener('click', () => step(1));
  strip.addEventListener('wheel', e => {      // mouse wheel scrolls the QR list sideways
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault(); strip.scrollLeft += e.deltaY;
  }, { passive:false });

  const isOnline = () => plan && (plan.method === 'Online Payment' || plan.method === 'Online');
  function updateMethodView() {
    $('qpMethodView').value = isOnline() ? `Online Payment \u2022 ${CHANNELS[channelIdx].name}` : 'Over the counter';
  }
  const amountDue = () => Number(payment ? payment.amount_due : 0);
  const quoteTotal = () => Number(((q && q.detail) || {}).total_amount || (q && q.raw && q.raw.total_amount) || 0);

  function preparePayment() {
    const total = quoteTotal(), due = amountDue();
    $('qpAmount').textContent = peso(due);
    $('qpAgreeNote').textContent = payment.installment === 'Final balance'
      ? `Remaining balance of ${peso(total)} after installation.`
      : due < total - 0.009 ? `50% of ${peso(total)}. Balance of ${peso(total - due)} is due after installation.` : `Full payment of ${peso(total)}.`;
    if (payment.status === 'Rejected' && payment.reject_reason) $('qpAgreeNote').textContent += ` Your last proof was not accepted: ${payment.reject_reason}`;
    $('qpOnline').hidden = !isOnline();
    $('qpOtc').hidden = isOnline();
    if (isOnline()) buildQr();
    updateMethodView();
    clearProof();
    $('qpRef').value = ''; $('qpNote').value = ''; $('qpPayDate').value = '';
    $('qpPayDate').max = toIso(today); $('qpNote').maxLength = 200; $('qpRef').maxLength = 4;
    setErr($('qpProofError'), '');
  }

  /* ---------- Photo / proof upload ---------- */
  const fileEl = $('qpFile'), drop = $('qpDrop');
  function clearProof() {
    proofFile = null; proofData = ''; fileEl.value = '';
    $('qpPreview').hidden = true; $('qpDropIdle').hidden = false; $('qpThumb').hidden = true;
  }
  function setFile(f) {
    if (!f) return;
    const okType = /^image\/(jpeg|png)$/.test(f.type) || f.type === 'application/pdf';
    if (!okType) return setErr($('qpProofError'), 'Please upload a JPG, PNG or PDF file.');
    if (f.size > 5 * 1024 * 1024) return setErr($('qpProofError'), 'File is too large. Maximum size is 5MB.');
    setErr($('qpProofError'), '');
    proofFile = f; proofData = '';
    $('qpFileName').textContent = f.name;
    $('qpDropIdle').hidden = true; $('qpPreview').hidden = false;
    const thumb = $('qpThumb');
    if (f.type.startsWith('image/')) {
      const r = new FileReader();
      r.onload = () => { proofData = r.result; thumb.src = r.result; thumb.hidden = false; };
      r.readAsDataURL(f);
    } else thumb.hidden = true;
  }
  fileEl.addEventListener('change', () => setFile(fileEl.files[0]));
  $('qpRemove').addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); clearProof(); });
  ['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => setFile(e.dataTransfer.files[0]));

  /* ---------- Submit proof -> server -> exit ---------- */
  $('qpProofForm').addEventListener('submit', async e => {
    e.preventDefault();
    const errs = [];
    if (!proofFile) errs.push('\u2022 Please upload your proof of payment.');
    const ref = $('qpRef').value.trim();
    if (!ref) errs.push('\u2022 Please enter the last 4 digits of your reference / transaction number.');
    else if (!/^\d{4}$/.test(ref)) errs.push('\u2022 Enter exactly the last 4 digits of your reference / transaction number (numbers only).');
    const pd = $('qpPayDate').value;
    const qDate = String(((q && q.detail) || {}).date_created || (q && q.date) || '').slice(0, 10);
    if (!pd) errs.push('\u2022 Please select the payment date.');
    else if (pd > toIso(today)) errs.push('\u2022 Payment date cannot be in the future.');
    else if (qDate && pd < qDate) errs.push('\u2022 Payment date cannot be before the quotation date (' + fmtDate(qDate) + ').');
    if ($('qpNote').value.trim().length > 200) errs.push('\u2022 The note must be 200 characters or fewer.');
    if (errs.length) return setErr($('qpProofError'), errs.join('\n'));

    const fd = new FormData();
    fd.append('proof', proofFile); fd.append('reference_no', ref); fd.append('payment_date', pd);
    const btn = $('qpProofForm').querySelector('.qp-submit'); btn.disabled = true;
    try { await api(`/customer/payments/${payment.payment_id}/proof`, { form: fd }); }
    catch (err) { btn.disabled = false; return setErr($('qpProofError'), '\u2022 ' + err.message); }
    btn.disabled = false;
    const id = q.id;
    q = null; plan = null; payment = null; clearProof();
    await BWC.reload();
    go('quotations');
    toast(`Payment proof for ${id} submitted`);
  });
})();

/* ===== System Settings ===== */
(function () {
  const $ = id => document.getElementById(id);
  const THEME_KEY = 'bw_theme', PROFILE_KEY = 'bw_profile', CONTACT_KEY = 'bw_contact';
  const load = (k, fb) => { try { const v = JSON.parse(localStorage.getItem(k)); return v || fb; } catch (e) { return fb; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const readText = sel => ((document.querySelector(sel) || {}).textContent || '').trim();

  /* ---------- Validation ---------- */
  // Names: letters and spaces only. Numbers and symbols are not allowed.
  const validName = v => /^[\p{L}]+(?:\s+[\p{L}]+)*$/u.test(v);

  // Gmail: 6-30 letters, numbers or periods; no leading/trailing/double periods; @gmail.com only.
  function validGmail(value) {
    const m = value.toLowerCase().match(/^([a-z0-9.]+)@gmail\.com$/);
    if (!m) return false;
    const u = m[1];
    if (u.length < 6 || u.length > 30) return false;
    if (u.startsWith('.') || u.endsWith('.')) return false;
    if (u.includes('..')) return false;
    return true;
  }
  const validEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);          // any email (contacts)
  const validRole  = v => /^\p{L}[\p{L}\s.\-/&]{1,49}$/u.test(v);           // letters, spaces, . - / &

  // PH mobile: +63 9XX XXX XXXX, 09XXXXXXXXX or 9XXXXXXXXX. Returns the formatted number, or null.
  function normPhone(v) {
    const m = v.replace(/[\s\-().]/g, '').match(/^(?:\+?63|0)?(9\d{9})$/);
    if (!m) return null;
    const n = m[1];
    return `+63 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  }

  /* Account details and the primary contact are saved on the server (theme stays in this browser). */
  const profile = { name: ME.name, email: ME.email, phone: ME.phone_number || '' };
  const contact = { name: ME.contact_name || ME.name, role: ME.contact_role || '', email: ME.contact_email || ME.email, phone: ME.contact_phone || ME.phone_number || '' };
  let savedTheme = load(THEME_KEY, 'light');
  let selectedTheme = savedTheme;

  let toastTimer;
  function toast(msg) {
    const t = $('stToast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }
  function setErr(id, msg) {
    $(id).closest('.st-input').classList.toggle('invalid', !!msg);
    $(id + 'Err').textContent = msg || '';
  }

  const dirty = new Set();
  function paintStatus() {
    const d = dirty.size > 0 || selectedTheme !== savedTheme;
    $('stStatus').classList.toggle('dirty', d);
    $('stStatusText').textContent = d ? 'Unsaved changes' : 'All settings up to date';
  }

  /* Push the saved profile into the top bar, account menu and welcome heading */
  function syncTopbar() {
    const parts = profile.name.split(/\s+/).filter(Boolean);
    const initials = ((parts[0] || '')[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '');
    const set = (sel, text) => { const el = document.querySelector(sel); if (el) el.textContent = text; };
    set('.avatar', initials.toUpperCase());
    set('.profile-name', profile.name);
    set('.user-name', profile.name);
    set('.user-email', profile.email);
    const f0 = parts[0] || '', f1 = f0.charAt(0).toUpperCase() + f0.slice(1);
    set('.welcome h1', f1 ? `Welcome back, ${f1}!` : 'Welcome back!');
  }

  function fillForms() {
    $('stFullName').value = profile.name;
    $('stEmail').value = profile.email;
    $('stPhone').value = profile.phone;
    $('stCName').value = contact.name;
    $('stCRole').value = contact.role;
    $('stCEmail').value = contact.email;
    $('stCPhone').value = contact.phone;
  }

  /* Typing clears that field's error and flags the form as unsaved */
  document.querySelectorAll('#settings .st-input input').forEach(inp => {
    inp.addEventListener('input', () => {
      setErr(inp.id, '');
      const form = inp.closest('form');
      if (form) dirty.add(form.id);
      paintStatus();
    });
  });

  /* ---------- Theme ---------- */
  function applyTheme(t) { document.documentElement.setAttribute('data-theme', t); }
  function paintTheme() {
    document.querySelectorAll('.st-theme').forEach(b => {
      const t = b.dataset.themeOpt;
      b.classList.toggle('selected', t === selectedTheme);
      b.classList.toggle('is-active', t === savedTheme);
      b.setAttribute('aria-pressed', String(t === selectedTheme));
    });
    paintStatus();
  }
  document.querySelectorAll('.st-theme').forEach(b => {
    b.addEventListener('click', () => { selectedTheme = b.dataset.themeOpt; paintTheme(); });
  });
  $('stSaveTheme').addEventListener('click', () => {
    savedTheme = selectedTheme;
    save(THEME_KEY, savedTheme);
    applyTheme(savedTheme);
    paintTheme();
    toast(`${savedTheme === 'dark' ? 'Dark' : 'Light'} mode applied`);
  });

  /* ---------- Account: personal information ---------- */
  $('stProfileForm').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('stFullName').value.trim().replace(/\s+/g, ' ');
    const email = $('stEmail').value.trim().toLowerCase();
    const phone = normPhone($('stPhone').value.trim());
    let ok = true;

    if (!name) { setErr('stFullName', 'Please enter your full name.'); ok = false; }
    else if (!validName(name)) { setErr('stFullName', 'Full name can contain letters and spaces only.'); ok = false; }
    else if (name.length < 2 || name.length > 60) { setErr('stFullName', 'Full name must be 2 to 60 characters.'); ok = false; }

    if (!validGmail(email)) {
      setErr('stEmail', 'Enter a valid Gmail address. Use 6\u201330 letters, numbers, or periods before @gmail.com.');
      ok = false;
    }
    if (!phone) { setErr('stPhone', 'Enter a valid PH mobile number, e.g. +63 917 824 6310.'); ok = false; }
    if (!ok) return;
    try { await api('/auth/profile', { body: { full_name: name, email, phone_number: phone } }); }
    catch (err) { return setErr(/email/i.test(err.message) ? 'stEmail' : /phone|mobile/i.test(err.message) ? 'stPhone' : 'stFullName', err.message); }
    Object.assign(profile, { name, email, phone });
    ME.name = name; ME.email = email; ME.phone_number = phone;
    fillForms();
    syncTopbar();
    dirty.delete('stProfileForm'); paintStatus();
    toast('Account details updated');
  });

  /* ---------- Account: change password ---------- */
  const EYE_ON = '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24"><path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.1 4.1"/><path d="M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7c1.2 0 2.3-.2 3.3-.6"/></svg>';

  document.querySelectorAll('.st-eye').forEach(btn => {
    btn.innerHTML = EYE_ON;
    btn.addEventListener('click', () => {
      const input = $(btn.dataset.target);
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      btn.innerHTML = reveal ? EYE_OFF : EYE_ON;
      btn.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
    });
  });

  $('stPwForm').addEventListener('submit', async e => {
    e.preventDefault();
    const cur = $('stCurPw').value, nw = $('stNewPw').value, cf = $('stConfPw').value;
    let ok = true;

    if (!cur) { setErr('stCurPw', 'Please enter your current password.'); ok = false; }

    if (nw.length < 8 || !/\d/.test(nw)) { setErr('stNewPw', 'Use at least 8 characters and include a number.'); ok = false; }
    else if (nw.length > 64) { setErr('stNewPw', 'Use 64 characters or fewer.'); ok = false; }
    else if (/\s/.test(nw)) { setErr('stNewPw', 'Spaces are not allowed.'); ok = false; }
    else if (!/[A-Za-z]/.test(nw)) { setErr('stNewPw', 'Include at least one letter.'); ok = false; }
    else if (nw === cur) { setErr('stNewPw', 'New password must be different from the current one.'); ok = false; }

    if (!cf) { setErr('stConfPw', 'Please confirm your new password.'); ok = false; }
    else if (cf !== nw) { setErr('stConfPw', 'Passwords do not match.'); ok = false; }
    if (!ok) return;
    try { await api('/auth/password', { body: { current_password: cur, new_password: nw, confirm_password: cf } }); }
    catch (err) { return setErr(err.status === 403 ? 'stCurPw' : 'stNewPw', err.message); }
    $('stPwForm').reset();
    document.querySelectorAll('.st-eye').forEach(b => { $(b.dataset.target).type = 'password'; b.innerHTML = EYE_ON; });
    dirty.delete('stPwForm'); paintStatus();
    toast('Password changed successfully');
  });

  /* ---------- Recovery email (api/auth.php: /auth/recovery, /auth/recovery/verify, /auth/recovery/remove) ---------- */
  let recovery = ME.recovery_email || '', recPending = '';   // recPending = email waiting for its code
  function paintRecovery() {
    $('stRecNow').textContent = recPending ? `Enter the code we sent to ${recPending}.` : recovery ? `Current recovery email: ${recovery}` : 'You have not added a recovery email yet.';
    $('stRecCodeBox').hidden = !recPending;
    $('stRecEmail').readOnly = !!recPending;
    $('stRecOther').hidden = !recPending && !recovery;
    $('stRecOther').textContent = recPending ? 'Cancel' : 'Remove';
    $('stRecBtn').textContent = recPending ? 'Verify code' : recovery ? 'Change recovery email' : 'Send code';
  }
  function recDone(msg) { recPending = ''; $('stRecForm').reset(); setErr('stRecEmail', ''); setErr('stRecCode', ''); dirty.delete('stRecForm'); paintStatus(); paintRecovery(); if (msg) toast(msg); }
  $('stRecForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('stRecBtn');
    if (!recPending) {
      const email = $('stRecEmail').value.trim().toLowerCase();
      if (!validEmail(email) || email.length > 100) return setErr('stRecEmail', 'Enter a valid email address.');
      if (email === String(profile.email).toLowerCase()) return setErr('stRecEmail', 'Use an email different from your main email.');
      btn.disabled = true;
      try { await api('/auth/recovery', { body: { email } }); recPending = email; paintRecovery(); $('stRecCode').focus(); toast('Code sent to ' + email); }
      catch (err) { setErr('stRecEmail', err.message); }
      finally { btn.disabled = false; }
      return;
    }
    const code = $('stRecCode').value.trim();
    if (!/^\d{6}$/.test(code)) return setErr('stRecCode', 'Enter the 6-digit code from the email.');
    btn.disabled = true;
    try { const r = await api('/auth/recovery/verify', { body: { code } }); recovery = r.recovery_email; recDone('Recovery email saved'); }
    catch (err) { setErr('stRecCode', err.message); }
    finally { btn.disabled = false; }
  });
  $('stRecOther').addEventListener('click', async () => {
    if (recPending) return recDone();
    if (!confirm('Remove ' + recovery + ' as your recovery email?')) return;
    try { await api('/auth/recovery/remove', { body: {} }); recovery = ''; recDone('Recovery email removed'); }
    catch (err) { toast(err.message); }
  });
  paintRecovery();

  /* ---------- Contacts ---------- */
  $('stContactForm').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('stCName').value.trim().replace(/\s+/g, ' ');
    const role = $('stCRole').value.trim().replace(/\s+/g, ' ');
    const email = $('stCEmail').value.trim().toLowerCase();
    const phone = normPhone($('stCPhone').value.trim());
    let ok = true;

    if (!name) { setErr('stCName', 'Please enter the contact name.'); ok = false; }
    else if (!validName(name)) { setErr('stCName', 'Contact name can contain letters and spaces only.'); ok = false; }
    else if (name.length < 2 || name.length > 60) { setErr('stCName', 'Contact name must be 2 to 60 characters.'); ok = false; }

    if (!role) { setErr('stCRole', 'Please enter the role or position.'); ok = false; }
    else if (!validRole(role)) { setErr('stCRole', 'Role can contain letters, spaces and . - / & only.'); ok = false; }

    if (!validEmail(email) || email.length > 100 || /\.\./.test(email)) { setErr('stCEmail', 'Enter a valid email address (100 characters or fewer).'); ok = false; }
    if (!phone) { setErr('stCPhone', 'Enter a valid PH mobile number, e.g. +63 917 824 6310.'); ok = false; }
    if (!ok) return;
    try { await api('/customer/contact', { body: { contact_name: name, contact_role: role, contact_email: email, contact_phone: phone } }); }
    catch (err) { return setErr(/role/i.test(err.message) ? 'stCRole' : /email/i.test(err.message) ? 'stCEmail' : /mobile|phone/i.test(err.message) ? 'stCPhone' : 'stCName', err.message); }
    Object.assign(contact, { name, role, email, phone });
    fillForms();
    dirty.delete('stContactForm'); paintStatus();
    toast('Primary contact saved');
  });

  /* Primary contact: for commercial clients only (another person may handle the installation on site).
     Shown once the customer has a Commercial inquiry; otherwise the support channels use the full width. */
  function paintContact() {
    const show = (BWC.state.inquiries || []).some(i => i.place_type === 'Commercial'), form = $('stContactForm');
    form.hidden = !show;
    form.parentElement.style.gridTemplateColumns = show ? '' : '1fr';
    form.nextElementSibling.style.border = show ? '' : '0';
  }
  BWC.on(paintContact);
  paintContact();

  if ($('stCrumbHome')) $('stCrumbHome').addEventListener('click', e => {
    e.preventDefault();
    document.querySelector('.nav-item[data-section="dashboard"]').click();
  });

  [['stFullName', 60], ['stEmail', 100], ['stPhone', 20], ['stCName', 60], ['stCRole', 50], ['stCEmail', 100], ['stCPhone', 20], ['stCurPw', 64], ['stNewPw', 64], ['stConfPw', 64]]
    .forEach(([id, n]) => { if ($(id)) $(id).maxLength = n; });
  fillForms();
  syncTopbar();
  applyTheme(savedTheme);
  paintTheme();
})();

/* ===== Change Schedule popup (reusable) ===== */
(function () {
  const $ = id => document.getElementById(id);
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const pad = n => String(n).padStart(2, '0');
  const toIso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  // Same calendar as the Admin schedule; the customer's own current booking does not block its slot
  const avail = d => window.bwShared.dayStatus(toIso(d), cfg && cfg.bookingId);

  const modal = $('rsModal'), err = $('rsError');
  let cfg = null;
  const s = { year:0, month:0, date:'', time:'' };

  const setErr = m => { err.textContent = m || ''; err.hidden = !m; };
  const paintSlots = () => { $('rsSlots').innerHTML = window.bwShared.slotButtons(s.date, s.time, cfg && cfg.bookingId); };

  function renderCal() {
    $('rsMonth').textContent = `${MONTHS[s.month]} ${s.year}`;
    $('rsPrev').disabled = s.year === today.getFullYear() && s.month === today.getMonth();
    const first = new Date(s.year, s.month, 1).getDay();
    const dim = new Date(s.year, s.month + 1, 0).getDate();
    let h = ['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => `<span class="si-dow">${d}</span>`).join('');
    for (let i = 0; i < first; i++) h += '<span></span>';
    for (let n = 1; n <= dim; n++) {
      const d = new Date(s.year, s.month, n), a = avail(d), iso = toIso(d);
      h += `<button type="button" class="si-day ${a}${iso === s.date ? ' selected' : ''}" data-iso="${iso}" ${a === 'unavailable' ? 'disabled' : ''}>${n}</button>`;
    }
    $('rsDays').innerHTML = h;
  }

  function open(c) {
    cfg = c; s.date = c.date || ''; s.time = c.time || '';
    if (s.date && new Date(s.date + 'T00:00') < today) s.date = s.time = '';   // past schedule: pick a new one
    const base = s.date ? new Date(s.date + 'T00:00') : today;
    s.year = base.getFullYear(); s.month = base.getMonth();
    $('rsTitle').textContent = c.title; $('rsSub').textContent = c.sub || '';
    setErr(''); renderCal(); paintSlots();
    modal.classList.add('show'); modal.setAttribute('aria-hidden', 'false');
  }
  const close = () => { modal.classList.remove('show'); modal.setAttribute('aria-hidden', 'true'); };

  modal.addEventListener('click', e => { if (e.target === modal || e.target.hasAttribute('data-close')) close(); });
  $('rsPrev').addEventListener('click', () => { if (s.month === 0) { s.month = 11; s.year--; } else s.month--; renderCal(); });
  $('rsNext').addEventListener('click', () => { if (s.month === 11) { s.month = 0; s.year++; } else s.month++; renderCal(); });
  $('rsDays').addEventListener('click', e => {
    const d = e.target.closest('.si-day');
    if (d && !d.disabled) {
      if (d.dataset.iso !== s.date) s.time = '';
      s.date = d.dataset.iso; setErr(''); renderCal(); paintSlots();
    }
  });
  $('rsSlots').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    s.time = b.dataset.time; setErr(''); paintSlots();
  });
  $('rsSave').addEventListener('click', async () => {
    if (!s.date || !s.time) return setErr('Please choose a new date and time slot.');
    if (cfg.date === s.date && cfg.time === s.time) return setErr('That is your current schedule. Pick a different one.');
    if (!window.bwShared.canBook(s.date, s.time, cfg.bookingId)) {
      s.time = ''; renderCal(); paintSlots();
      return setErr('That time slot is no longer available. Please choose another one.');
    }
    $('rsSave').disabled = true;
    try { await cfg.onSave(s.date, s.time); }
    catch (e) {                              // the server said no (slot taken meanwhile, past date, ...)
      $('rsSave').disabled = false;
      if (e.status === 409) { s.time = ''; await BWC.reload('calendar'); renderCal(); paintSlots(); }
      return setErr(e.message || 'Could not change the schedule.');
    }
    $('rsSave').disabled = false;
    close();
    const t = $('stToast'); t.textContent = 'Schedule updated'; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2400);
  });

  window.bwReschedule = { open };

  /* Dashboard: Upcoming Site Schedules (buttons are drawn by the dashboard from the server's schedules) */
  document.addEventListener('click', e => {
    const btn = e.target.closest('.sch-change[data-id]'); if (!btn) return;
    const sc = C.schedule(btn.dataset.id); if (!sc) return;
    bwReschedule.open({
      title: 'Change ' + (sc.activity_type === 'Installation' ? 'Installation' : 'Site Inspection') + ' Schedule', sub: sc.installation_address || '',
      date: sc.scheduled_date, time: sc.time_slot, bookingId: +sc.schedule_id,
      onSave: async (date, time, reason) => {
        await api(`/customer/schedules/${sc.schedule_id}/reschedule`, { body: { date, slot: time, reason } });
        await BWC.reload('calendar');
      }
    });
  });
})();

/* ===== Header title per section + clickable stat cards ===== */
(function () {
  const T = {
    dashboard:['CLIENT PORTAL > DASHBOARD','Dashboard','Your BeyondWires account at a glance.'],
    inquiries:['CLIENT PORTAL > MY INQUIRIES','My Inquiries','Track and submit your inquiries.'],
    'service-inquiry':['MY INQUIRIES > NEW INQUIRY','New Service Inquiry','Tell us what you need.'],
    quotations:['CLIENT PORTAL > QUOTATIONS','Quotations','Review, approve and pay your quotations.'],
    projects:['CLIENT PORTAL > MY PROJECTS','My Projects','Track your projects and open their documents.'],
    'project-documents':['MY PROJECTS > PROJECT DOCUMENTS','Project Documents','All documents issued for this project.'],
    'quotation-view':['QUOTATIONS > QUOTATION APPROVAL','Quotation Approval','Review and respond to this quotation.'],
    'quotation-schedule':['QUOTATIONS > PAYMENT & SCHEDULE','Payment Method & Schedule','Choose your installation schedule.'],
    'quotation-payment':['QUOTATIONS > PAYMENT TRANSACTION','Payment Transaction','Submit your payment proof.'],
    documents:['CLIENT PORTAL > DOCUMENTS','Documents','Your quotations, receipts and certificates.'],
    settings:['SYSTEM SUPPORT > SETTINGS','System Settings','Manage your dashboard appearance, account security, and contact preferences.']
  };
  const $ = id => document.getElementById(id);
  const paint = () => {
    const a = document.querySelector('.section-view.active'), t = a && T[a.id];
    if (!t) return;
    $('pageCrumb').textContent = t[0]; $('pageTitle').textContent = t[1]; $('pageSub').textContent = t[2];
  };
  new MutationObserver(paint).observe(document.querySelector('.content'),
    { subtree:true, attributes:true, attributeFilter:['class'] });
  paint();

  const targets = ['inquiries', 'quotations', 'documents', 'documents'];
  document.querySelectorAll('.stat').forEach((card, i) => {
    const go = () => document.querySelector(`.nav-item[data-section="${targets[i]}"]`).click();
    card.tabIndex = 0; card.setAttribute('role', 'button'); card.style.cursor = 'pointer';
    card.addEventListener('click', go);
    card.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  });
})();


/* ===== Shared: date limits (2019-2028) + mobile drawer ===== */
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

/* ===== Document templates (based on the BeyondWires reference documents) ===== */
(function () {
  /* Company details used by every template. Edit them here once. */
  const CO = {
    addr: 'Rosal St., Tala, Caloocan City', email: 'beyondwires.info@gmail.com',
    phone: '+63945-329-6845', phone2: '+63975-203-7668', dti: '6145128', tin: '421-649-525',
    tinFull: '421-649-525-00000', tinCert: '421-649-525-000', prop: 'CLARISSAN E. ISABELO',
    fullAddr: '9999 XC-B Rosal St., Bo. San Lazaro, Barangay 187, Tala, 1400 City of Caloocan NCR, Third District, Philippines',
    rep: 'CLARRISE',                       // "Project In-charge" on quotations
    contractor: 'Eugene P. Isabelo', manager: 'Mr. Eugene Isabelo',
    team: 'Emerson Isabelo, Efipanio Arta III, Dennis Lachica',
    residence: '9999 Rosal St., San Lazaro, Brgy. 187 Tala, Caloocan City 1427',
    printer: { name: 'CORAL CREATIVE GRAPHICS', tin: '235-820-027-00000',
      addr: 'Phase 5 Blk. 39 Lot 12-A, Centella Homes, San Isidro, Rodriguez, Rizal',
      accr: '', issued: 'Dec. 06, 2023', expiry: 'Dec. 05, 2028', box: '10 Bkts.', sets: '50',
      copies: '2', serial: '000001-000500', atp: '', atpDate: 'May 13, 2024' }
  };
  const e = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const peso = n => '\u20B1' + Math.round(Number(n) || 0).toLocaleString('en-US');
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const MONL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dt = iso => { const [y, m, d] = String(iso).split('-').map(Number); return MON[m - 1] + ' ' + d + ', ' + y; };
  const dtL = iso => { const [y, m, d] = String(iso).split('-').map(Number); return MONL[m - 1] + ' ' + String(d).padStart(2, '0') + ', ' + y; };
  const blank = (v, w) => v ? e(v) : '<span class="bwd-fill" style="min-width:' + (w || 80) + 'px"></span>';

  /* Customer details: the signed-in account plus the address of the latest inquiry. */
  function customer() {
    const list = (window.__inqData && window.__inqData()) || [];
    const hit = list.find(i => i.details && i.details.blocks && i.details.blocks.some(b => b.address));
    const b = hit && hit.details.blocks.find(x => x.address);
    return { name: ME.name, email: ME.email, address: (b && b.address) || '', project: (b && b.place) || '' };
  }

  const letterhead = () => `<div class="bwd-brand"><div class="bwd-wm"><span>Beyond</span><b>wires</b></div>
    <div class="bwd-sub">SECURITY SYSTEM SERVICES</div>
    <div class="bwd-small">${e(CO.addr)} | ${e(CO.email)} | ${e(CO.phone)}</div>
    <div class="bwd-small">DTI-BRN: ${e(CO.dti)} | NON-VAT TIN: ${e(CO.tin)}</div></div>`;

  const logoHead = () => `<div class="bwd-lh"><div class="bwd-logo"><img src="../Assets/BWLOGO.png" alt="Beyondwires"></div>
    <div class="bwd-tag">Beyond Secured.<br>Beyond Excellence.</div>
    <div class="bwd-serif">${e(CO.addr)} | ${e(CO.email)}<br>${e(CO.phone2)} | NON-VAT TIN: ${e(CO.tinCert)}</div></div>`;

  /* ---- Quotation (reference: QUO template). Rows, VAT and total come from the server. ---- */
  function fromServer(d) {
    const rows = (d.items || []).map(i => ({ qty: i.quantity, unit: i.quantity > 1 ? 'pcs' : 'pc', name: i.name, desc: i.description || '', price: +i.unit_price, amount: +i.total_amount }));
    if (+d.extra_expenses > 0) rows.push({ qty: 1, unit: 'lot', name: 'Extra expenses', desc: '', price: +d.extra_expenses, amount: +d.extra_expenses });
    (d.labor || []).forEach(w => rows.push({ qty: w.workers, unit: 'pax', name: 'Labor: ' + w.role, desc: w.days + ' day(s) @ ' + peso(w.daily_rate) + ' per day', price: w.days * w.daily_rate, amount: +w.amount }));
    const sub = (+d.subtotal || 0) + (+d.other_charges_total || 0) + (+d.labor_total || 0);
    return { id: d.quotation_no, date: String(d.date_created).slice(0, 10), customer: (d.first_name || '') + ' ' + (d.last_name || ''), address: d.site_address || d.installation_address,
      project: d.project_title || (d.place_type ? d.place_type + ' Security System Installation' : ''), scope: d.scope_of_work, rows, sub, vat: +d.vat_amount || 0, total: +d.total_amount, duration: d.duration, terms: d.payment_terms,
      incharge: d.project_incharge, notes: d.notes, validUntil: d.expiry_date, noLabor: +d.no_labor === 1 };
  }
  function quotation(q) {
    const c = customer();
    const rows = q.rows || (q.items || []).map(i => ({ qty: i.qty, unit: i.unit || 'pcs', name: i.name, desc: i.desc, price: i.price, amount: i.qty * i.price }));
    const sub = q.sub != null ? q.sub : rows.reduce((s, r) => s + r.amount, 0);
    const vat = q.vat != null ? q.vat : Math.round(sub * 0.12), total = q.total != null ? q.total : sub + vat;
    const notes = ['Prices are based on the items listed above. Changes in scope will be quoted separately.']
      .concat(q.noLabor ? ['No labor fee is included in this quotation.'] : []).concat(String(q.notes || '').split('\n').map(x => x.trim()).filter(Boolean));
    return `<div class="bwd-paper bwd-quo">${letterhead()}<hr class="bwd-rule">
      <div class="bwd-row"><span>${e(dt(q.date))}</span><span>Quotation No. <b>${e(q.id)}</b></span></div>
      <p class="bwd-greet"><b>Dear Ma'am/Sir,</b><br>Thank you for your interest in doing business with BEYONDWIRES SECURITY SYSTEM SERVICES. Below are the items and overall price we curated for you.</p>
      <div class="bwd-kv"><span>Customer Name</span><b>${e(q.customer || c.name)}</b>
        <span>Address</span><b>${e(q.address || c.address) || '&mdash;'}</b>
        <span>Project</span><b>${e(q.project || c.project) || '&mdash;'}</b>
        <span>Scope of work</span><em>${e(q.scope || 'Scope of work: supply and installation of CCTV and related accessories, including testing and commissioning.')}</em></div>
      <table class="bwd-tbl"><thead><tr><th>QTY</th><th>PRODUCT / SERVICE</th><th>DESCRIPTION</th><th class="r">UNIT PRICE</th><th class="r">AMOUNT</th></tr></thead><tbody>
        ${rows.map(i => `<tr><td>${i.qty} ${e(i.unit || 'pcs')}</td><td><b>${e(i.name)}</b></td><td class="sm">${e(i.desc || '')}</td><td class="r">${peso(i.price)}</td><td class="r">${peso(i.amount)}</td></tr>`).join('')}
      </tbody></table>
      <div class="bwd-tot"><div><span>Subtotal</span><b>${peso(sub)}</b></div><div><span>VAT (12%)</span><b>${peso(vat)}</b></div><div class="g"><span>TOTAL PROJECT COST</span><b>${peso(total)}</b></div></div>
      <div class="bwd-kv bwd-kv2"><span>Project Duration</span><b class="n">${e(q.duration || 'To be confirmed after site assessment')}</b>
        <span>Terms of Payment</span><b class="n">Half payment upon quotation or Full payment upon quotation (chosen by the customer upon approval)</b>
        <span>Validity</span><b class="n">${q.validUntil ? 'Until ' + e(dt(q.validUntil)) : '30 days from the date issued'}</b></div>
      <ul class="bwd-note">${notes.map(n => `<li>${e(n)}</li>`).join('')}</ul>
      <div class="bwd-sign"><div><small>Project In-charge:</small><div class="ln"><b>${e(q.incharge || CO.rep)}</b></div><small>BeyondWires Representative</small></div>
        <div><small>Conform&eacute;:</small><div class="ln"></div><small>${e(q.customer || c.name)} Representative</small></div></div></div>`;
  }

  /* ---- Acknowledgement Receipt (reference: AR template). Same layout as the admin's copy. ---- */
  const AR_CSS = `<style>
    .bwd-ar{width:560px;max-width:100%;background:#fff;color:#111;padding:22px 24px;font-family:"Times New Roman",Georgia,serif;font-size:12px;border:1px solid #111;box-sizing:border-box;margin:0 auto}
    .bwd-ar .arh{display:flex;align-items:center;gap:12px;padding-bottom:8px}
    .bwd-ar .arh img{width:104px;height:104px;border-radius:50%;object-fit:cover;flex-shrink:0}
    .bwd-ar h1{font-size:26px;font-weight:700;line-height:1;margin:0;color:#111} .bwd-ar h2{font-size:17px;font-weight:700;margin:2px 0 0;color:#111}
    .bwd-ar .arc{font-size:12px;margin:1px 0 4px} .bwd-ar .ars{font-size:12px;line-height:1.15;padding-left:26px}
    .bwd-ar table{width:100%;border-collapse:collapse;table-layout:fixed} .bwd-ar td,.bwd-ar th{white-space:normal;overflow:visible;text-overflow:clip;border:1px solid #111 !important;padding:4px 6px;color:#111 !important;background:#fff !important;font-size:12px;text-align:left;vertical-align:middle}
    .bwd-ar .ari td{height:24px;font-size:13px} .bwd-ar .ari td.r{width:34%} .bwd-ar .arno{color:#c81e1e;font-weight:700;font-size:15px;font-family:Arial,Helvetica,sans-serif}
    .bwd-ar .art{text-align:center;font-size:25px;font-weight:700;background:#e5e5e5;border:1px solid #111;border-top:0;padding:8px 0}
    .bwd-ar .arit th{font-size:11.5px;font-weight:700;text-align:center;height:30px;border-top:0} .bwd-ar .arit th.l{text-align:left}
    .bwd-ar .arit td{height:26px;font-size:11px} .bwd-ar .arit td.c{text-align:center} .bwd-ar .arit td.n{text-align:right}
    .bwd-ar .arit td.note{font-size:9.5px;vertical-align:top;line-height:1.3} .bwd-ar .arit tr.sg td{height:40px;vertical-align:top;font-size:12.5px}
  </style>`;
  function invoice(v) {
    const c = customer(), rows = v.rows || [], total = rows.reduce((s, r) => s + r.qty * r.price, 0);
    const n2 = n => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const paid = v.method === 'Online' ? 'Paid online' + (v.ref ? (/^\d{4}$/.test(v.ref) ? ', Reference No. ending in ' : ', Reference No. ') + v.ref : '') : 'Paid in cash (over the counter)';
    const lines = rows.map(r => [r.qty, 'lot', r.name, n2(r.price), n2(r.qty * r.price)]).concat([['', '', paid, '', '']]);
    if ((v.comp || []).length) lines.push(['', '', '', '', '']);
    (v.comp || []).forEach(x => lines.push(['', '', x[0] + ': ' + x[1], '', '']));
    while (lines.length < 11) lines.push(['', '', '', '', '']);
    return `${AR_CSS}<div class="bwd-paper bwd-ar"><div class="arh"><img src="../Assets/BWLOGO.png" alt="BeyondWires"><div><h1>BeyondWires</h1><h2>SECURITY SYSTEM SERVICES</h2>
      <p class="arc">0945-329-6845| ${e(CO.email)}</p><p class="ars">CCTV Installation/Repairs/Upgrades<br>Barbed Wire Installation<br>Welding and Fabrication<br>Electrical Wirings and Services</p></div></div>
      <table class="ari"><tr><td><b>NAME:</b> ${e(v.customer || c.name)}</td><td class="r"><b>DATE:</b> ${e(dt(v.date))}</td></tr>
        <tr><td><b>ADDRESS:</b> ${e(v.address || c.address)}</td><td class="r"><b>NO:</b> <span class="arno">${e(v.no)}</span></td></tr></table>
      <div class="art">Acknowledgement Receipt</div>
      <table class="arit"><colgroup><col style="width:42px"><col style="width:44px"><col><col style="width:84px"><col style="width:90px"><col style="width:20px"></colgroup>
        <thead><tr><th>QTY</th><th>UNIT</th><th class="l">DESCRIPTION OF GOODS</th><th>RATE</th><th>PRICE</th><th></th></tr></thead><tbody>
        ${lines.map(x => `<tr><td class="c">${x[0]}</td><td class="c">${x[1]}</td><td>${e(x[2])}</td><td class="n">${x[3]}</td><td class="n">${x[4]}</td><td></td></tr>`).join('')}
        <tr><td colspan="3" rowspan="2" class="note"><i>Make sure to receive the above mentioned goods in good condition. No refund of money after payment.</i></td><td></td><td></td><td></td></tr>
        <tr><td></td><td></td><td></td></tr>
        <tr class="sg"><td colspan="3">Authorized Signature:</td><td colspan="3"><b>Total:</b> &#8369;${n2(total)}</td></tr></tbody></table></div>`;
  }

  /* ---- CCTV Installation Certificate (reference: certificate) ---- */
  function certificate(v) {
    const c = customer();
    return `<div class="bwd-paper bwd-cert">${logoHead()}
      <h3 class="bwd-title">${e(v.title || 'CCTV INSTALLATION CERTIFICATE')}</h3>
      <div class="bwd-cf"><span>Project Title:</span><div>${e(v.project || 'CCTV Installation')}</div>
        <span>Location:</span><div>${e(v.location || c.address) || '&mdash;'}</div>
        <span>Main Contractor:</span><div>Beyondwires Security System Services</div>
        <span>Project Manager:</span><div>${e(v.manager || CO.manager)}</div>
        <span>Team Members:</span><div>${e(v.team || CO.team)}</div>
        <span>Project Start Date:</span><div>${e(dtL(v.start))}</div>
        <span>Project End Date:</span><div>${e(dtL(v.end))}</div></div>
      <p class="bwd-par">I, <b>${e((v.contractor || CO.contractor).replace(' P.', ''))}</b>, an individual residing at <b>${e(v.residence || CO.residence)}</b>, hereby certifies that as of the date stated above, the said installation${v.work ? ' of the ' + e(v.work) : ''} has been finished in accordance with the requirements of the building owner and adheres to all local government codes and bylaws regarding CCTV installation.</p>
      <div class="bwd-csig"><div class="bwd-scr"></div><b>${e(CO.contractor)}</b><br>Signature of Contractor over Printed Name<br>Date Signed: ${e(dtL(v.end))}</div>
      <p class="bwd-ack">Acknowledged by:</p></div>`;
  }

  /* ---- Accomplishment Report (reference: accomplishment report). Overview, scope and photos come from the admin. ---- */
  function scopeList(text) {
    const items = [];
    String(text || '').split('\n').map(x => x.trim()).filter(Boolean).forEach(l => {
      if (/^[-•*]\s*/.test(l) && items.length) items[items.length - 1].subs.push(l.replace(/^[-•*]\s*/, ''));
      else { const m = /^([^:]{2,80}):\s*(.*)$/.exec(l); items.push(m ? { t: m[1], d: m[2], subs: [] } : { t: '', d: l, subs: [] }); }
    });
    return '<ol>' + items.map(it => '<li>' + (it.t ? '<b>' + e(it.t) + ':</b>' + (it.d ? '<br>' : '') : '') + e(it.d) + (it.subs.length ? '<ul>' + it.subs.map(x => '<li>' + e(x) + '</li>').join('') + '</ul>' : '') + '</li>').join('') + '</ol>';
  }
  function report(v) {
    const c = customer(), where = v.location || c.address;
    const overview = v.overview || `This project involved the ${v.project || 'installation of a CCTV surveillance system'} for ${v.client || c.name}${where ? ', located at ' + where : ''}. The objective was to enhance security by providing comprehensive surveillance coverage, including critical areas like entrances and hallways. The project ran from ${dtL(v.start)} to ${dtL(v.end)}, scheduled to minimize disruption to daily operations.`;
    const photos = (v.photos || []).length ? `<h5>Proof of Installation</h5><div class="bwd-photos" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${v.photos.map((p, i) =>
      `<figure style="margin:0"><img src="${e(p.src)}" alt="" style="width:100%;height:120px;object-fit:cover;border:1px solid #dbe3ee"><figcaption style="font-size:9px">${e(p.caption || 'Photo ' + (i + 1))}</figcaption></figure>`).join('')}</div>` : '';
    return `<div class="bwd-paper bwd-cert bwd-rep">${logoHead()}
      <h3 class="bwd-title">ACCOMPLISHMENT REPORT</h3>
      <h5>Project Overview</h5>
      <p>${e(overview)}</p>
      <h5>Project Scope</h5><p>The project scope included the following activities:</p>
      ${v.scope ? scopeList(v.scope) : `<ol><li><b>Site Survey and Equipment Placement Design:</b><br>Conducted a thorough site survey to identify the optimal camera placement.</li>
        <li><b>Installation of IP CCTV Cameras:</b><ul><li>Installed cameras at designated locations, achieving strategic visibility across the site.</li><li>Cabling and alignment were planned to suit each location.</li></ul></li>
        <li><b>Network Configuration and System Integration:</b><ul><li>Configured all network settings for centralized access and control of the CCTV footage.</li></ul></li>
        <li><b>Testing and Customer Handover:</b><ul><li>Tested every camera and recorder, then briefed the customer on system use.</li></ul></li></ol>`}${photos}</div>`;
  }

  /* ---- Build the right template for a Documents-tab entry ---- */
  const SAMPLE = [
    { qty: 3, unit: 'pcs', name: 'System Configuration & Commissioning', desc: 'Setup, testing and customer handover', price: 3000 },
    { qty: 3, unit: 'pcs', name: 'IP Camera (Bullet)', desc: 'Cameras', price: 4800 },
    { qty: 1, unit: 'pax', name: 'Labor: Helper', desc: '1 day(s) @ \u20B11,000 per day', price: 1000 }
  ];
  function render(d) {
    const date = d.date, start = d.start || date, end = d.end || date;
    if (d.type === 'Quotation') return quotation({ id: d.ref || 'QUO-' + date.slice(0, 4) + '-' + d.id.slice(-3), date, project: d.projectName, items: d.items || SAMPLE });
    if (d.type === 'Receipt') return invoice({ no: d.ref || '000010', date, method: d.method || 'Cash', rows: d.rows || [{ name: 'CCTV Installation - 50% down payment', qty: 1, price: 12000 }] });
    if (d.type === 'Certificate') return certificate({ project: d.projectName || 'Installation of CCTV Cameras', start, end });
    if (d.type === 'Report') return report({ project: d.projectName ? 'project "' + d.projectName + '"' : 'installation of a CCTV surveillance system', start, end });
    return '';
  }

  /* ---- Download the document as a real PDF file ----
     The document is drawn into a PDF file with html2pdf (loaded on demand from the same CDN the
     admin page uses). The print dialog is only used if the PDF library cannot be loaded. */
  const H2P_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
  let h2pLoading = null;
  function loadH2P() {
    if (window.html2pdf) return Promise.resolve(true);
    if (!h2pLoading) h2pLoading = new Promise(res => { const s = document.createElement('script'); s.src = H2P_SRC; s.onload = () => res(!!window.html2pdf); s.onerror = () => { h2pLoading = null; res(false); }; document.head.appendChild(s); });
    return h2pLoading;
  }
  const pdfToast = msg => { const t = document.createElement('div'); t.className = 'bw-toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); };
  const toDataUrl = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
  async function print(html, title) {
    if (!html) return;
    pdfToast('Preparing PDF...');
    if (!(await loadH2P())) return printDialog(html, title);
    const landscape = /bwd-inv/.test(html), ar = /bwd-ar/.test(html);   // ar: the receipt gets a page its own size (like the admin's copy), so it is not shrunk
    const wrap = document.createElement('div');
    wrap.style.cssText = 'background:#fff;width:' + (landscape ? 760 : ar ? 560 : 720) + 'px';
    wrap.innerHTML = html;
    wrap.querySelectorAll('.bwd-paper').forEach(p => { p.style.zoom = '1'; p.style.boxShadow = 'none'; if (!p.classList.contains('bwd-ar')) p.style.border = '0'; p.style.margin = '0'; });   // the receipt keeps its outer border
    /* embed images (logo, photos) so the capture is never blocked; unreadable images fall back to their alt text */
    await Promise.all(Array.from(wrap.querySelectorAll('img')).map(async img => {
      if (!/^data:/.test(img.getAttribute('src') || '')) {
        try { const r = await fetch(img.src, { credentials: 'include' }); if (!r.ok) throw new Error(r.status); img.src = await toDataUrl(await r.blob()); }
        catch (err) { const b = document.createElement('b'); b.textContent = img.alt || ''; img.replaceWith(b); return; }
      }
      if (!img.complete) await new Promise(r => { img.onload = img.onerror = r; });
    }));
    const file = String(title || 'BeyondWires document').replace(/[^\w\-]+/g, '_') + '.pdf';
    try {
      await window.html2pdf().set({ margin: ar ? 24 : [24, 24, 24, 24], filename: file, image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0 },
        jsPDF: ar ? { unit: 'px', format: [608, 808], orientation: 'portrait', hotfixes: ['px_scaling'] } : { unit: 'pt', format: 'a4', orientation: landscape ? 'landscape' : 'portrait' },
        pagebreak: { mode: ['css'], avoid: ['tr', '.bwd-tot', '.bwd-sign', '.bwd-csig', 'figure', 'li', '.bwd-irow'] } }).from(wrap).save();
      pdfToast(file + ' downloaded');
    } catch (err) { console.error('PDF build failed:', err); printDialog(html, title); }
  }
  function printDialog(html, title) {
    let h = document.getElementById('bwdPrint');
    if (!h) { h = document.createElement('div'); h.id = 'bwdPrint'; document.body.appendChild(h); }
    h.innerHTML = html;
    const old = document.title; document.title = title || old;
    document.body.classList.add('bwd-printing');
    const done = () => { document.body.classList.remove('bwd-printing'); document.title = old; h.innerHTML = ''; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 80);
  }

  window.bwTpl = { quotation, fromServer, invoice, certificate, report, render, print, customer };
})();

/* ===== My Projects: project list + documents per project ===== */
(function () {
  const PAGE_SIZE = 6;
  const $ = id => document.getElementById(id);
  const slug = s => s.toLowerCase().replace(/\s+/g, '-');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const fmt = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month:'short', day:'2-digit', year:'numeric' }); };
  const pill = t => `<span class="pill ${slug(t)}">${esc(t)}</span>`;
  const ICON_DOC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 13h5M10 17h5"/></svg>';
  const ICON_AWARD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="9" r="5"/><path d="m9 13-1 8 4-2 4 2-1-8"/></svg>';
  const ICON_DL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/></svg>';

  /* Projects come from the server; their documents are the ones the admin issued for that project. */
  const mapProjects = () => (BWC.state.projects || []).map(p => ({
    id: C.prjNo(p.project_id), dbId: +p.project_id, name: p.project_name || 'Project', date: C.ymd(p.start_date || p.created_at),
    end: C.ymd(p.end_date), status: C.projStatus(p), quo: p.quotation_no, raw: p
  }));
  let projects = mapProjects();
  const docsOf = p => (BWC.state.documents || []).filter(d => +d.project_id === p.dbId).map(d => window.bwDocs.map(d));

  const state = { search:'', status:'all', from:'', to:'', page:1 };
  const body = $('prjBody'), countEl = $('prjCount'), pager = $('prjPager');
  const searchEl = $('prjSearch'), statusEl = $('prjStatus');
  const dateBtn = $('prjDateBtn'), dateLabel = $('prjDateLabel'), datePop = $('prjDatePop');
  const fromEl = $('prjFrom'), toEl = $('prjTo');

  function filtered() {
    const q = state.search.trim().toLowerCase();
    return projects.filter(p => {
      if (state.status !== 'all' && p.status !== state.status) return false;
      if (state.from && p.date < state.from) return false;
      if (state.to && p.date > state.to) return false;
      if (q && ![p.name, p.id, fmt(p.date), p.status].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
  }
  function render() {
    const list = filtered(), total = list.length, pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    state.page = Math.min(Math.max(state.page, 1), pages);
    const start = (state.page - 1) * PAGE_SIZE, rows = list.slice(start, start + PAGE_SIZE);
    body.innerHTML = rows.length ? rows.map(p => `
      <tr>
        <td><b>${esc(p.name)}</b></td>
        <td class="inq-id">${p.id}</td>
        <td>${fmt(p.date)}</td>
        <td>${pill(p.status)}</td>
        <td class="inq-right"><button type="button" class="inq-view" data-id="${p.id}">View Documents</button></td>
      </tr>`).join('') : '<tr><td colspan="5" class="inq-empty">No projects found.</td></tr>';
    countEl.textContent = `Showing ${total ? start + 1 : 0}\u2013${Math.min(start + PAGE_SIZE, total)} of ${total} results`;
    let h = `<button type="button" class="pg-btn" data-nav="prev" ${state.page === 1 ? 'disabled' : ''}>Previous</button>`;
    for (let i = 1; i <= pages; i++) h += `<button type="button" class="pg-btn ${i === state.page ? 'active' : ''}" data-page="${i}">${i}</button>`;
    pager.innerHTML = h + `<button type="button" class="pg-btn" data-nav="next" ${state.page === pages ? 'disabled' : ''}>Next</button>`;
  }
  searchEl.addEventListener('input', () => { state.search = searchEl.value; state.page = 1; render(); });
  statusEl.addEventListener('change', () => { state.status = statusEl.value; state.page = 1; render(); });
  pager.addEventListener('click', e => {
    const b = e.target.closest('.pg-btn'); if (!b || b.disabled) return;
    if (b.dataset.nav === 'prev') state.page--; else if (b.dataset.nav === 'next') state.page++; else state.page = Number(b.dataset.page);
    render();
  });
  const label = () => {
    dateLabel.textContent = state.from && state.to ? `${fmt(state.from)} \u2013 ${fmt(state.to)}` : state.from ? `From ${fmt(state.from)}` : state.to ? `Until ${fmt(state.to)}` : 'Choose Date Range';
  };
  dateBtn.addEventListener('click', e => { e.stopPropagation(); datePop.classList.toggle('show'); });
  datePop.addEventListener('click', e => e.stopPropagation());
  document.addEventListener('click', () => datePop.classList.remove('show'));
  $('prjDateApply').addEventListener('click', () => {
    let f = fromEl.value, t = toEl.value; if (f && t && f > t) [f, t] = [t, f];
    state.from = f; state.to = t; state.page = 1; fromEl.value = f; toEl.value = t; label(); datePop.classList.remove('show'); render();
  });
  $('prjDateClear').addEventListener('click', () => {
    fromEl.value = toEl.value = ''; state.from = state.to = ''; state.page = 1; label(); datePop.classList.remove('show'); render();
  });

  /* ---------- project documents page ---------- */
  let current = null, docs = [], openDoc = null;
  const go = name => {
    document.querySelectorAll('.section-view').forEach(v => v.classList.toggle('active', v.id === name));
    document.querySelectorAll('.nav-item[data-section]').forEach(n => {
      const on = n.dataset.section === 'projects';
      n.classList.toggle('active', on); if (on) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current');
    });
    history.replaceState(null, '', '#' + name);
    const c = document.querySelector('.content'); if (c) c.scrollTop = 0;
  };
  function openProject(p) {
    current = p; docs = docsOf(p);
    $('pdName').textContent = p.name;
    $('pdMeta').innerHTML = `<span><i>Project ID</i><b>${p.id}</b></span><span><i>Date</i><b>${fmt(p.date)}</b></span><span><i>Status</i>${pill(p.status)}</span><span><i>Documents</i><b>${docs.length}</b></span>`;
    $('pdGrid').innerHTML = docs.length ? docs.map(d => `
      <div class="doc-card">
        <div class="doc-top"><span class="doc-icon ${slug(d.type)}">${d.type === 'Certificate' ? ICON_AWARD : ICON_DOC}</span><span class="pill ${slug(d.status)}">${d.status}</span></div>
        <div class="doc-info"><div class="doc-kind">${d.type}</div><div class="doc-title">${esc(d.title)}</div><div class="doc-date">${fmt(d.date)}</div></div>
        <div class="doc-actions">
          <button type="button" class="doc-btn-view" data-act="view" data-id="${d.id}">View</button>
          <button type="button" class="doc-btn-pdf" data-act="pdf" data-id="${d.id}">${ICON_DL} PDF</button>
        </div>
      </div>`).join('') : '<div class="inq-empty" style="grid-column:1/-1">No documents yet. Your quotation, receipts and certificate appear here once they are issued.</div>';
    go('project-documents');
  }
  body.addEventListener('click', e => {
    const b = e.target.closest('.inq-view'); if (!b) return;
    const p = projects.find(x => x.id === b.dataset.id); if (p) openProject(p);
  });
  $('pdBack').addEventListener('click', () => go('projects'));

  /* PDF = print only the document. Types without a template (Contract) fall back to a simple summary PDF. */
  async function download(d) {
    if (d.kind === 'file') { window.open(window.bwDocs.fileUrl(d), '_blank'); return; }
    const tpl = await window.bwDocs.html(d);
    if (tpl) { window.bwTpl.print(tpl, d.title); return; }
    const blob = window.bwBuildPdf('BeyondWires - ' + d.title, ['Project: ' + current.name, 'Project ID: ' + current.id, 'Type: ' + d.type, 'Date: ' + fmt(d.date), 'Status: ' + d.status]);
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = d.title.replace(/[^\w\-]+/g, '_') + '.pdf';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const modal = $('pdModal');
  const openM = () => { modal.classList.add('show'); modal.setAttribute('aria-hidden', 'false'); };
  const closeM = () => { modal.classList.remove('show'); modal.setAttribute('aria-hidden', 'true'); };
  modal.addEventListener('click', e => { if (e.target === modal || e.target.hasAttribute('data-close')) closeM(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeM(); });
  $('pdDownload').addEventListener('click', () => { if (openDoc) download(openDoc); });
  $('pdGrid').addEventListener('click', async e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const d = docs.find(x => x.id === b.dataset.id); if (!d) return;
    if (b.dataset.act === 'pdf' || d.kind === 'file') { download(d); return; }
    openDoc = d;
    const tpl = await window.bwDocs.html(d);
    $('pdPaper').innerHTML = tpl;
    modal.querySelector('.inq-modal-card').classList.toggle('has-paper', !!tpl);
    $('pdTitle').textContent = d.title; $('pdType').textContent = d.type; $('pdDate').textContent = fmt(d.date); $('pdStatus').textContent = d.status;
    openM();
  });

  /* used by the header notifications */
  window.bwPrj = {
    list: () => projects,
    open(id) { const p = projects.find(x => x.dbId === +id || x.id === id); if (p) openProject(p); else go('projects'); }
  };
  BWC.on(() => {
    projects = mapProjects(); render();
    if (current && document.getElementById('project-documents').classList.contains('active')) { const p = projects.find(x => x.dbId === current.dbId); if (p) openProject(p); }
  });

  render();
})();

})();


/* ===== Customer: welcome name, auto-fill, Back button ===== */
(function bwCustomerFixes() {
  if (!window.BW || !document.getElementById('siForm')) return;
  let me = null;

  // 1. "Welcome back, John!" - the signed-in customer's first name, first letter capitalized
  function fixWelcome() {
    const h = document.querySelector('#dashboard .welcome h1');
    if (!h) return;
    const m = h.textContent.match(/^Welcome back,\s*(.+?)!?$/);
    let first = m ? m[1] : (me ? String(me.name || '').trim().split(/\s+/)[0] : '');
    if (!first) return;
    const want = 'Welcome back, ' + first.charAt(0).toUpperCase() + first.slice(1) + '!';
    if (h.textContent !== want) h.textContent = want;
  }

  // 2. Auto-filled Full Name and Email / Contact Number in the inquiry form
  function fillInquiry() {
    if (!me) return;
    const values = [me.name || '', [me.email, me.phone_number].filter(Boolean).join(' / ')];
    document.querySelectorAll('#siForm input[readonly]').forEach((el, i) => {
      if (i > 1) return;
      el.defaultValue = values[i];   // form.reset() keeps these values
      el.value = values[i];
    });
    const role = document.querySelector('.profile-role');
    if (role) role.textContent = 'Client \u00B7 #BW-' + String(me.customer_id || me.id || '').padStart(4, '0');
  }

  function load() {
    return window.BW.api('/auth/me', { noRedirect: true })
      .then(u => { me = u; fixWelcome(); fillInquiry(); })
      .catch(() => {});
  }
  load();

  // keep the welcome text right whenever the dashboard refreshes
  const h = document.querySelector('#dashboard .welcome h1');
  if (h) new MutationObserver(fixWelcome).observe(h, { childList: true, characterData: true, subtree: true });

  document.addEventListener('click', e => {
    // opening the form: fill in the latest account details (also after a Settings change)
    if (e.target.closest('#newInquiryBtn, #inquireBtn')) { fillInquiry(); load(); }
    // 3. the Back button beside Submit works like "Back to My Inquiries"
    if (e.target.closest('#siCancel')) { const back = document.getElementById('siBack'); if (back) back.click(); }
  }, true);
})();