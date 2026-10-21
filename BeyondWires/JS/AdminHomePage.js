/* ==========================================================
   Beyond Wires - Admin (unified)  |  JS/AdminHomePage.js
   Flow: Inquiry -> Quotation (draft / superadmin / customer) -> Project -> Done
   Project steps: 1 Quotation approved -> 2 Payment -> 3 Installation -> 4 Final payment (50/50 or pay-after only) -> 5 Done
   All data comes from the server (api/admin.php, GET /admin/state) and is mapped
   into the DB object below; every change is sent to the server, which checks
   the rules again, and the page then reloads the data.
   ========================================================== */
(async function () {
    'use strict';
    const ME = await window.BW.guard('admin');
    const api = window.BW.api;

    /* =========================================================
       Helpers
    ========================================================= */
    const $  = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    const round2 = n => Math.round(n * 100) / 100;
    const peso = n => '\u20B1' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: Number.isInteger(+n) ? 0 : 2, maximumFractionDigits: 2 });
    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const toDate = s => new Date(String(s).slice(0, 10) + 'T00:00:00');
    const fmtDate = s => { const d = toDate(s); return MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate() + ', ' + d.getFullYear(); };
    const fmtFull = s => { if (!s) return ''; const d = toDate(s); return MONTHS[d.getMonth()] + ' ' + pad(d.getDate()) + ', ' + d.getFullYear(); };
    const fmtLong = s => { const d = toDate(s); return DAYS[d.getDay()] + ', ' + fmtDate(s); };
    const fmtTime = s => new Date(s).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const nowStamp = () => { const d = new Date(); return MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate() + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };
    const ini = n => String(n).split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const PALETTE = ['#3b82f6', '#6366f1', '#0ea5e9', '#14b8a6', '#8b5cf6', '#f59e0b'];
    const avColor = n => PALETTE[[...String(n)].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];

    const store = {
        get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
    };

    const LOGIN_URL = 'LandingPage.html';
    const VAT_RATE = 0.12;
    const EXPENSE_MAX = 1000000;   // maximum total of "Extra expenses" per quotation
    const PRICE_MAX = 1000000;     // maximum price of a catalog item / quotation line
    const CREW_DAYS_MAX = 5;       // maximum work days per crew line
    const CREW_COUNT_MAX = 50;
    const PHOTO_MAX = 8;           // installation photos per certificate
    /* Quotation: project duration (dropdown, or "Other" = whole number of days) and the terms of payment text */
    const DURATIONS = [1, 2, 3, 4, 5, 7, 10, 14, 21, 30];
    const DURATION_MAX = 90;
    const daysLabel = n => n + (n === 1 ? ' day' : ' days');
    const PAY_TERMS = 'Half payment upon quotation or Full payment upon quotation (chosen by the customer upon approval)';   // same wording as the customer's choice when approving
    const NCR_REASON = 'Outside service area (mainland Luzon only)';
    let DEFAULT_SLOTS = ['9:00 AM', '10:30 AM', '1:00 PM', '3:30 PM'];     // "standard hours" presets (from config.php)
    /* Daily labor rates (PHP per worker per day). The server applies the same rates (config.php). */
    let LABOR_RATES = { 'Helper': 1000, 'Junior Installer': 1500, 'Senior Installer': 2000, 'Head Technician': 2500 };
    /* Business details printed on the receipt, the installation certificate and the project documents */
    const BIZ = {
        name: 'BEYONDWIRES SECURITY SYSTEM SERVICES', legal: 'Beyondwires Security System Services',
        invAddr: '9999 XC-B Rosal St., Bo. San Lazaro, Barangay 187, Tala, 1400 City of Caloocan NCR, Third District, Philippines',
        prop: 'CLARISSAN E. ISABELO - Prop.', invTin: '421-649-525-00000',
        certAddr: 'Rosal St., Tala, Caloocan City', email: 'beyondwires.info@gmail.com', phone: '+63975-203-7668', certTin: '421-649-525-000',
        contractor: 'Eugene P. Isabelo', residence: '9999 Rosal St., San Lazaro, Brgy. 187 Tala, Caloocan City 1427',
        logo: '../Assets/BWLOGO.png',
        /* Acknowledgement Receipt header (as printed on the AR template) */
        arPhone: '0945-329-6845', arEmail: 'beyondwires.info@gmail.com',
        arServices: ['CCTV Installation/Repairs/Upgrades', 'Barbed Wire Installation', 'Welding and Fabrication', 'Electrical Wirings and Services']
    };
    const t2m = t => { const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(t).trim()); if (!m) return 0; let h = (+m[1]) % 12; if (m[3].toUpperCase() === 'PM') h += 12; return h * 60 + (+m[2]); };
    const m2t = n => { const h = Math.floor(n / 60), mi = n % 60; return ((h % 12) || 12) + ':' + pad(mi) + ' ' + (h >= 12 ? 'PM' : 'AM'); };
    const from24 = v => { const m = /^(\d{2}):(\d{2})$/.exec(v || ''); return m ? m2t(+m[1] * 60 + +m[2]) : ''; };
    const sortTimes = a => a.slice().sort((x, y) => t2m(x) - t2m(y));
    const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const shiftIso = (s, n) => { const d = toDate(s); d.setDate(d.getDate() + n); return iso(d); };
    const TODAY = iso(new Date());
    const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
    const workday = n => { const d = new Date(); d.setDate(d.getDate() + n); if (d.getDay() === 0) d.setDate(d.getDate() + 1); return iso(d); };
    const priceIssue = raw => {
        const n = +raw;
        if (raw === '' || raw == null || !isFinite(n)) return 'Enter a valid price';
        if (n <= 0) return 'Price must be greater than zero';
        if (n > PRICE_MAX) return 'Price cannot exceed ' + peso(PRICE_MAX);
        return '';
    };

    let toastTimer;
    function toast(msg) {
        const t = $('#toast'); t.textContent = msg; t.classList.add('show');
        clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
    }

    /* =========================================================
       Catalog (products / services / packages)
    ========================================================= */
    const DEFAULT_CATS = ['Cameras', 'Recorders & Storage', 'Power & Cabling', 'Access Control', 'Solar & Lighting', 'CCTV Kits', 'Wi-Fi CCTV Kits', 'CCTV Package Sets'];
    const CAT_ICON = { 'Cameras': 'fa-video', 'Recorders & Storage': 'fa-hard-drive', 'Power & Cabling': 'fa-plug', 'Access Control': 'fa-fingerprint', 'Solar & Lighting': 'fa-solar-panel',
        'CCTV Kits': 'fa-video', 'Wi-Fi CCTV Kits': 'fa-wifi', 'CCTV Package Sets': 'fa-layer-group' };
    const TYPE_ICON = { product: 'fa-box', service: 'fa-screwdriver-wrench', package: 'fa-box-open' };
    /* Suppliers: each product has the supplier it is bought from. Items with no supplier (services, our own packages) are in-house. */
    const DEFAULT_CATALOG = [
        { id: 'cam-dome', type: 'product', cat: 'Cameras', name: 'IP Camera (Dome)', price: 4200, icon: 'fa-video', supplier: 'Northpoint Security Distribution' },
        { id: 'cam-bullet', type: 'product', cat: 'Cameras', name: 'IP Camera (Bullet)', price: 4800, icon: 'fa-camera', supplier: 'Northpoint Security Distribution' },
        { id: 'cam-ptz', type: 'product', cat: 'Cameras', name: 'PTZ Camera 4MP', price: 14500, icon: 'fa-video', supplier: 'Northpoint Security Distribution' },
        { id: 'cam-wifi', type: 'product', cat: 'Cameras', name: 'Wi-Fi Indoor Camera', price: 2900, icon: 'fa-wifi', supplier: 'Northpoint Security Distribution' },
        { id: 'cam-turret4', type: 'product', cat: 'Cameras', name: 'IP Camera 4MP (Turret)', price: 3600, icon: 'fa-video', supplier: 'Northpoint Security Distribution', desc: '4MP PoE turret camera, 30m IR night vision, IP67' },
        { id: 'dvr-8', type: 'product', cat: 'Recorders & Storage', name: '8-Channel DVR', price: 8500, icon: 'fa-hard-drive', supplier: 'Northpoint Security Distribution' },
        { id: 'dvr-16', type: 'product', cat: 'Recorders & Storage', name: '16-Channel DVR', price: 12500, icon: 'fa-hard-drive', supplier: 'Northpoint Security Distribution' },
        { id: 'nvr-16', type: 'product', cat: 'Recorders & Storage', name: '16-Channel NVR', price: 15800, icon: 'fa-server', supplier: 'Northpoint Security Distribution' },
        { id: 'hdd-1', type: 'product', cat: 'Recorders & Storage', name: '1TB Surveillance HDD', price: 3200, icon: 'fa-database', supplier: 'Northpoint Security Distribution' },
        { id: 'hdd-2', type: 'product', cat: 'Recorders & Storage', name: '2TB Surveillance HDD', price: 4600, icon: 'fa-database', supplier: 'Northpoint Security Distribution' },
        { id: 'hdd-500', type: 'product', cat: 'Recorders & Storage', name: '500GB Surveillance HDD', price: 2100, icon: 'fa-database', supplier: 'Northpoint Security Distribution', desc: '3.5" surveillance-grade hard drive for DVR/NVR recording' },
        { id: 'dvr-4', type: 'product', cat: 'Recorders & Storage', name: '4-Channel DVR', price: 3900, icon: 'fa-hard-drive', supplier: 'Northpoint Security Distribution', desc: '4-channel 1080P hybrid DVR with mobile app viewing' },
        { id: 'pwr', type: 'product', cat: 'Power & Cabling', name: 'Power Adapter & Connectors', price: 350, icon: 'fa-plug', supplier: 'Cablenet Electrical Supply' },
        { id: 'cat6', type: 'product', cat: 'Power & Cabling', name: 'Cat6 Cable (305m Box)', price: 6500, icon: 'fa-network-wired', supplier: 'Cablenet Electrical Supply' },
        { id: 'poe', type: 'product', cat: 'Power & Cabling', name: 'PoE Switch 8-Port', price: 5400, icon: 'fa-ethernet', supplier: 'Cablenet Electrical Supply' },
        { id: 'ups', type: 'product', cat: 'Power & Cabling', name: 'UPS 650VA', price: 3800, icon: 'fa-car-battery', supplier: 'Cablenet Electrical Supply' },
        { id: 'rg59', type: 'product', cat: 'Power & Cabling', name: 'RG59 Siamese Cable (305m Box)', price: 3200, icon: 'fa-network-wired', supplier: 'Cablenet Electrical Supply', desc: 'Coaxial video + power cable for analog/HD CCTV' },
        { id: 'bnc', type: 'product', cat: 'Power & Cabling', name: 'BNC & DC Connector Set (10 pairs)', price: 450, icon: 'fa-plug', supplier: 'Cablenet Electrical Supply', desc: 'Twist-on BNC and DC male connectors' },
        { id: 'psu12', type: 'product', cat: 'Power & Cabling', name: '12V 10A CCTV Power Supply Box', price: 1450, icon: 'fa-car-battery', supplier: 'Cablenet Electrical Supply', desc: 'Centralized 9-output power supply for up to 8 cameras' },
        { id: 'lock', type: 'product', cat: 'Access Control', name: 'Fingerprint Door Lock', price: 9800, icon: 'fa-fingerprint', supplier: 'Lockwise Access Systems' },
        { id: 'bell', type: 'product', cat: 'Access Control', name: 'Video Doorbell', price: 6200, icon: 'fa-bell', supplier: 'Lockwise Access Systems' },
        { id: 'gate', type: 'product', cat: 'Access Control', name: 'Gate Access Controller', price: 11500, icon: 'fa-door-closed', supplier: 'Lockwise Access Systems' },
        { id: 'maglock', type: 'product', cat: 'Access Control', name: 'Magnetic Door Lock 600lbs', price: 2800, icon: 'fa-door-closed', supplier: 'Lockwise Access Systems', desc: 'Electromagnetic lock with mounting bracket' },
        { id: 'exitbtn', type: 'product', cat: 'Access Control', name: 'Exit Push Button', price: 350, icon: 'fa-hand-pointer', supplier: 'Lockwise Access Systems', desc: 'Stainless request-to-exit button' },
        { id: 'sol60', type: 'product', cat: 'Solar & Lighting', name: 'Solar Streetlight 60W', price: 18500, icon: 'fa-solar-panel', supplier: 'Sunvolt Solar Trading' },
        { id: 'solflood', type: 'product', cat: 'Solar & Lighting', name: 'Solar Floodlight 100W', price: 7200, icon: 'fa-lightbulb', supplier: 'Sunvolt Solar Trading' },
        { id: 'sol100', type: 'product', cat: 'Solar & Lighting', name: 'Solar Streetlight 100W', price: 24500, icon: 'fa-solar-panel', supplier: 'Sunvolt Solar Trading', desc: 'All-in-one solar streetlight with motion sensor and remote' },
        { id: 'hk-tvi4-2mp', type: 'product', cat: 'CCTV Kits', name: 'Hikvision 2MP 4CH HDTVI Combo Kit (TVI-4CH2D2B-2MP Eco 2.8mm)', price: 6110, icon: 'fa-video', supplier: 'Nanotec Corp. (Hikvision)', desc: 'DS-7204HGHI-M1 DVR, 2x DS-2CE76D0T-EXIPF turret, 2x DS-2CE16D0T-EXIPF bullet (2.8mm). 2-yr warranty' },
        { id: 'hk-tvi8-2mp', type: 'product', cat: 'CCTV Kits', name: 'Hikvision 2MP 8CH HDTVI Combo Kit (TVI-8CH4D4B-2MP Eco 2.8mm)', price: 10270, icon: 'fa-video', supplier: 'Nanotec Corp. (Hikvision)', desc: 'DS-7208HGHI-M1 DVR, 4x DS-2CE76D0T-EXIPF turret, 4x DS-2CE16D0T-EXIPF bullet (2.8mm). 2-yr warranty' },
        { id: 'hk-cv4-28', type: 'product', cat: 'CCTV Kits', name: 'Hikvision 2MP 4CH Lite ColorVu Kit with Mic (2.8mm)', price: 9430, icon: 'fa-video', supplier: 'Nanotec Corp. (Hikvision)', desc: 'TVI-Lite-4CH2D2B-2MP-ColorVu(2.8): DS-7204HGHI-M1 DVR, 2x DS-2CE10DF3T-PFS, 2x DS-2CE70DF3T-PFS. Built-in mic. 2-yr warranty' },
        { id: 'hk-cv4-36', type: 'product', cat: 'CCTV Kits', name: 'Hikvision 2MP 4CH Lite ColorVu Kit with Mic (3.6mm)', price: 9430, icon: 'fa-video', supplier: 'Nanotec Corp. (Hikvision)', desc: 'TVI-Lite-4CH2D2B-2MP-ColorVu: DS-7204HGHI-K1(S) DVR, 2x DS-2CE10DF3T-PFS, 2x DS-2CE70DF3T-PFS. Built-in mic. 2-yr warranty' },
        { id: 'hk-cv8-28', type: 'product', cat: 'CCTV Kits', name: 'Hikvision 2MP 8CH Lite ColorVu Kit with Mic (2.8mm)', price: 16970, icon: 'fa-video', supplier: 'Nanotec Corp. (Hikvision)', desc: 'TVI-Lite-8CH4D4B-2MP-ColorVu(2.8): DS-7208HGHI-M1 DVR, 4x DS-2CE10DF3T-PFS, 4x DS-2CE70DF3T-PFS. Built-in mic. 2-yr warranty' },
        { id: 'hk-tvi4-5mp', type: 'product', cat: 'CCTV Kits', name: 'Hikvision 5MP 4CH HDTVI Combo Kit (TVI-4CH2D2B-5MP)', price: 10170, icon: 'fa-video', supplier: 'Nanotec Corp. (Hikvision)', desc: 'DS-7204HUHI-K1/E(S) DVR, 2x DS-2CE16H0T-ITPF(C) bullet, 2x DS-2CE76H0T-ITPF(C) turret. 2-yr warranty' },
        { id: 'hk-tvi8-5mp', type: 'product', cat: 'CCTV Kits', name: 'Hikvision 5MP 8CH HDTVI Combo Kit (TVI-8CH4D4B-5MP)', price: 18850, icon: 'fa-video', supplier: 'Nanotec Corp. (Hikvision)', desc: 'DS-7208HUHI-K1/E(S) DVR, 4x DS-2CE16H0T-ITPF(C) bullet, 4x DS-2CE76H0T-ITPF(C) turret. 2-yr warranty' },
        { id: 'dh-kit1b04', type: 'product', cat: 'CCTV Kits', name: 'Dahua 2MP 4CH HDCVI Kit (DH-KIT1B04)', price: 6210, icon: 'fa-video', supplier: 'Dahua Technology', desc: '1x DH-XVR1B04 DVR, 2x HAC-B1A21N bullet, 2x HAC-T1A21N turret' },
        { id: 'dh-kit1b08', type: 'product', cat: 'CCTV Kits', name: 'Dahua 2MP 8CH HDCVI Kit (DH-KIT1B08)', price: 10430, icon: 'fa-video', supplier: 'Dahua Technology', desc: '1x DH-XVR1B08 DVR, 4x HAC-B1A21N bullet, 4x HAC-T1A21N turret' },
        { id: 'dh-wiz4', type: 'product', cat: 'CCTV Kits', name: 'Dahua 2MP 4CH WizSense Kit (DH-KIT-CVI2MP2B2T-I)', price: 6210, icon: 'fa-video', supplier: 'Dahua Technology', desc: '1x XVR1B04-I DVR, 2x B1A21N-0360B bullet, 2x T1A21N-0360B turret' },
        { id: 'dh-wiz8', type: 'product', cat: 'CCTV Kits', name: 'Dahua 2MP 8CH WizSense Kit (DH-KIT-CVI2MP4B4T-I)', price: 10430, icon: 'fa-video', supplier: 'Dahua Technology', desc: '1x XVR1B08-I DVR, 4x B1A21N-0360B bullet, 4x T1A21N-0360B turret' },
        { id: 'dh-fc4', type: 'product', cat: 'CCTV Kits', name: 'Dahua 2MP 4CH Full Color Kit (DH-KIT-CVI2MP2B2T-I)', price: 11740, icon: 'fa-video', supplier: 'Dahua Technology', desc: '1x XVR1B04-I DVR, 2x HFW1239CN-A-LED bullet, 2x HDW1239TLQN-A-LED turret' },
        { id: 'dh-fc8', type: 'product', cat: 'CCTV Kits', name: 'Dahua 2MP 8CH Full Color Kit (DH-KIT-CVI2MP4B4T-I)', price: 21520, icon: 'fa-video', supplier: 'Dahua Technology', desc: '1x XVR1B08-I DVR, 4x HFW1239CN-A-LED bullet, 4x HDW1239TLQN-A-LED turret' },
        { id: 'dh-sdl4', type: 'product', cat: 'CCTV Kits', name: 'Dahua 2MP 4CH SDL Kit (DH-KIT-CVI2MP2B2T-SDL)', price: 13385, icon: 'fa-video', supplier: 'Dahua Technology', desc: '1x DH-XVR1B04-I DVR, 2x HFW1239TLMN-IL-A bullet, 2x HDW1239TLQN-IL-A turret, 4 video power cables, 1 power adapter' },
        { id: 'dh-sdl8', type: 'product', cat: 'CCTV Kits', name: 'Dahua 2MP 8CH SDL Kit (DH-KIT-CVI2MP4B4T-SDL)', price: 24815, icon: 'fa-video', supplier: 'Dahua Technology', desc: '1x DH-XVR1B08-I DVR, 4x HFW1239TLMN-IL-A bullet, 4x HDW1239TLQN-IL-A turret, 8 video power cables, 2 power adapters' },
        { id: 'hk-wifi2-bb', type: 'product', cat: 'Wi-Fi CCTV Kits', name: 'Hikvision 2MP 2CH Wi-Fi Kit, 2 Bullet (NKS422W0H)', price: 3940, icon: 'fa-wifi', supplier: 'Nanotec Corp. (Hikvision)', desc: 'DS-7104NI-S1/W NVR, 2x IPC-B120HA-LIDF/W bullet. 2-yr warranty' },
        { id: 'hk-wifi2-bt', type: 'product', cat: 'Wi-Fi CCTV Kits', name: 'Hikvision 2MP 2CH Wi-Fi Kit, Bullet + Turret (NKS422W02H)', price: 4280, icon: 'fa-wifi', supplier: 'Nanotec Corp. (Hikvision)', desc: 'DS-7104NI-S1/W NVR, 1x IPC-B120HA-LIDF/W bullet, 1x IPC-F120-LIDF/W turret. 2-yr warranty' },
        { id: 'hk-wifi4-2mp', type: 'product', cat: 'Wi-Fi CCTV Kits', name: 'Hikvision 2MP 4CH Wi-Fi Combo Kit (NK42W0H(D))', price: 12460, icon: 'fa-wifi', supplier: 'Nanotec Corp. (Hikvision)', desc: 'DS-7104NI-K1/W/M(C) NVR, 4x DS-2CV1021G1-IDW (2.8mm). 2-yr warranty' },
        { id: 'hk-wifi4-4mp', type: 'product', cat: 'Wi-Fi CCTV Kits', name: 'Hikvision 4MP 4CH Wi-Fi Combo Kit (NK44W0H(D))', price: 16730, icon: 'fa-wifi', supplier: 'Nanotec Corp. (Hikvision)', desc: 'DS-7104NI-K1/W/M(C) NVR, 4x DS-2CV1041G1-IDW (2.8mm). 2-yr warranty' },
        { id: 'svc-install', type: 'service', name: 'Cabling & Installation', price: 6500, icon: 'fa-screwdriver-wrench', desc: 'Labor and materials for cabling and mounting' },
        { id: 'svc-survey',  type: 'service', name: 'Site Survey', price: 1500, icon: 'fa-clipboard-check', desc: 'On-site assessment and layout planning' },
        { id: 'svc-config',  type: 'service', name: 'System Configuration & Commissioning', price: 3000, icon: 'fa-sliders', desc: 'Setup, testing and customer handover' },
        { id: 'svc-maint',   type: 'service', name: 'Annual Maintenance Plan', price: 8000, icon: 'fa-shield-halved', desc: 'Two preventive visits per year' },
        { id: 'svc-reloc',   type: 'service', name: 'Camera Relocation', price: 1800, icon: 'fa-up-down-left-right', desc: 'Per camera' },
        /* CCTV packages (BeyondWires package poster) */
        { id: 'pkg-cctv2', type: 'package', name: '2-Channel CCTV Package', price: 8500, icon: 'fa-box-open', desc: 'Perfect for small spaces. 2 cameras with built-in mic, 1 DVR, 1 500GB HDD, all accessories, free installation. 1-yr product, 90-day service warranty' },
        { id: 'pkg-cctv3', type: 'package', name: '3-Channel CCTV Package', price: 12500, icon: 'fa-box-open', desc: 'Ideal for homes & small businesses. 3 cameras with built-in mic, 1 DVR, 1 500GB HDD, all accessories, free installation. 1-yr product, 90-day service warranty' },
        { id: 'pkg-cctv4', type: 'package', name: '4-Channel CCTV Package', price: 16500, icon: 'fa-box-open', desc: 'Complete coverage for your property. 4 cameras with built-in mic, 1 DVR, 1 500GB HDD, all accessories, free installation. 1-yr product, 90-day service warranty' },
    ].concat((function () {
        /* CCTV package pricelist (Dahua Technology / Hikvision), 2 to 16 cameras: price = cameras x price per camera */
        const RATES = [['2MP/1080P', 'Standard', 3500],
                       ['2MP/1080P', 'Full Color', 4500],
                       ['2MP/1080P', 'with Built-in Mic', 4000],
                       ['2MP/1080P', 'Full Color with Mic', 5000],
                       ['5MP/3K', 'Standard', 5000],
                       ['5MP/3K', 'Full Color', 6000],
                       ['5MP/3K', 'with Built-in Mic', 5500],
                       ['5MP/3K', 'Full Color with Mic', 6500]];
        const list = [];
        for (let n = 2; n <= 16; n++) RATES.forEach(([res, kind, rate]) => list.push({
            id: 'pl-' + n + '-' + res.slice(0, 1) + kind.replace(/[^A-Za-z]/g, '').toLowerCase().slice(0, 12), type: 'product', cat: 'CCTV Package Sets',
            name: n + '-Channel CCTV Set, ' + res + ' ' + kind, price: n * rate, icon: 'fa-layer-group', supplier: 'Dahua & Hikvision Package Pricelist',
            desc: n + ' cameras (' + res + ', ' + kind.toLowerCase() + ') with DVR. Dahua/Hikvision package pricelist'
        }));
        return list;
    })());
    /* =========================================================
       Data from the server, mapped to the shape the page uses
    ========================================================= */
    const defChecklist = () => ['Site preparation', 'Equipment mounting', 'Cabling & PoE', 'Recorder setup & configuration', 'Testing & customer handover'].map(label => ({ label, state: 'Pending' }));
    function scopeFor(p) {
        if (p === 'Products') return 'Scope of work: supply of CCTV and related accessories.';
        if (p === 'Services') return 'Scope of work: installation, configuration and commissioning of CCTV and related accessories.';
        return 'Scope of work: supply and installation of CCTV and related accessories, including testing and commissioning.';
    }
    const OPTION = { product: 'Products', service: 'Services', package: 'Package', both: 'Products and Services' };
    const AGREE_KEY = { 'Half upon quotation': 'half', 'Full upon quotation': 'full', 'Full after installation': 'after' };
    const AGREE_SRV = { half: 'Half upon quotation', full: 'Full upon quotation', after: 'Full after installation' };
    const METHOD_SRV = { 'Online': 'Online', 'Over the Counter': 'Over the counter' };
    const ymd = v => String(v || '').slice(0, 10);
    const stamp = v => { if (!v) return ''; const d = new Date(String(v).replace(' ', 'T')); return MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate() + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };
    const inqNo = i => window.BW.inqNo(i.inquiry_id, i.date_submitted);
    function fromServer(S) {
        if (S.labor_rates) LABOR_RATES = S.labor_rates;
        if (S.standard_slots) DEFAULT_SLOTS = S.standard_slots;
        const catalog = S.catalog.map(c => ({ id: String(c.product_id), type: c.item_type, cat: c.item_type === 'product' ? c.category : (['Services', 'Packages', 'General'].includes(c.category) ? '' : c.category),
            name: c.name, price: +c.unit_price, icon: c.icon || CAT_ICON[c.category] || TYPE_ICON[c.item_type], desc: c.description || '', supplier: c.supplier || '', archived: !+c.is_active,
            updated: ymd(c.updated_at), history: (c.history || []).map(h => ({ date: ymd(h.changed_at), from: +h.old_price, to: +h.new_price, note: h.note || '' })) }));
        const inqById = {};
        const inquiries = S.inquiries.map(i => {
            const o = { id: inqNo(i), dbId: +i.inquiry_id, name: i.customer, email: i.email, phone: i.phone_number || '', address: i.installation_address, province: i.province || '', city: i.city || '', landmark: i.landmark || '', placeType: i.place_type,
                purchase: OPTION[i.purchase_option] || 'Products and Services', siteVisit: !!+i.needs_site_visit,
                pref: i.visit_date ? { date: i.visit_date, time: i.visit_slot } : null, visitId: i.visit_schedule_id ? +i.visit_schedule_id : 0, visitStatus: i.visit_status, visitDone: !!+i.site_visit_done,
                submitted: String(i.date_submitted).replace(' ', 'T').slice(0, 16), serverStatus: i.status,
                status: i.status === 'Failed' ? 'Rejected' : i.status === 'Quoted' || i.status === 'Completed' ? 'Accepted' : i.status,
                quoteDbId: i.quotation_id ? +i.quotation_id : 0,
                selections: (i.items || []).map(x => ({ id: String(x.product_id), qty: +x.quantity || 1, kind: x.item_type === 'service' ? 'service' : 'product', name: x.name, desc: x.description || x.category || '', price: +x.unit_price })),
                budget: i.budget_range || '', addMore: i.submission_ref ? 'Yes (sent with other inquiries)' : 'No',
                rejection: i.rejection_reason ? { reason: i.rejection_reason, note: i.rejection_note || '', date: ymd(i.rejected_at) } : null,
                /* commercial clients: the person who handles the installation on site (customer Settings > Contacts) */
                contact: i.place_type === 'Commercial' && i.contact_name ? { name: i.contact_name, role: i.contact_role || '', email: i.contact_email || '', phone: i.contact_phone || '' } : null };
            inqById[o.dbId] = o; return o;
        });
        const quoteByDb = {};
        const quotes = S.quotations.map(q => {
            const o = { id: q.quotation_no, dbId: +q.quotation_id, inqDbId: +q.inquiry_id, inqId: inqById[q.inquiry_id] ? inqById[q.inquiry_id].id : '', customer: q.customer, email: q.email,
                placeType: q.place_type, purchase: OPTION[q.purchase_option] || 'Products and Services', date: ymd(q.date_created), status: q.status, superComment: q.superadmin_comment || '',
                items: q.items.map(i => ({ id: String(i.product_id), name: i.description, qty: +i.quantity, price: +i.unit_price })),
                expenses: q.charges.map(c => ({ id: 'x' + c.charge_id, label: c.label, amount: +c.amount })),
                crew: q.labor.map(l => ({ id: 'w' + l.labor_id, role: l.role, count: +l.workers, days: +l.days, rate: +l.daily_rate })),
                noLabor: !!+q.no_labor || (!q.labor.length && +q.labor_total === 0 && +q.vat_amount === 0), noVat: +q.vat_amount === 0 && +q.total_amount > 0,
                scope: q.scope_of_work || scopeFor(OPTION[q.purchase_option]), project: q.project_title || '', duration: q.duration || '', address: q.site_address || '', incharge: q.project_incharge || '',
                payTerms: q.payment_terms || '', notes: q.notes || '', total: +q.total_amount, projectDbId: q.project_id ? +q.project_id : 0,
                log: q.events.map(e => ({ t: e.event, d: fmtDate(e.created_at) })) };
            if (!o.log.length) o.log = [{ t: 'Created', d: fmtDate(q.date_created) }];
            inqById[q.inquiry_id] && (inqById[q.inquiry_id].quoteId = inqById[q.inquiry_id].quoteDbId === o.dbId ? o.id : inqById[q.inquiry_id].quoteId);
            quoteByDb[o.dbId] = o; return o;
        });
        const bookings = S.bookings.map(b => ({ id: 'b' + b.schedule_id, sid: +b.schedule_id, customer: b.customer || 'Customer', type: b.activity_type === 'Installation' ? 'Installation' : 'Site Visit',
            date: b.scheduled_date, time: b.time_slot, status: b.status, inqId: b.inquiry_id && inqById[b.inquiry_id] ? inqById[b.inquiry_id].id : null, inqDbId: b.inquiry_id ? +b.inquiry_id : 0,
            projDbId: b.project_id ? +b.project_id : 0, prev: b.previous_date ? { date: b.previous_date, time: b.previous_slot, reason: b.change_reason || '', at: b.changed_at } : null }));
        const requests = bookings.filter(b => b.prev && b.status === 'Requested').map(b => ({ id: 'r' + b.sid, bookingId: b.id, reason: b.prev.reason, oldDate: b.prev.date, oldTime: b.prev.time,
            newDate: b.date, newTime: b.time, status: 'Pending', ago: window.BW.ago(b.prev.at), proposed: null }));
        const projects = S.projects.map(p => {
            const agreement = AGREE_KEY[p.agreement] || 'half', pays = p.payments || [];
            const isFinal = x => x.installment === 'Final balance' || (x.installment === 'Full' && agreement === 'after');
            const down = pays.find(x => !isFinal(x)), fin = pays.find(isFinal);
            const proofOf = x => x && x.status === 'Under Review' ? { ref: x.reference_no || '—', amount: +x.amount_due, submitted: stamp(x.transaction_date), paymentId: +x.payment_id, hasPhoto: !!+x.has_proof } : null;
            let status;
            if (p.status === 'Installation In Progress') status = p.install_status === 'In progress' ? 'Installation In Progress' : p.install_status === 'Scheduled' ? 'Installation Scheduled' : 'Ready for Installation';
            else if (p.status === 'Awaiting Final Payment') status = fin && fin.status === 'Under Review' ? 'Final Payment Under Review' : 'Awaiting Final Payment';
            else status = p.status;
            const inst = p.install_schedule && (p.install_schedule.status === 'Requested' || p.install_schedule.status === 'Confirmed') ? p.install_schedule : null;
            const c = p.certificate;
            return { id: window.BW.prjNo(p.project_id), dbId: +p.project_id, quoteId: p.quotation_no, quoteDbId: +p.quotation_id, customer: p.customer, email: p.email, type: p.place_type || 'Residential', province: p.province || '', city: p.city || '',
                title: p.project_name || 'Project', status, serverStatus: p.status, agreement, method: (pays[0] && pays[0].payment_method === 'Over the counter') || p.method === 'Over the counter' ? 'Over the Counter' : 'Online',
                paid: Math.round(pays.filter(x => x.status === 'Confirmed').reduce((s2, x) => s2 + +x.amount_paid, 0) * 100) / 100,
                down, fin, proof: proofOf(down), finalProof: proofOf(fin), locked: pays.some(x => x.status === 'Confirmed' || +x.has_proof),
                receipts: pays.filter(x => x.receipt_no).map(x => ({ no: x.receipt_no, amount: +x.amount_paid, method: x.payment_method === 'Online' ? 'Online' : 'Over the Counter', date: ymd(x.confirmed_at || x.issued_at),
                    kind: isFinal(x) ? 'final' : 'down', label: isFinal(x) ? (agreement === 'half' ? '50% balance (final payment)' : 'Full payment after installation') : (agreement === 'half' ? '50% down payment' : 'Full payment'),
                    ref: x.reference_no || '', sent: x.sent_at ? ymd(x.sent_at) : null, paymentId: +x.payment_id })),
                install: p.install_status || null, startDate: ymd(p.start_date), endDate: ymd(p.end_date), checklist: p.checklist && p.checklist.length ? p.checklist : defChecklist(),
                bookingId: inst ? 'b' + inst.schedule_id : null, approvedOn: ymd(p.created_at),
                cert: c ? Object.assign({ photos: [], sent: null }, c.data || {}, { photos: (p.photos || []).map(ph => ({ id: +ph.photo_id, src: window.BW.fileUrl('/admin/projects/' + p.project_id + '/certificate/photos/' + ph.photo_id), caption: ph.caption || '' })), sent: c.sent_at ? ymd(c.sent_at) : null }) : null,
                photos: p.photos || [], docsSent: p.documents || {} };
        });
        projects.forEach(p => { const b = bookings.find(x => x.id === p.bookingId); if (b) b.projId = p.id; });
        const availability = {};
        Object.keys(S.availability || {}).forEach(d => { availability[d] = S.availability[d]; });
        return { catalog, inquiries, quotes, projects, bookings, requests, availability, counters: {}, flags: {} };
    }
    let DB;
    try { DB = fromServer(await api('/admin/state')); }
    catch (e) { document.body.innerHTML = '<div style="font:14px sans-serif;padding:40px;max-width:640px;margin:auto"><h2>Cannot load the admin dashboard</h2><p>' + esc(e.message) + '</p></div>'; return; }
    const save = () => true;   // changes go to the server (see act())
    /* Send a change to the server, then reload everything from it. Returns false (and shows why) if the server refused. */
    async function act(fn, okMsg) {
        try { await fn(); }
        catch (e) { toast(e.message || 'Something went wrong'); return false; }
        try { DB = fromServer(await api('/admin/state')); } catch (e) { toast(e.message); }
        refreshAll();
        if (curProj && !$('#projDetail').hidden) renderProjView();
        if (okMsg) toast(okMsg);
        return true;
    }
    const catalog = () => DB.catalog.filter(c => !c.archived);
    /* Suppliers: 'all' = every supplier, NO_SUP = items with no supplier (services and our own packages) */
    const NO_SUP = '__none', NO_SUP_LABEL = 'BeyondWires (in-house)';
    const supMatch = (c, sup) => !sup || sup === 'all' || (sup === NO_SUP ? !c.supplier : c.supplier === sup);
    const supList = items => Array.from(new Set(items.filter(c => c.supplier).map(c => c.supplier))).sort((a, b) => a.localeCompare(b));
    const supOptions = (items, cur, allLabel) => '<option value="all">' + allLabel + '</option>' +
        supList(items).map(s => '<option value="' + esc(s) + '"' + (s === cur ? ' selected' : '') + '>' + esc(s) + '</option>').join('') +
        (items.some(c => !c.supplier) ? '<option value="' + NO_SUP + '"' + (cur === NO_SUP ? ' selected' : '') + '>' + NO_SUP_LABEL + '</option>' : '');
    const catList = (all, type, sup) => {
        const used = new Set(DB.catalog.filter(c => (!type || type === 'all' || c.type === type) && (all || !c.archived) && supMatch(c, sup) && c.cat).map(c => c.cat));
        const base = DEFAULT_CATS.filter(c => used.has(c));
        used.forEach(c => { if (!base.includes(c)) base.push(c); });
        return base;
    };
    const slotsOf = d => DB.availability[d] || [];
    const setSlots = (d, arr) => { const u = sortTimes(Array.from(new Set(arr))); if (u.length) DB.availability[d] = u; else delete DB.availability[d]; };

    const crewCost = c => round2((+c.count || 0) * (+c.days || 0) * (+c.rate || 0));
    /* Total = items + extra expenses + labor (crew x days x daily rate), then VAT on all three */
    const calc = q => {
        const sub = round2(q.items.reduce((s, i) => s + i.qty * i.price, 0));
        const exp = round2((q.expenses || []).reduce((s, x) => s + (+x.amount || 0), 0));
        const lab = round2((q.crew || []).reduce((s, c) => s + crewCost(c), 0));
        const vat = q.noVat ? 0 : round2((sub + exp + lab) * VAT_RATE);   // quotations made before VAT was added keep their original total
        return { sub, exp, lab, vat, total: round2(sub + exp + lab + vat) };
    };
    const qTotal = q => calc(q).total;
    const projQuote = p => DB.quotes.find(q => q.id === p.quoteId);
    const balanceOf = p => round2(qTotal(projQuote(p)) - p.paid);
    const dueNow = p => { const t = qTotal(projQuote(p)); return p.agreement === 'half' ? Math.round(t * 100 / 2) / 100 : p.agreement === 'full' ? t : 0; };
    const openInquiries = () => DB.inquiries.filter(i => !i.quoteId && i.status !== 'Rejected');
    const dateStatus = (d, ex) => {
        if (d < TODAY) return 'off';
        const all = slotsOf(d); if (!all.length) return 'off';
        const free = all.filter(t => !slotTaken(d, t, ex)).length;
        return free === 0 ? 'off' : free / all.length <= 0.5 ? 'limit' : 'avail';
    };
    const slotTaken = (d, t, ex) => DB.bookings.some(b => b.date === d && b.time === t && b.id !== ex);
    const typeCls = t => t === 'Installation' ? 'install' : 'visit';
    const logEntry = (q, t) => { const d = new Date(); q.log.unshift({ t, d: MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate() + ', ' + d.getFullYear() }); };
    const nextQuoteId = () => 'QUO-' + new Date().getFullYear() + '-' + pad(DB.quotes.reduce((m, q) => Math.max(m, +q.id.split('-')[2]), 0) + 1, 3);
    const nextProjectId = () => 'PRJ-' + pad(DB.projects.reduce((m, p) => Math.max(m, +p.id.split('-')[1]), 0) + 1, 3);
    const QS_CLS = { 'Draft': 'draft', 'Pending Superadmin': 'pending', 'Sent to Customer': 'sent', 'Approved': 'approved', 'Declined': 'declined', 'Revision Requested': 'pending' };
    const qsPill = s => '<span class="qs ' + QS_CLS[s] + '">' + esc(s) + '</span>';
    const bookingById = id => DB.bookings.find(b => b.id === id);

    /* =========================================================
       Panes (show one child of a tab at a time)
    ========================================================= */
    function pane(tab, id) { $$('#tab-' + tab + ' .pane').forEach(p => { p.hidden = p.id !== id; }); window.scrollTo(0, 0); }

    /* =========================================================
       Modal
    ========================================================= */
    let mHandler = null;
    function openModal(html, handler) { const h = $('#modalHost'); h.innerHTML = '<div class="mc">' + html + '</div>'; h.style.display = 'flex'; mHandler = handler || null; return h; }
    function closeModal() { const h = $('#modalHost'); h.style.display = 'none'; h.innerHTML = ''; mHandler = null; }
    $('#modalHost').addEventListener('click', e => {
        if (e.target.id === 'modalHost' || e.target.closest('[data-close]')) return closeModal();
        if (mHandler) mHandler(e);
    });

    /* =========================================================
       Calendar picker (dark in tabs, light inside modals)
    ========================================================= */
    function Picker(host, o) {
        const base = o.date ? toDate(o.date) : new Date();
        const st = { y: base.getFullYear(), m: base.getMonth(), date: o.date || '', time: o.time || '' };
        function draw() {
            const first = new Date(st.y, st.m, 1).getDay(), dim = new Date(st.y, st.m + 1, 0).getDate();
            let g = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => '<div class="cp-dow">' + d + '</div>').join('');
            for (let i = 0; i < first; i++) g += '<div></div>';
            for (let d = 1; d <= dim; d++) {
                const k = st.y + '-' + pad(st.m + 1) + '-' + pad(d), s = dateStatus(k, o.exclude);
                const dis = !o.allowAll && s === 'off';
                const has = o.dots && DB.bookings.some(b => b.date === k);
                g += '<button type="button" class="cp-d ' + s + (k === st.date ? ' sel' : '') + (has ? ' has' : '') + '" data-d="' + k + '"' + (dis ? ' disabled' : '') + '>' + d + '</button>';
            }
            let h = '<div class="cp"><div class="cp-head"><button type="button" class="cp-nav" data-n="-1" aria-label="Previous month">&lsaquo;</button><b>' + MONTHS[st.m] + ' ' + st.y + '</b><button type="button" class="cp-nav" data-n="1" aria-label="Next month">&rsaquo;</button></div>' +
                '<div class="cp-grid">' + g + '</div><div class="cp-legend"><span><i class="avail"></i>Available</span><span><i class="limit"></i>Limited Slots</span><span><i class="off"></i>Unavailable</span></div>';
            if (o.times) {
                const list = !st.date ? [] : sortTimes(Array.from(new Set(slotsOf(st.date).concat(o.time && st.date === o.date ? [o.time] : []))));
                h += '<div class="cp-label">Available Time Slots</div>' + (list.length ? '<div class="ts-grid">' + list.map(t => {
                    const tk = slotTaken(st.date, t, o.exclude);
                    return '<button type="button" class="ts' + (t === st.time ? ' on' : '') + (tk ? ' taken' : '') + '" data-t="' + t + '"' + (tk ? ' disabled' : '') + '>' + t + '</button>';
                }).join('') + '</div>' : '<p class="cp-empty">' + (st.date ? 'No slots are published for this date. Choose another date.' : 'Choose a date to see its available slots.') + '</p>');
            }
            host.innerHTML = h + '</div>';
        }
        host.addEventListener('click', e => {
            const n = e.target.closest('[data-n]');
            if (n) { st.m += +n.dataset.n; if (st.m < 0) { st.m = 11; st.y--; } if (st.m > 11) { st.m = 0; st.y++; } return draw(); }
            const d = e.target.closest('[data-d]');
            if (d && !d.disabled) { st.date = d.dataset.d; if (st.time && (slotTaken(st.date, st.time, o.exclude) || (!slotsOf(st.date).includes(st.time) && !(st.date === o.date && st.time === o.time)))) st.time = ''; draw(); return o.onChange && o.onChange(st.date, st.time); }
            const t = e.target.closest('[data-t]');
            if (t && !t.disabled) { st.time = t.dataset.t; draw(); o.onChange && o.onChange(st.date, st.time); }
        });
        draw();
        return { get: () => ({ date: st.date, time: st.time }), refresh: draw, setDate(d) { if (!d) return; const b = toDate(d); st.date = d; st.y = b.getFullYear(); st.m = b.getMonth(); draw(); } };
    }

    /* =========================================================
       Routing / sidebar / dropdowns
    ========================================================= */
    const TABS = {
        dashboard:  ['Dashboard',  'Overview of inquiries, quotations, projects and schedules'],
        inquiries:  ['Inquiries',  'Review incoming inquiries and create quotations'],
        quotations: ['Quotation',  'Track every quotation from draft to customer approval'],
        projects:   ['Projects',   'Payments, installation progress and completion'],
        schedules:  ['Schedules',  'Publish your available slots, then manage visits, installations and reschedule requests'],
        products:   ['Products',   'Manage the catalog and update prices when your supplier changes them'],
        settings:   ['Settings',   'Customize your theme and manage your account']
    };
    function activateTab(name) {
        if (!TABS[name]) name = 'dashboard';
        $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
        $$('.nav-item[data-tab]').forEach(a => a.classList.toggle('active', a.dataset.tab === name));
        $('#pageTitle').textContent = TABS[name][0];
        $('#pageSubtitle').textContent = TABS[name][1];
        document.title = TABS[name][0] + ' - Beyond Wires';
        closeDropdowns();
        refreshAll();
        window.scrollTo(0, 0);
    }
    function showTab(name) { if (location.hash === '#' + name) activateTab(name); else location.hash = name; }
    window.addEventListener('hashchange', () => activateTab(location.hash.slice(1)));
    document.addEventListener('click', e => { const a = e.target.closest('a[data-tab]'); if (a) { e.preventDefault(); showTab(a.dataset.tab); } });

    function setSidebar(collapsed) {
        $('#app').classList.toggle('collapsed', collapsed);
        const b = $('#sidebar-toggle'), l = collapsed ? 'Expand sidebar' : 'Minimize sidebar';
        b.setAttribute('aria-label', l); b.title = l;
        b.innerHTML = '<i class="fa-solid ' + (collapsed ? 'fa-angles-right' : 'fa-angles-left') + '"></i>';
        store.set('bw_admin_sidebar', collapsed);
    }
    $('#sidebar-toggle').addEventListener('click', () => setSidebar(!$('#app').classList.contains('collapsed')));

    function closeDropdowns(except) { $$('.dropdown-menu.show').forEach(m => { if (m !== except) m.classList.remove('show'); }); }
    document.addEventListener('click', e => {
        const t = e.target.closest('[data-dd]');
        if (t) { const m = document.getElementById(t.dataset.dd), open = !m.classList.contains('show'); closeDropdowns(); if (open && m.id === 'notif-dropdown') bell.load(); m.classList.toggle('show', open); return; }
        if (!e.target.closest('.dropdown-menu[data-keep]')) closeDropdowns();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') { closeDropdowns(); closeModal(); }
        if ((e.key === 'Enter' || e.key === ' ') && e.target.id === 'profile-btn') { e.preventDefault(); e.target.click(); }
    });
    $('#my-profile').addEventListener('click', () => { closeDropdowns(); showTab('settings'); });
    $('#logout').addEventListener('click', () => {
        closeDropdowns();
        if (confirm('Are you sure you want to log out?')) { toast('Logging out...'); window.BW.logout(LOGIN_URL); }
    });

    /* ---------- notifications (from the server; same layout and behaviour as the Super Admin page) ----------
       Click (or Enter / Space) opens the related record and marks it as read. */
    const bell = window.BW.Notifications({
        list: 'notif-list', dot: 'notif-dot', markAll: 'mark-read', close: () => closeDropdowns(), toast,
        open(link) {
            const [kind, id] = link.split(':');
            if (kind === 'inquiry') { showTab('inquiries'); const i = DB.inquiries.find(x => x.dbId === +id); if (i) { if (i.quoteId) { showTab('quotations'); openQuoteView(i.quoteId); } else openInquiry(i); } return; }
            if (kind === 'quotation') { const q = DB.quotes.find(x => x.dbId === +id); showTab('quotations'); if (q) openQuoteView(q.id); return; }
            if (kind === 'project') { const p = DB.projects.find(x => x.dbId === +id); showTab('projects'); if (p) openProject(p.id); return; }
            if (kind === 'schedule') { const b = DB.bookings.find(x => x.sid === +id); if (b) schedDate = b.date; showTab('schedules'); return; }
            showTab('dashboard');
        }
    });
    const renderNotifs = () => bell.load();

    /* =========================================================
       Dashboard
    ========================================================= */
    function renderDashboard() {
        const inq = openInquiries(), fresh = inq.filter(i => i.status === 'New Inquiry');
        const oldest = fresh.slice().sort((a, b) => a.submitted.localeCompare(b.submitted))[0];
        const drafts = DB.quotes.filter(q => q.status === 'Draft').length, pend = DB.quotes.filter(q => q.status === 'Pending Superadmin').length, sentC = DB.quotes.filter(q => q.status === 'Sent to Customer').length;
        const active = DB.projects.filter(p => p.status !== 'Done');
        const payN = active.filter(p => /Payment/.test(p.status)).length, instN = active.filter(p => /Installation/.test(p.status)).length;
        const up = DB.bookings.filter(b => b.date >= TODAY).sort((a, b) => (a.date + pad(t2m(a.time), 4)).localeCompare(b.date + pad(t2m(b.time), 4)));
        const cards = [
            { go: 'inquiries', ico: 'fa-inbox', c: 'blue', label: 'PENDING INQUIRIES', val: fresh.length, meta: ['<b>' + fresh.filter(i => i.siteVisit).length + '</b> requesting a site visit', oldest ? 'Oldest: <b>' + fmtDate(oldest.submitted) + '</b>' : 'All caught up'], foot: 'Review inquiries' },
            { go: 'quotations', ico: 'fa-file-invoice-dollar', c: 'violet', label: 'PENDING QUOTATIONS', val: drafts + pend, meta: ['<b>' + drafts + '</b> drafts \u00B7 <b>' + pend + '</b> awaiting superadmin', '<b>' + sentC + '</b> waiting on customer'], foot: 'Open quotations' },
            { go: 'projects', ico: 'fa-folder-open', c: 'green', label: 'ACTIVE PROJECTS', val: active.length, meta: ['<b>' + payN + '</b> in payment stage', '<b>' + instN + '</b> in installation'], foot: 'View projects' },
            { go: 'schedules', ico: 'fa-regular fa-calendar', c: 'amber', label: 'UPCOMING SCHEDULES', val: up.length, meta: [up[0] ? 'Next: <b>' + fmtDate(up[0].date) + ' \u00B7 ' + up[0].time + '</b>' : 'Nothing scheduled', '<b>' + DB.requests.filter(r => r.status === 'Pending').length + '</b> reschedule request(s)'], foot: 'Open calendar' }
        ];
        $('#dashStats').innerHTML = cards.map(c => '<div class="stat-card v2" data-go="' + c.go + '"><div class="stat-top"><span class="stat-label">' + c.label + '</span><span class="stat-ico ' + c.c + '"><i class="' + (c.ico.indexOf('regular') > -1 ? c.ico : 'fa-solid ' + c.ico) + '"></i></span></div>' +
            '<span class="stat-value">' + c.val + '</span><div class="stat-meta">' + c.meta.map(m => '<span>' + m + '</span>').join('') + '</div><div class="stat-foot"><span>' + c.foot + '</span><i class="fa-solid fa-arrow-right"></i></div></div>').join('');
        $('#dashPipeline').innerHTML = [['INQUIRIES', inq.length, 'inquiries'], ['QUOTATIONS', DB.quotes.length, 'quotations'], ['PROJECTS', DB.projects.length, 'projects'], ['COMPLETED', DB.projects.filter(p => p.status === 'Done').length, 'projects']]
            .map((s, i) => (i ? '<i class="fa-solid fa-chevron-right pipe-arrow"></i>' : '') + '<div class="pipe-step" data-go="' + s[2] + '"><small>' + s[0] + '</small><b>' + s[1] + '</b></div>').join('');

        const latest = inq.slice().sort((a, b) => b.submitted.localeCompare(a.submitted)).slice(0, 4);
        $('#dash-inquiries').innerHTML = latest.map(i => '<div class="list-item" data-go="inquiries"><div class="item-left"><div class="mini-av" style="background:' + avColor(i.name) + '">' + ini(i.name) + '</div><div class="item-details"><span class="item-title">' + esc(i.name.toUpperCase()) + '</span><span class="item-desc">' + esc(i.placeType) + ' \u00B7 ' + esc(i.purchase) + '</span></div></div>' + statusBadge(i.status) + '</div>').join('') || '<div class="empty-note">No open inquiries</div>';
        $('#dash-schedule').innerHTML = up.slice(0, 5).map(b => { const d = toDate(b.date); return '<div class="list-item" data-go="schedules" data-date="' + b.date + '"><div class="item-left"><div class="date-chip"><small>' + MONTHS[d.getMonth()].slice(0, 3) + '</small><b>' + d.getDate() + '</b></div><div class="item-details"><span class="item-title">' + esc(b.customer.toUpperCase()) + '</span><span class="item-desc">' + b.time + ' \u00B7 ' + DAYS[d.getDay()] + '</span></div></div><span class="type-pill ' + typeCls(b.type) + '">' + b.type.toUpperCase() + '</span></div>'; }).join('') || '<div class="empty-note">No upcoming schedules</div>';
    }
    document.addEventListener('click', e => {
        const el = e.target.closest('#tab-dashboard [data-go]'); if (!el) return;
        if (el.dataset.date) schedDate = el.dataset.date;
        showTab(el.dataset.go);
    });

    /* =========================================================
       Inquiries
    ========================================================= */
    const statusBadge = s => '<span class="status-badge ' + ({ 'New Inquiry': 'new', 'Accepted': 'accepted', 'Pending Visit': 'pending', 'Rejected': 'rejected' }[s] || 'new') + '"><span class="dot"></span> ' + esc(s) + '</span>';

    /* Province filter (service area: mainland Luzon): lists only the provinces that appear in the given rows */
    function provinceFilter(sel, rows) {
        const el = $(sel), cur = el.value || 'all';
        const cities = Array.from(new Set(rows.map(r => r.province).filter(Boolean))).sort((a, b) => a.localeCompare(b));
        el.innerHTML = '<option value="all">All Provinces</option>' + cities.map(c => '<option' + (c === cur ? ' selected' : '') + '>' + esc(c) + '</option>').join('');
        if (el.value !== cur) el.value = 'all';
        return el.value;
    }
    function renderInquiries() {
        const q = $('#inqSearch').value.trim().toLowerCase(), st = $('#statusFilter').value, ct = provinceFilter('#inqCity', DB.inquiries.filter(i => !i.quoteId));
        const rows = DB.inquiries.filter(i => !i.quoteId && (st === 'all' || i.status === st) && (ct === 'all' || i.province === ct) &&
            (!q || [i.name, i.id, i.placeType, i.purchase, i.email, i.address].some(v => String(v || '').toLowerCase().includes(q))))
            .sort((a, b) => b.submitted.localeCompare(a.submitted));
        $('#inqTable').innerHTML = '<table><thead><tr><th>CUSTOMER NAME</th><th>DATE SUBMITTED</th><th>PROPERTY TYPE</th><th>SITE VISIT</th><th>STATUS</th><th class="text-right">ACTIONS</th></tr></thead><tbody>' +
            (rows.map(i => {
                const rejected = i.status === 'Rejected';
                const main = rejected ? '' : (i.status === 'Accepted' ? '<button class="btn-quotation" data-a="quote">Create Quotation</button>'
                        : i.status === 'Pending Visit' ? '<button class="btn-accept" data-a="visit" title="Mark the site visit as done so the quotation can be made">Visit Done</button>'
                        : '<button class="btn-accept" data-a="accept">Accept</button>') +
                    '<button class="btn-reject" data-a="reject" title="Reject: outside service area">Reject</button>';
                return '<tr data-id="' + i.id + '"><td><div class="customer-info"><div class="avatar" style="background:' + avColor(i.name) + '">' + ini(i.name) + '</div><div><span>' + esc(i.name) + '</span><small class="cust-sub">' + i.id + ' \u00B7 ' + esc(i.address || '') + '</small></div></div></td>' +
                    '<td class="date-col"><span class="nowrap">' + fmtDate(i.submitted) + ',</span> <span class="nowrap">' + fmtTime(i.submitted) + '</span></td><td><span class="badge blue">' + esc(i.placeType || '\u2014') + '</span></td>' +
                    '<td><div class="visit-info"><span class="pill ' + (i.siteVisit ? 'yes' : 'no') + '"><span class="dot"></span> ' + (i.siteVisit ? 'YES' : 'NO') + '</span>' + (i.siteVisit && i.pref ? '<span class="pref-time">Pref: ' + fmtDate(i.pref.date) + ', ' + i.pref.time + '</span>' : '') + '</div></td>' +
                    '<td>' + statusBadge(i.status) + (rejected && i.rejection ? '<small class="cust-sub">' + esc(i.rejection.reason) + '</small>' : '') + '</td><td class="actions-col">' + main +
                    '<button class="btn-details" data-a="details">Details</button></td></tr>';
            }).join('') || '<tr><td colspan="6" class="empty-row">No inquiries match your search.</td></tr>') + '</tbody></table>';
    }
    $('#inqSearch').addEventListener('input', renderInquiries);
    $('#statusFilter').addEventListener('change', renderInquiries);
    $('#inqCity').addEventListener('change', renderInquiries);
    $('#inqTable').addEventListener('click', e => {
        const b = e.target.closest('button[data-a]'); if (!b) return;
        const i = DB.inquiries.find(x => x.id === b.closest('tr').dataset.id);
        if (b.dataset.a === 'details') return openInquiry(i);
        if (b.dataset.a === 'accept') return act(() => api('/admin/inquiries/' + i.dbId + '/accept', { body: {} }), 'Inquiry from ' + i.name + ' accepted. The customer was notified.');
        if (b.dataset.a === 'visit') {
            if (!i.visitId) return toast('This inquiry has no booked site visit. Use Details > Change schedule to book one.');
            if (!confirm('Mark the site visit for ' + i.name + ' as done? You can then create the quotation.')) return;
            return act(async () => {
                if (i.visitStatus === 'Requested') await api('/admin/inquiries/' + i.dbId + '/site-visit/confirm', { body: {} });
                await api('/admin/inquiries/' + i.dbId + '/site-visit/complete', { body: {} });
            }, 'Site visit done. You can now create the quotation.');
        }
        if (b.dataset.a === 'reject') return rejectInquiry(i);
        if (b.dataset.a === 'quote') startQuoteFromInquiry(i);
    });

    /* Inquiry Details: same fields and order as the customer's inquiry form */
    function openInquiry(i) {
        const f = (l, v, full) => '<div' + (full ? ' class="mc-full"' : '') + '><label>' + l + '</label><b>' + esc(v || '\u2014') + '</b></div>';
        let h = f('FULL NAME', i.name) + f('EMAIL / CONTACT NUMBER', [i.email, i.phone].filter(Boolean).join(' / ')) +
            (i.contact ? f('CONTACT PERSON', i.contact.name + (i.contact.role ? ' (' + i.contact.role + ')' : '')) + f('CONTACT PERSON EMAIL / NUMBER', [i.contact.email, i.contact.phone].filter(Boolean).join(' / ')) : '') +
            f('ADDRESS', i.address, true) + (i.landmark ? f('LANDMARK', i.landmark, true) : '') + f('TYPE OF PLACE', i.placeType) + f('INQUIRING ABOUT', i.purchase) +
            f('WOULD YOU LIKE A SITE VISIT?', i.siteVisit ? 'Yes' : 'No', true);
        if (i.siteVisit) {
            h += f('PREFERRED DATE', i.pref ? fmtDate(i.pref.date) : '') + f('TIME SLOT', i.pref ? i.pref.time : '');
            if (i.status !== 'Rejected' && !i.visitDone && i.status !== 'Accepted') h += '<div class="mc-full"><button type="button" class="mc-btn sm" data-m="chsched">' + (i.visitId ? 'Change schedule' : 'Book site visit') + '</button></div>';
            else if (i.visitDone) h += f('SITE VISIT', 'Done', true);
        }
        const sel = i.selections || [];
        [['product', 'PRODUCT SELECTION'], ['service', 'SERVICE SELECTION']].forEach(k => {
            const list = sel.filter(s => s.kind === k[0]);
            if (list.length) h += '<div class="mc-full"><label>' + k[1] + '</label>' + list.map(s => '<div class="inq-sel"><div><b>' + s.qty + ' \u00D7 ' + esc(s.name) + '</b><small>' + esc(s.desc || '') + '</small></div><span>' + peso(s.price) + '</span></div>').join('') + '</div>';
        });
        if (i.budget) h += f('BUDGET RANGE', i.budget, true);
        h += f('ADD MORE INQUIRY', i.addMore || 'No', true);
        if (i.rejection) h += f('REJECTED', i.rejection.reason + ' \u2022 ' + fmtDate(i.rejection.date), true);
        openModal('<button class="mc-x" data-close aria-label="Close">&times;</button><h2>Inquiry Details</h2><p class="mc-sub">' + i.id + ' \u2022 ' + fmtDate(i.submitted) + '</p><div class="mc-grid">' + h + '</div>',
            e => { if (e.target.closest('[data-m="chsched"]')) changeInquirySchedule(i); });
    }
    function inquiryBooking(i) {
        return DB.bookings.find(b => b.type === 'Site Visit' && b.inqDbId === i.dbId);
    }
    function changeInquirySchedule(i) {
        const bk = inquiryBooking(i); let sel = { date: i.pref ? i.pref.date : '', time: i.pref ? i.pref.time : '' };
        const h = openModal('<button class="mc-x" data-close aria-label="Close">&times;</button><h2>Change Schedule</h2><p class="mc-sub">' + esc(i.name) + ' \u2022 Site visit' + (i.pref ? ' \u2022 currently ' + fmtDate(i.pref.date) + ', ' + i.pref.time : '') + '</p><div id="inqCal"></div>' +
            '<label style="margin-top:18px">REASON FOR CHANGE (OPTIONAL)</label><textarea id="inqReason" placeholder="e.g. Crew unavailable on the requested date"></textarea>' +
            '<label class="mc-check"><input type="checkbox" id="inqNotify" checked> Notify the customer about this change</label>' +
            '<div class="mc-actions"><button class="mc-btn" data-m="back">Back</button><button class="mc-btn pri" data-m="save">Save Changes</button></div>',
            e => {
                const m = e.target.closest('[data-m]'); if (!m) return;
                if (m.dataset.m === 'back') return openInquiry(i);
                if (!sel.date || !sel.time) return toast('Choose a date and a time slot');
                const notify = $('#inqNotify').checked, id = i.dbId;
                act(() => api('/admin/inquiries/' + id + '/site-visit/schedule', { body: { date: sel.date, slot: sel.time, notify, reason: $('#inqReason').value.trim() } }),
                    'Site visit set for ' + fmtDate(sel.date) + ', ' + sel.time + (notify ? '. Customer notified.' : ''))
                    .then(ok => { if (!ok) return; schedDate = sel.date; const again = DB.inquiries.find(x => x.dbId === id); if (again) openInquiry(again); });
            });
        Picker($('#inqCal', h), { date: sel.date, time: sel.time, exclude: bk && bk.id, times: true, onChange: (d, t) => { sel = { date: d, time: t }; } });
    }
    function rejectInquiry(i) {
        openModal('<button class="mc-x" data-close aria-label="Close">&times;</button><h2>Reject Inquiry</h2><p class="mc-sub">' + esc(i.name) + ' \u2022 ' + i.id + '</p>' +
            '<div class="mc-form"><div class="full"><label>ADDRESS ON THE INQUIRY</label><b style="font-size:14px">' + esc(i.address || '\u2014') + '</b></div>' +
            '<div class="full"><label for="rjReason">REASON</label><select class="mc-in" id="rjReason"><option>' + NCR_REASON + '</option></select></div>' +
            '<div class="full"><label for="rjMsg">MESSAGE TO THE CUSTOMER</label><textarea class="mc-in" id="rjMsg" maxlength="400">Thank you for your interest in Beyond Wires. We currently serve mainland Luzon only, so we are unable to take on a project at your location.</textarea></div></div>' +
            '<div class="mc-actions"><button class="mc-btn" data-close>Cancel</button><button class="mc-btn danger" data-m="reject">Reject inquiry</button></div>',
            e => {
                if (!e.target.closest('[data-m="reject"]')) return;
                /* the server frees any site visit that was booked for this inquiry and notifies the customer */
                const body = { reason: $('#rjReason').value, note: $('#rjMsg').value.trim() };
                closeModal();
                act(() => api('/admin/inquiries/' + i.dbId + '/reject', { body }), 'Inquiry from ' + i.name + ' rejected: outside service area');
            });
    }

    /* =========================================================
       PDF helpers (quotation, receipt, certificate)
    ========================================================= */
    function makePDF(html, filename, w, h, asBlob) {
        asBlob = asBlob === true;   // older calls pass a page selector here; only true means "return the file"
        if (!window.html2pdf) return asBlob ? Promise.reject(new Error('The PDF tool did not load. Check your internet connection and reload the page.')) : printHTML(html);   // fallback: browser "Save as PDF"
        /* The document is kept off-screen inside a holder. The PDF tool copies only "wrap" (which has no
           off-screen position of its own), so the copy is drawn on-page and the PDF is not blank. */
        const holder = document.createElement('div'), wrap = document.createElement('div');
        holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + w + 'px';
        wrap.className = 'qd-pdf'; wrap.style.width = w + 'px'; wrap.innerHTML = html;
        holder.appendChild(wrap); document.body.appendChild(holder);
        toast('Preparing PDF...');
        const job = html2pdf().set({ margin: 0, filename, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: true, scrollX: 0, scrollY: 0 },
            jsPDF: { unit: 'px', format: [w, h], orientation: w > h ? 'landscape' : 'portrait', hotfixes: ['px_scaling'] }, pagebreak: { mode: ['legacy'] } })   // every page is exactly one PDF page tall, so no extra breaks are needed (they caused empty pages)
            .from(wrap);
        if (asBlob) return job.outputPdf('blob').then(b => { holder.remove(); return b; }, err => { holder.remove(); throw err; });
        job.save().then(() => holder.remove()).catch(() => { holder.remove(); toast('Could not build the PDF directly. Use "Save as PDF" in the print window.'); printHTML(html); });
    }
    function printHTML(html) {
        const host = document.createElement('div'); host.id = 'printHost'; host.innerHTML = html;
        document.body.appendChild(host); document.body.classList.add('print-doc');
        window.print();
        setTimeout(() => { host.remove(); document.body.classList.remove('print-doc'); }, 500);
    }

    /* =========================================================
       Quotation document (A4 template)
    ========================================================= */
    function quoteDocHTML(q) {
        const t = calc(q), cr = q.crew || [];
        const cat = id => DB.catalog.find(c => c.id === id) || {};
        const inq = DB.inquiries.find(i => i.id === q.inqId);
        const address = q.address || (inq && inq.address) || '\u2014';
        const pkg = q.items.find(i => cat(i.id).type === 'package');
        const project = q.project || (pkg ? pkg.name : (q.placeType ? q.placeType + ' Security System Installation' : 'Security System Installation'));
        const rows = [];
        q.items.forEach(i => rows.push({ qty: i.qty + (i.qty > 1 ? ' pcs' : ' pc'), name: i.name, desc: cat(i.id).desc || cat(i.id).cat || '', unit: i.price, amt: i.qty * i.price }));
        /* extra expenses appear as ONE line; the itemized list stays internal */
        if (t.exp > 0) rows.push({ qty: '1 lot', name: 'Extra expenses', desc: '', unit: t.exp, amt: t.exp });
        cr.forEach(w => rows.push({ qty: w.count + ' pax', name: 'Labor: ' + w.role, desc: w.days + ' day(s) @ ' + peso(w.rate) + ' per day', unit: w.days * w.rate, amt: crewCost(w) }));
        const rowHTML = r => '<tr><td class="c">' + esc(r.qty) + '</td><td><b>' + esc(r.name) + '</b></td><td class="d">' + esc(r.desc) + '</td><td class="r">' + peso(r.unit) + '</td><td class="r">' + peso(r.amt) + '</td></tr>';
        const table = list => '<table class="qd-tbl"><thead><tr><th>QTY</th><th>PRODUCT / SERVICE</th><th>DESCRIPTION</th><th class="r">UNIT PRICE</th><th class="r">AMOUNT</th></tr></thead><tbody>' +
            (list.map(rowHTML).join('') || '<tr><td colspan="5" class="c">No items added yet.</td></tr>') + '</tbody></table>';

        const head = '<div class="qd-lh"><div class="wm">Beyond<span>wires</span></div><div class="sub">SECURITY SYSTEM SERVICES</div>' +
            '<p>Rosal St., Tala, Caloocan City | beyondwires.info@gmail.com | +63945-329-6845<br>DTI-BRN: 6145128 | NON-VAT TIN: 421-649-525</p></div>' +
            '<div class="qd-top"><span>' + fmtDate(q.date) + '</span><span>Quotation No. <b>' + esc(q.id) + '</b></span></div>' +
            '<p class="qd-intro"><b>Dear Ma\'am/Sir,</b><br>Thank you for your interest in doing business with BEYONDWIRES SECURITY SYSTEM SERVICES. Below are the items and overall price we curated for you.</p>' +
            '<div class="qd-info"><div><span>Customer Name</span><b>' + esc(q.customer) + '</b></div><div><span>Address</span><b>' + esc(address) + '</b></div>' +
            '<div><span>Project</span><b>' + esc(project) + '</b></div>' + (q.scope ? '<div><span>Scope of work</span><em>' + esc(q.scope) + '</em></div>' : '') + '</div>';
        const cont = '<div class="qd-lh slim"><div class="wm">Beyond<span>wires</span></div><span>Quotation ' + esc(q.id) + ' (continued)</span></div>';

        const notes = ['Prices are based on the items listed above. Changes in scope will be quoted separately.']
            .concat(q.noLabor ? ['No labor fee is included in this quotation.'] : [])
            .concat((q.notes || '').split('\n').map(s => s.trim()).filter(Boolean));
        const closing = '<div class="qd-totals"><div><span>Subtotal</span><b>' + peso(t.sub + t.exp + t.lab) + '</b></div>' +
            '<div><span>VAT (' + Math.round(VAT_RATE * 100) + '%)</span><b>' + peso(t.vat) + '</b></div><div class="g"><span>TOTAL PROJECT COST</span><b>' + peso(t.total) + '</b></div></div>' +
            '<div class="qd-meta"><div><span>Project Duration</span>' + esc(q.duration || 'To be confirmed after site assessment') + '</div>' +
            '<div><span>Terms of Payment</span>' + PAY_TERMS + '</div>' +
            '<div><span>Validity</span>30 days from the date issued</div></div>' +
            '<ul class="qd-notes">' + notes.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul>' +
            '<div class="qd-sign2"><div><small>Project In-charge:</small><u>' + esc(q.incharge || '') + '</u><span>BeyondWires Representative</span></div>' +
            '<div><small>Conform\u00E9:</small><u></u><span>' + esc(q.customer) + ' Representative</span></div></div>';

        const pages = []; let rest = rows.slice(), first = true;
        for (;;) {
            const withClose = first ? 7 : 13, noClose = first ? 14 : 21;
            if (rest.length <= withClose) { pages.push((first ? head : cont) + table(rest) + closing); break; }
            const n = Math.min(noClose, rest.length - 1);
            pages.push((first ? head : cont) + table(rest.slice(0, n))); rest = rest.slice(n); first = false;
        }
        return pages.map((p, i) => '<div class="qd-page qd-q">' + p + '<div class="qd-foot">Page ' + (i + 1) + ' of ' + pages.length + '</div></div>').join('');
    }
    const downloadPDF = q => makePDF(quoteDocHTML(q), q.id + '.pdf', 794, 1123, '.qd-page');

    /* =========================================================
       Quotation builder (shared by Inquiries + Quotation tabs)
    ========================================================= */
    let B = null;
    function startQuoteFromInquiry(i) {
        const q = { id: 'New quotation', dbId: 0, inqDbId: i.dbId, inqId: i.id, customer: i.name, email: i.email, placeType: i.placeType, purchase: i.purchase, date: TODAY, status: 'Draft', expenses: [], crew: [], noLabor: false, scope: scopeFor(i.purchase), address: i.address, items: [], log: [] };
        openBuilder(q, 'inq', true);
    }
    function openBuilder(q, origin, isNew) {
        const host = origin === 'inq' ? $('#inqBuilder') : $('#qBuilder');
        B = { q: JSON.parse(JSON.stringify(q)), origin, host, isNew, type: 'all', cat: 'All', sup: 'all', search: '', step: 'build' };
        B.q.noVat = false;   // the server adds VAT whenever a quotation is saved
        if (B.q.expenses) B.q.expenses.forEach(x => { x.amount = Math.round(+x.amount || 0); });   // extra expenses are whole pesos
        if (origin === 'inq') pane('inquiries', 'inqBuilder'); else pane('quotations', 'qBuilder');
        renderBuilder();
    }
    function builderBar() {
        const q = B.q;
        return '<div class="section-card b-bar"><button class="btn-outline" data-b="cancel"><i class="fa-solid fa-arrow-left"></i> ' + (B.origin === 'inq' ? 'Back to Inquiries' : 'Back to Quotations') + '</button>' +
            '<div class="b-cust"><div class="avatar" style="background:' + avColor(q.customer) + '">' + ini(q.customer) + '</div><div><small>CUSTOMER</small><b>' + esc(q.customer) + '</b></div></div>' +
            '<div><small>INQUIRY</small><b>' + esc(q.inqId || '\u2014') + '</b></div><div><small>QUOTATION NO.</small><b>' + esc(q.id) + '</b></div></div>';
    }
    function renderBuilder() {
        const q = B.q;
        if (B.step === 'build') {
            B.host.innerHTML = builderBar() + '<div class="b-layout"><div class="b-left"><div class="b-tools"><div class="search-box"><i class="fa-solid fa-magnifying-glass"></i><input type="search" id="bSearch" placeholder="Search products, services or packages..." value="' + esc(B.search) + '"></div>' +
                '<select id="bSup" class="tool-select b-sup-sel" aria-label="Supplier" title="Choose a supplier to see only the items they offer"></select>' +
                '<div class="seg" id="bType">' + [['all', 'All'], ['product', 'Products'], ['service', 'Services'], ['package', 'Packages']].map(s => '<button type="button" data-b="type" data-v="' + s[0] + '">' + s[1] + '</button>').join('') + '</div></div>' +
                '<div class="cat-nav" id="bCats"></div><div class="b-grid" id="bGrid"></div></div>' +
                '<div class="b-right section-card">' + requestedHtml() + '<span class="card-label-top">QUOTATION ITEMS</span><div id="bCart"></div>' +
                costEditors() + '<div class="b-totals" id="bTotals"></div>' +
                '<button class="btn-primary full-width" data-b="preview">Preview Quotation</button></div></div>';
            renderTypeNav(); renderCats(); renderGrid(); renderCart(); renderExpenses(); renderCrew();
        } else {
            B.host.innerHTML = builderBar() + '<div class="b-layout"><div class="qd-wrap"><div class="qd-scale">' + quoteDocHTML(q) + '</div></div>' +
                '<div class="b-right section-card"><span class="card-label-top">EDIT QUOTATION</span><label class="card-label-top" style="margin-bottom:6px">SCOPE OF WORK</label>' +
                '<textarea data-pf="scope">' + esc(q.scope) + '</textarea><label class="card-label-top">LINE ITEMS (QTY / UNIT PRICE)</label>' +
                q.items.map(i => '<div class="b-edit" data-id="' + i.id + '"><b>' + esc(i.name) + '</b><div class="two"><input type="number" min="1" step="1" data-pf="qty" value="' + i.qty + '" aria-label="Quantity"><input type="number" min="0.01" max="' + PRICE_MAX + '" step="0.01" data-pf="price" value="' + i.price + '" aria-label="Unit price"></div></div>').join('') +
                costEditors() + '<div class="b-totals" id="pTotals"></div>' +
                '<button class="btn-primary full-width" data-b="pdf"><i class="fa-solid fa-file-pdf"></i> Download PDF</button>' +
                '<button class="btn-primary full-width" data-b="save">' + (B.isNew ? 'Save Draft' : 'Save Changes') + '</button>' +
                (q.status === 'Draft' ? '<button class="btn-primary full-width" data-b="send">Send to Superadmin</button>' : '') +
                '<button class="btn-outline full-width" data-b="edit">Back to Builder</button></div></div>';
            renderExpenses(); renderCrew(); renderTotals('#pTotals');
        }
    }
    /* what the customer asked for in the inquiry, so the admin does not have to go back to it */
    function requestedHtml() {
        const i = DB.inquiries.find(x => x.id === B.q.inqId); if (!i) return '';
        const sel = i.selections || [], note = t => '<p class="empty-note small" style="text-align:left;padding:0 0 8px">' + t + '</p>';
        return '<div class="b-sec"><div class="b-sec-head"><span class="card-label-top">REQUESTED BY THE CUSTOMER</span>' +
            (sel.length ? '<button type="button" class="btn-xs" data-b="addReq"><i class="fa-solid fa-plus"></i> Add requested items</button>' : '') + '</div>' +
            (sel.map(s => '<div class="b-ci"><div>' + esc(s.name) + '</div><b>' + s.qty + ' \u00D7</b></div>').join('') || note(i.siteVisit ? 'Site visit requested: the items are decided after the visit.' : 'No items listed.')) +
            (i.budget ? note('Budget: ' + esc(i.budget)) : '') + '</div>';
    }
    function renderTypeNav() { $$('#bType button').forEach(b => b.classList.toggle('on', b.dataset.v === B.type)); }
    function renderCats() {
        const el = $('#bCats'); if (!el) return;
        el.style.display = B.type === 'product' ? '' : 'none';
        const sel = $('#bSup'); if (sel) sel.innerHTML = supOptions(catalog(), B.sup, 'All suppliers');
        const cats = catList(false, 'product', B.sup); if (B.cat !== 'All' && !cats.includes(B.cat)) B.cat = 'All';
        el.innerHTML = ['All'].concat(cats).map(c => '<button type="button" data-b="cat" data-v="' + c + '" class="' + (B.cat === c ? 'on' : '') + '">' + (c === 'All' ? 'All Products' : c) + '</button>').join('');
    }
    function renderGrid() {
        const s = B.search.trim().toLowerCase();
        const items = catalog().filter(c => c.price > 0 && (B.type === 'all' || c.type === B.type) && (B.type !== 'product' || B.cat === 'All' || c.cat === B.cat) && supMatch(c, B.sup) &&
            (!s || (c.name + ' ' + (c.cat || '') + ' ' + (c.desc || '')).toLowerCase().includes(s)));
        $('#bGrid').innerHTML = items.map(c => {
            const it = B.q.items.find(i => i.id === c.id);
            return '<div class="b-card' + (it ? ' in' : '') + '"><div class="ic"><i class="fa-solid ' + c.icon + '"></i></div><h3>' + esc(c.name) + '</h3><small>' + esc(c.desc || c.cat) + '</small>' +
                (B.sup === 'all' ? '<small class="b-supname" style="display:block;margin-top:4px;opacity:.75"><i class="fa-solid fa-truck-field"></i> ' + esc(c.supplier || NO_SUP_LABEL) + '</small>' : '') +
                '<div class="row"><b>' + peso(c.price) + '</b><div class="stepper"><button type="button" data-b="dec" data-id="' + c.id + '" aria-label="Decrease">&minus;</button><span>' + (it ? it.qty : 0) + '</span><button type="button" data-b="inc" data-id="' + c.id + '" aria-label="Increase">+</button></div></div></div>';
        }).join('') || '<div class="empty-note" style="grid-column:1/-1">' + (B.sup !== 'all' ? 'This supplier has nothing that matches. Try another type or supplier.' : 'Nothing matches your search.') + '</div>';
    }
    function renderCart() {
        $('#bCart').innerHTML = B.q.items.map(i => '<div class="b-ci"><div>' + esc(i.name) + '<small>' + i.qty + ' \u00D7 ' + peso(i.price) + '</small></div><div style="display:flex;align-items:center;gap:10px"><b>' + peso(i.qty * i.price) + '</b><button type="button" class="rm" data-b="rm" data-id="' + i.id + '" aria-label="Remove">&times;</button></div></div>').join('') || '<p class="empty-note">No items yet. Add products, services or packages.</p>';
        renderTotals('#bTotals');
    }
    function renderTotals(sel) {
        const t = calc(B.q);
        $(sel).innerHTML = '<div><span>Subtotal (items)</span><span>' + peso(t.sub) + '</span></div><div><span>Extra expenses</span><span>' + peso(t.exp) + '</span></div><div><span>Labor cost</span><span>' + peso(t.lab) + '</span></div><div><span>VAT (' + Math.round(VAT_RATE * 100) + '%)</span><span>' + peso(t.vat) + '</span></div><div class="g"><span>Total Cost</span><b>' + peso(t.total) + '</b></div>';
    }
    function bUpdate() {
        if (B.step === 'build') renderTotals('#bTotals');
        else { $('.qd-scale', B.host).innerHTML = quoteDocHTML(B.q); renderTotals('#pTotals'); }
    }
    /* Duration: preset days, or "Other" with a whole number of days (1 to DURATION_MAX) */
    function durationField(q) {
        const m = /^(\d+)\s*days?$/i.exec(String(q.duration || '').trim()), n = m ? +m[1] : 0;
        const preset = n && DURATIONS.includes(n), other = !!q.duration && !preset;
        return '<div class="b-dur"><select id="bDurSel" class="b-select" aria-label="Project duration"><option value=""' + (!q.duration ? ' selected' : '') + ' disabled>Project duration</option>' +
            DURATIONS.map(d => '<option value="' + d + '"' + (preset && d === n ? ' selected' : '') + '>' + daysLabel(d) + '</option>').join('') +
            '<option value="other"' + (other ? ' selected' : '') + '>Other</option></select>' +
            '<input type="text" id="bDurNum" inputmode="numeric" maxlength="2" placeholder="Days" title="Whole number of days, 1 to ' + DURATION_MAX + '" aria-label="Number of days" value="' + (other && n ? n : '') + '"' + (other ? '' : ' hidden') + '></div>';
    }
    const detailEditors = () => { const q = B.q, inq = DB.inquiries.find(i => i.id === q.inqId), v = x => esc(x || '');
        return '<div class="b-sec"><div class="b-sec-head"><span class="card-label-top">QUOTATION DETAILS</span></div><div class="b-exp">' +
            '<div class="two b-two-eq"><input type="text" data-qf="project" maxlength="100" placeholder="Project title" value="' + v(q.project) + '" aria-label="Project title">' + durationField(q) + '</div>' +
            '<div class="two"><input type="text" data-qf="address" maxlength="140" placeholder="Site address" value="' + v(q.address || (inq && inq.address)) + '" aria-label="Site address"><input type="text" data-qf="incharge" maxlength="60" placeholder="Project in-charge" value="' + v(q.incharge) + '" aria-label="Project in-charge"></div>' +
            '<textarea data-qf="notes" maxlength="400" rows="3" placeholder="Extra notes shown on the quotation, one per line">' + v(q.notes) + '</textarea></div></div>'; };
    const costEditors = () => detailEditors() +
        '<div class="b-sec"><div class="b-sec-head"><span class="card-label-top">EXTRA EXPENSES</span><button type="button" class="btn-xs" data-b="addExp"><i class="fa-solid fa-plus"></i> Add expense</button></div>' +
        '<p class="empty-note small" style="text-align:left;padding:0 0 8px">Names are for your reference. The quotation shows one "Extra expenses" line with the total.</p><div id="bExp"></div></div>' +
        '<div class="b-sec"><div class="b-sec-head"><span class="card-label-top">ASSIGNED WORKERS (LABOR)</span><button type="button" class="btn-xs" data-b="addCrew"><i class="fa-solid fa-plus"></i> Add worker</button></div>' +
        '<label class="b-nolabor"><input type="checkbox" id="bNoLabor"> No labor needed (no labor fee)</label>' +
        '<p class="empty-note small" style="text-align:left;padding:0 0 8px">Work days are limited to ' + CREW_DAYS_MAX + ' per worker line.</p><div id="bCrew"></div></div>';
    function renderExpenses() {
        const el = $('#bExp'); if (!el) return;
        el.innerHTML = B.q.expenses.map(x => '<div class="b-exp" data-xid="' + x.id + '"><div class="b-row-end"><input type="text" data-ex="label" maxlength="60" placeholder="Expense (e.g. Transport)" value="' + esc(x.label) + '" aria-label="Expense name">' +
            '<input type="text" inputmode="numeric" maxlength="7" data-ex="amount" placeholder="Amount (\u20B1)" value="' + (x.amount ? Math.round(x.amount) : '') + '" aria-label="Amount in whole pesos" style="max-width:130px">' +
            '<button type="button" class="rm" data-b="rmExp" data-id="' + x.id + '" aria-label="Remove expense">&times;</button></div></div>').join('') ||
            '<p class="empty-note small">No extra expenses yet. Add transport, permits, extra materials and so on.</p>';
    }
    function renderCrew() {
        const el = $('#bCrew'); if (!el) return;
        const nl = $('#bNoLabor'); if (nl) nl.checked = !!B.q.noLabor;
        const ab = $('[data-b="addCrew"]'); if (ab) ab.disabled = !!B.q.noLabor;
        if (B.q.noLabor) { el.innerHTML = '<p class="empty-note small">No labor fee. This quotation covers products and extra expenses only.</p>'; return; }
        el.innerHTML = B.q.crew.map(c => '<div class="b-crew" data-cid="' + c.id + '"><select data-cw="role" aria-label="Role">' + Object.keys(LABOR_RATES).map(r => '<option' + (r === c.role ? ' selected' : '') + '>' + r + '</option>').join('') + '</select>' +
            '<div class="two"><label>WORKERS<input type="number" min="1" max="' + CREW_COUNT_MAX + '" step="1" data-cw="count" value="' + c.count + '"></label><label>DAYS (MAX ' + CREW_DAYS_MAX + ')<input type="number" min="1" max="' + CREW_DAYS_MAX + '" step="1" data-cw="days" value="' + c.days + '"></label></div>' +
            '<div class="b-row-end"><small class="cw-rate">' + peso(c.rate) + ' per day each</small><b class="cw-cost">' + peso(crewCost(c)) + '</b><button type="button" class="rm" data-b="rmCrew" data-id="' + c.id + '" aria-label="Remove worker">&times;</button></div></div>').join('') ||
            '<p class="empty-note small">No workers assigned yet. Add a worker, or tick "No labor needed" if the job requires none.</p>';
    }
    function setQty(id, qty) {
        const c = DB.catalog.find(x => x.id === id);
        if (qty <= 0) B.q.items = B.q.items.filter(i => i.id !== id);
        else { const it = B.q.items.find(i => i.id === id); if (it) it.qty = qty; else B.q.items.push({ id, name: c.name, qty, price: c.price }); }
        renderGrid(); renderCart();
    }
    function quoteIssue(q) {
        if (q.items.some(i => !(i.price > 0) || i.price > PRICE_MAX)) return 'Every line item needs a price above zero and no more than ' + peso(PRICE_MAX);
        if (q.expenses.reduce((s, x) => s + (+x.amount || 0), 0) > EXPENSE_MAX) return 'Extra expenses cannot exceed ' + peso(EXPENSE_MAX) + ' in total';
        if (q.expenses.some(x => +x.amount > 0 && !(x.label || '').trim())) return 'Give every extra expense a name';
        if (!q.noLabor && !q.crew.length) return 'Assign at least one worker, or tick "No labor needed"';
        { const m = /^(\d+) days?$/.exec(q.duration || ''); if (!m || +m[1] < 1 || +m[1] > DURATION_MAX) return 'Choose the project duration. For "Other", enter a whole number of days from 1 to ' + DURATION_MAX; }
        if (q.crew.some(c => !(c.days >= 1) || c.days > CREW_DAYS_MAX)) return 'Work days must be between 1 and ' + CREW_DAYS_MAX;
        return '';
    }
    function commitQuote(status) {
        if (!B.q.items.length) return toast('Add at least one item first');
        const issue = quoteIssue(B.q); if (issue) return toast(issue);
        const q = B.q, wasNew = B.isNew;
        const body = {
            items: q.items.map(i => ({ product_id: +i.id, quantity: i.qty, unit_price: i.price })),
            charges: q.expenses.filter(x => (x.label || '').trim() || +x.amount).map(x => ({ label: (x.label || '').trim(), amount: +x.amount || 0 })),
            labor: q.noLabor ? [] : q.crew.map(c => ({ role: c.role, workers: c.count, days: c.days })), no_labor: !!q.noLabor,
            scope_of_work: q.scope, project_title: q.project, duration: q.duration, site_address: q.address, project_incharge: q.incharge, payment_terms: PAY_TERMS, notes: q.notes
        };
        const send = status === 'Pending Superadmin';
        act(async () => {
            if (wasNew) await api('/admin/quotations', { body: Object.assign({ inquiry_id: q.inqDbId, submit: send }, body) });
            else {
                await api('/admin/quotations/' + q.dbId, { method: 'PUT', body: Object.assign({ revision_note: 'Edited by admin' }, body) });
                if (send && (q.status === 'Draft' || q.status === 'Revision Requested')) await api('/admin/quotations/' + q.dbId + '/submit', { body: {} });
            }
        }).then(ok => {
            if (!ok) return;
            B = null;
            $('#qStatusFilter').value = 'all'; $('#qSearch').value = '';
            pane('inquiries', 'inqList'); pane('quotations', 'qList');
            toast((wasNew ? 'Quotation' : q.id) + (send ? ' sent to superadmin' : ' saved as draft') + '. Find it under Quotation.');
            showTab('quotations');
        });
    }
    function leaveBuilder() {
        const origin = B.origin; B = null;
        if (origin === 'inq') pane('inquiries', 'inqList'); else pane('quotations', 'qList');
    }
    document.addEventListener('click', e => {
        const b = e.target.closest('[data-b]'); if (!b || !B) return;
        switch (b.dataset.b) {
            case 'cancel': if (!B.q.items.length || confirm('Leave without saving this quotation?')) leaveBuilder(); break;
            case 'type': B.type = b.dataset.v; B.cat = 'All'; renderTypeNav(); renderCats(); renderGrid(); break;
            case 'cat': B.cat = b.dataset.v; renderCats(); renderGrid(); break;
            case 'inc': case 'dec': { const it = B.q.items.find(i => i.id === b.dataset.id); setQty(b.dataset.id, (it ? it.qty : 0) + (b.dataset.b === 'inc' ? 1 : -1)); break; }
            case 'rm': setQty(b.dataset.id, 0); break;
            case 'addReq': { const i = DB.inquiries.find(x => x.id === B.q.inqId); let skipped = 0;
                (i ? i.selections : []).forEach(s => { const c = catalog().find(x => x.id === s.id); if (!c) return skipped++; if (!(c.price > 0)) return; /* free items (Ocular) are not quoted */ if (!B.q.items.some(x => x.id === s.id)) B.q.items.push({ id: s.id, name: c.name, qty: s.qty, price: c.price }); });
                renderGrid(); renderCart(); if (skipped) toast(skipped + ' requested item(s) are no longer offered and were skipped'); break; }
            case 'addExp': B.q.expenses.push({ id: uid('x'), label: '', amount: 0 }); renderExpenses(); bUpdate(); { const f = $('#bExp .b-exp:last-child input'); if (f) f.focus(); } break;
            case 'rmExp': B.q.expenses = B.q.expenses.filter(x => x.id !== b.dataset.id); renderExpenses(); bUpdate(); break;
            case 'addCrew': { if (B.q.noLabor) return; const last = B.q.crew[B.q.crew.length - 1]; B.q.crew.push({ id: uid('w'), role: 'Helper', count: 1, days: last ? last.days : 1, rate: LABOR_RATES['Helper'] }); renderCrew(); bUpdate(); break; }
            case 'rmCrew': B.q.crew = B.q.crew.filter(c => c.id !== b.dataset.id); renderCrew(); bUpdate(); break;
            case 'preview': if (!B.q.items.length) return toast('Add at least one item first'); { const issue = quoteIssue(B.q); if (issue) return toast(issue); } B.step = 'preview'; renderBuilder(); window.scrollTo(0, 0); break;
            case 'edit': B.step = 'build'; renderBuilder(); break;
            case 'pdf': downloadPDF(B.q); break;
            case 'save': commitQuote(null); break;
            case 'send': commitQuote('Pending Superadmin'); break;
        }
    });
    /* leaving an expense amount shows the whole-peso value that is used (e.g. 850.75 -> 850) */
    document.addEventListener('focusout', e => {
        const t = e.target; if (!B || !t.dataset || t.dataset.ex !== 'amount') return;
        const x = B.q.expenses.find(y => y.id === t.closest('.b-exp').dataset.xid);
        if (x) t.value = x.amount ? String(x.amount) : '';
    });
    document.addEventListener('input', e => {
        if (!B) return;
        const t = e.target;
        if (t.id === 'bSearch') { B.search = t.value; return renderGrid(); }
        if (t.id === 'bSup') { B.sup = t.value; renderCats(); return renderGrid(); }
        if (t.id === 'bDurSel') {
            const num = $('#bDurNum'), other = t.value === 'other';
            num.hidden = !other;
            if (other) { num.focus(); const n = +num.value; B.q.duration = n >= 1 && n <= DURATION_MAX ? daysLabel(n) : ''; }
            else B.q.duration = daysLabel(+t.value);
            return bUpdate();
        }
        if (t.id === 'bDurNum') {
            const digits = t.value.replace(/\D/g, '').replace(/^0+/, '');     // numbers only
            if (digits !== t.value) t.value = digits;
            let n = +digits;
            if (n > DURATION_MAX) { n = DURATION_MAX; t.value = n; toast('The project duration can be up to ' + DURATION_MAX + ' days'); }
            B.q.duration = n >= 1 ? daysLabel(n) : '';
            return bUpdate();
        }
        if (t.id === 'bNoLabor') {
            if (t.checked && B.q.crew.length && !confirm('Remove the assigned workers and charge no labor?')) { t.checked = false; return; }
            B.q.noLabor = t.checked; if (t.checked) B.q.crew = [];
            renderCrew(); return bUpdate();
        }
        if (t.dataset.cw) {
            const row = t.closest('.b-crew'), c = B.q.crew.find(w => w.id === row.dataset.cid); if (!c) return;
            const f = t.dataset.cw;
            if (f === 'role') { c.role = t.value; c.rate = LABOR_RATES[t.value]; }
            else {
                if (t.value === '') return;   // let the user finish typing
                const max = f === 'days' ? CREW_DAYS_MAX : CREW_COUNT_MAX;
                let v = Math.floor(+t.value);
                if (!(v >= 1)) v = 1;
                if (v > max) { v = max; toast(f === 'days' ? 'Work days are limited to ' + CREW_DAYS_MAX + ' per worker' : 'Up to ' + CREW_COUNT_MAX + ' workers per line'); }
                if (String(v) !== t.value) t.value = v;
                c[f] = v;
            }
            row.querySelector('.cw-rate').textContent = peso(c.rate) + ' per day each';
            row.querySelector('.cw-cost').textContent = peso(crewCost(c));
            return bUpdate();
        }
        if (t.dataset.ex) {
            const x = B.q.expenses.find(y => y.id === t.closest('.b-exp').dataset.xid);
            if (x) {
                if (t.dataset.ex === 'amount') {
                    /* a text box, not a number box: the mouse wheel and arrow keys used to change the amount by 1 */
                    const parts = t.value.replace(/[^\d.]/g, '').split('.');                 // numbers only (one dot allowed while typing)
                    const clean = parts[0].replace(/^0+(?=\d)/, '') + (parts.length > 1 ? '.' + parts.slice(1).join('') : '');
                    if (clean !== t.value) t.value = clean;
                    let v = +parts[0] || 0;                                                    // whole pesos: centavos are dropped
                    const room = Math.max(0, EXPENSE_MAX - B.q.expenses.reduce((s, y) => y === x ? s : s + (+y.amount || 0), 0));
                    if (v > room) { v = room; t.value = v; toast('Extra expenses cannot exceed ' + peso(EXPENSE_MAX) + ' in total'); }
                    x.amount = v;
                } else x[t.dataset.ex] = t.value;
            }
            return bUpdate();
        }
        if (t.dataset.qf) { B.q[t.dataset.qf] = t.value; return bUpdate(); }
        if (!t.dataset.pf) return;
        const f = t.dataset.pf;
        if (f === 'scope') B.q.scope = t.value;
        else {
            const it = B.q.items.find(i => i.id === t.closest('.b-edit').dataset.id);
            if (f === 'qty') it.qty = Math.max(1, Math.floor(+t.value) || 1);
            else {
                if (t.value === '') return;
                let v = round2(+t.value || 0);
                if (v > PRICE_MAX) { v = PRICE_MAX; t.value = v; toast('Price cannot exceed ' + peso(PRICE_MAX)); }
                it.price = Math.max(0, v);
                t.classList.toggle('invalid', !(v > 0));
            }
        }
        bUpdate();
    });

    /* =========================================================
       Quotation tab (list, view, edit)
    ========================================================= */
    function renderQuoteList() {
        const s = $('#qSearch').value.trim().toLowerCase(), st = $('#qStatusFilter').value;
        const rows = DB.quotes.filter(q => (st === 'all' || q.status === st) && (!s || (q.id + ' ' + q.customer).toLowerCase().includes(s)));
        $('#qTable').innerHTML = '<table><thead><tr><th>QUOTATION</th><th>CUSTOMER</th><th>DATE</th><th>TOTAL</th><th>STATUS</th><th class="text-right">ACTIONS</th></tr></thead><tbody>' +
            (rows.map(q => {
                const editable = q.status === 'Draft' || q.status === 'Pending Superadmin' || q.status === 'Revision Requested';
                return '<tr data-id="' + q.id + '"><td><b>' + q.id + '</b><small class="cust-sub">' + q.items.length + ' item(s)</small></td><td>' + esc(q.customer) + '</td><td class="date-col">' + fmtDate(q.date) + '</td><td><b>' + peso(qTotal(q)) + '</b></td><td>' + qsPill(q.status) + '</td>' +
                    '<td class="actions-col"><button class="btn-details" data-a="view" style="margin-right:6px">View</button><button class="btn-accept" data-a="edit" style="margin-right:0"' + (editable ? '' : ' disabled title="Only drafts and quotations awaiting superadmin can be edited"') + '>Edit</button></td></tr>';
            }).join('') || '<tr><td colspan="6" class="empty-row">No quotations found.</td></tr>') + '</tbody></table>';
    }
    $('#qSearch').addEventListener('input', renderQuoteList);
    $('#qStatusFilter').addEventListener('change', renderQuoteList);
    $('#qTable').addEventListener('click', e => {
        const b = e.target.closest('button[data-a]'); if (!b || b.disabled) return;
        const q = DB.quotes.find(x => x.id === b.closest('tr').dataset.id);
        if (b.dataset.a === 'view') openQuoteView(q.id); else openBuilder(q, 'quote', false);
    });

    let viewQ = null;
    function openQuoteView(id) {
        const q = DB.quotes.find(x => x.id === id); if (!q) return; viewQ = id;
        const t = calc(q), proj = DB.projects.find(p => p.quoteDbId === q.dbId);
        const acts = [];
        if (q.status === 'Draft' || q.status === 'Pending Superadmin' || q.status === 'Revision Requested') acts.push('<button class="btn-outline full-width" data-q="edit"><i class="fa-solid fa-pen"></i> Edit Quotation</button>');
        if (q.status === 'Draft' || q.status === 'Revision Requested') acts.push('<button class="btn-primary full-width" data-q="send">Send to Superadmin</button>');
        /* the superadmin approves on the Super Admin page and the customer approves on the customer page */
        if (q.status === 'Pending Superadmin') acts.push('<p class="helper-text">Waiting for the superadmin to approve this quotation.</p>');
        if (q.status === 'Sent to Customer') acts.push('<p class="helper-text">Sent to the customer. The project is created when the customer approves it.</p>');
        if (q.status === 'Revision Requested') acts.push('<p class="helper-text">The customer asked for a new quotation. Edit it and send it to the superadmin again.</p>');
        if (q.status === 'Draft' && q.superComment) acts.push('<p class="helper-text"><b>Superadmin comment:</b> ' + esc(q.superComment) + '</p>');
        if (proj) acts.push('<button class="btn-primary full-width" data-q="proj"><i class="fa-solid fa-briefcase"></i> Open project ' + proj.id + '</button>');
        if (q.status === 'Pending Superadmin' || q.status === 'Sent to Customer') acts.push('<button class="btn-outline full-width" data-q="decline">Mark as declined</button>');
        if (q.status === 'Draft') acts.push('<button class="btn-outline full-width" data-q="delete" style="color:#f87171">Delete draft</button>');
        $('#qDetail').innerHTML = '<button class="btn-outline back-btn" data-q="back"><i class="fa-solid fa-arrow-left"></i> Back to Quotations</button><div class="b-layout"><div class="qd-wrap"><div class="qd-scale">' + quoteDocHTML(q) + '</div></div><div>' +
            '<div class="section-card"><span class="card-label-top">QUOTATION</span><h3 style="font-size:18px;margin-bottom:10px">' + q.id + '</h3>' + qsPill(q.status) +
            '<div class="sched-detail-row" style="margin-top:14px"><span>Customer</span><strong>' + esc(q.customer) + '</strong></div><div class="sched-detail-row"><span>Date</span><strong>' + fmtDate(q.date) + '</strong></div><div class="sched-detail-row"><span>Extra expenses</span><strong>' + peso(t.exp) + '</strong></div><div class="sched-detail-row"><span>Labor</span><strong>' + peso(t.lab) + '</strong></div><div class="sched-detail-row"><span>Total</span><strong class="blue-text">' + peso(t.total) + '</strong></div></div>' +
            '<div class="section-card b-right"><span class="card-label-top">ACTIONS</span><button class="btn-primary full-width" data-q="pdf"><i class="fa-solid fa-file-pdf"></i> Download PDF</button>' + acts.join('') + '</div>' +
            '<div class="section-card"><span class="card-label-top">ACTIVITY</span>' + q.log.map(l => '<div class="b-ci"><div>' + esc(l.t) + '<small>' + esc(l.d) + '</small></div></div>').join('') + '</div></div></div>';
        pane('quotations', 'qDetail');
    }
    /* Step 1 of the project: the customer approved the quotation */
    function createProject(q) {
        if (DB.projects.some(p => p.quoteId === q.id)) return null;
        const pkg = q.items.find(i => (DB.catalog.find(c => c.id === i.id) || {}).type === 'package');
        const title = q.project || (pkg ? pkg.name : (q.items[0] ? q.items[0].name + (q.items.length > 1 ? ' + ' + (q.items.length - 1) + ' more' : '') : 'New project'));
        const p = { id: nextProjectId(), quoteId: q.id, customer: q.customer, type: q.placeType || 'Residential', title, status: 'Quotation Approved', agreement: 'half', method: 'Online', paid: 0,
            proof: null, finalProof: null, receipts: [], install: null, checklist: defChecklist(), approvedOn: TODAY };
        DB.projects.unshift(p); return p;
    }
    $('#qDetail').addEventListener('click', e => {
        const b = e.target.closest('[data-q]'); if (!b) return;
        const q = DB.quotes.find(x => x.id === viewQ);
        switch (b.dataset.q) {
            case 'back': pane('quotations', 'qList'); break;
            case 'pdf': downloadPDF(q); break;
            case 'edit': openBuilder(q, 'quote', false); break;
            case 'send': act(() => api('/admin/quotations/' + q.dbId + '/submit', { body: {} }), q.id + ' sent to superadmin').then(ok => ok && openQuoteView(q.id)); break;
            case 'proj': { const p = DB.projects.find(x => x.quoteDbId === q.dbId); if (p) { showTab('projects'); openProject(p.id); } break; }
            case 'decline': if (confirm('Mark ' + q.id + ' as declined?')) act(() => api('/admin/quotations/' + q.dbId + '/decline', { body: {} }), q.id + ' marked as declined').then(ok => ok && openQuoteView(q.id)); break;
            case 'delete': if (confirm('Delete ' + q.id + '? This cannot be undone.')) act(() => api('/admin/quotations/' + q.dbId, { method: 'DELETE' }), q.id + ' deleted').then(ok => ok && pane('quotations', 'qList')); break;
        }
    });

    /* =========================================================
       Projects: automated 5-step tracking
       1 Quotation approved  2 Payment  3 Installation (Scheduled / In progress / Completed)
       4 Final payment (50/50 and pay-after-installation only)  5 Done
    ========================================================= */
    const STEPS = ['Quotation Approved', 'Payment', 'Installation', 'Final Payment', 'Done'];
    const STEP_OF = { 'Quotation Approved': 0, 'Awaiting Payment': 1, 'Payment Under Review': 1, 'Ready for Installation': 2, 'Installation Scheduled': 2, 'Installation In Progress': 2, 'Awaiting Final Payment': 3, 'Final Payment Under Review': 3, 'Done': 4 };
    const stepIdx = p => p.status === 'Done' ? 5 : (STEP_OF[p.status] != null ? STEP_OF[p.status] : 1);
    const stageName = p => p.status === 'Done' ? 'Done' : STEPS[Math.min(stepIdx(p), 3)];
    const AGREE = { half: '50% before, 50% after installation', full: 'Full payment before installation', after: 'Full payment after installation' };
    const skipped = (p, i) => (i === 3 && p.agreement === 'full') || (i === 1 && p.agreement === 'after');
    const syncInstallStatus = p => { if (p.install !== 'Completed') p.status = p.install === 'Scheduled' ? 'Installation Scheduled' : p.install === 'In progress' ? 'Installation In Progress' : 'Ready for Installation'; };
    let curProj = null, projView = 'stage', projStage = 1, projRc = null, projDoc = null;

    function stepSub(p, i) {
        const bal = balanceOf(p);
        if (i === 0) return 'Approved';
        if (i === 1) return p.agreement === 'after' ? 'Paid after installation' : p.agreement === 'half' ? '50% down payment' : 'Full payment';
        if (i === 2) return p.install || 'Not scheduled';
        if (i === 3) return p.agreement === 'full' ? 'Not required' : bal > 0 ? peso(bal) + ' due' : 'Settled';
        return p.status === 'Done' ? 'Completed' : 'Pending';
    }
    function stepState(p, i) { const idx = stepIdx(p); return i < idx ? 'completed' : i === idx ? 'active' : ''; }
    function stepper(p) {
        const idx = stepIdx(p);
        return STEPS.map((s, i) => {
            const st = stepState(p, i), sk = skipped(p, i), can = i <= Math.min(idx, 4) && !sk;
            return (i ? '<div class="step-line ' + (i <= idx ? (i < idx ? 'completed' : 'active') : '') + '"></div>' : '') +
                '<div class="step-item ' + st + (sk ? ' skipped' : '') + (i === projStage ? ' viewing' : '') + '"' + (can ? ' data-pj="stage" data-i="' + i + '" role="button" tabindex="0" title="View ' + s + '"' : '') + '>' +
                '<div class="step-icon">' + (sk ? '&ndash;' : st === 'completed' ? '<i class="fa-solid fa-check"></i>' : i + 1) + '</div><div class="step-text"><strong>' + s + '</strong><span>' + esc(stepSub(p, i)) + '</span></div></div>';
        }).join('');
    }
    function miniSteps(p) {
        const idx = stepIdx(p);
        return '<div class="ms-wrap"><div class="ms">' + STEPS.map((s, i) => '<span class="ms-dot ' + stepState(p, i) + (skipped(p, i) ? ' skipped' : '') + '" title="' + s + '"></span>' + (i < 4 ? '<span class="ms-line' + (i < idx ? ' completed' : '') + '"></span>' : '')).join('') + '</div>' +
        '<small class="ms-cap">' + (p.status === 'Done' ? 'STEP 5 OF 5 \u00B7 DONE' : 'STEP ' + (Math.min(idx, 4) + 1) + ' OF 5 \u00B7 ' + stageName(p).toUpperCase()) + '</small></div>';    }

    function renderProjects() {
        const s = $('#projSearch').value.trim().toLowerCase(), ty = $('#projType').value, st = $('#projStatus').value, ct = provinceFilter('#projCity', DB.projects);
        const rows = DB.projects.filter(p => (ty === 'all' || p.type === ty) && (st === 'all' || stageName(p) === st) && (ct === 'all' || p.province === ct) && (!s || (p.customer + ' ' + p.title + ' ' + p.id + ' ' + p.city).toLowerCase().includes(s)));
        $('#projItems').innerHTML = rows.map(p => '<div class="project-item-card' + (p.status === 'Done' ? ' done-card' : '') + '" data-id="' + p.id + '"><div class="proj-info"><h3>' + esc(p.customer) + '</h3><p>' + esc(p.title) + '</p>' +
            '<span class="proj-next' + (p.status === 'Done' ? ' muted' : '') + '">' + p.id + ' \u00B7 ' + esc(p.type) + (p.city ? ' \u00B7 ' + esc(p.city) : '') + ' \u00B7 Total ' + peso(qTotal(projQuote(p))) + '</span></div>' +
            '<div class="proj-status-side">' + miniSteps(p) + '<span class="arrow-icon"><i class="fa-solid fa-chevron-right"></i></span></div></div>').join('') || '<p class="empty-note">No projects match these filters.</p>';
    }
    ['#projSearch', '#projType', '#projStatus', '#projCity'].forEach(s => $(s).addEventListener(s === '#projSearch' ? 'input' : 'change', renderProjects));
    $('#projItems').addEventListener('click', e => { const c = e.target.closest('.project-item-card'); if (c) openProject(c.dataset.id); });

    function openProject(id) {
        const p = DB.projects.find(x => x.id === id); if (!p) return;
        curProj = id; projView = 'stage'; projStage = Math.min(stepIdx(p), 4);
        pane('projects', 'projDetail'); renderProjView();
    }
    function renderProjView() {
        const p = DB.projects.find(x => x.id === curProj); if (!p) return;
        let body;
        if (projView === 'receipt') body = viewReceipt(p, p.receipts.find(r => r.no === projRc));
        else if (projView === 'cert') body = viewCert(p);
        else if (projView === 'doc') body = viewDoc(p, projDoc);
        else {
            const bal = balanceOf(p), cp = projParts(p).inq.contact;
            body = '<div class="project-status-top-bar"><div class="proj-header-info"><span class="sub-heading">' + esc(p.customer.toUpperCase()) + ' - ' + esc(p.type.toUpperCase()) + ' \u00B7 ' + p.id + '</span><h2>' + esc(p.title) + '</h2></div>' +
                '<div class="proj-header-meta">' + (cp ? '<div><small>CONTACT PERSON</small><strong>' + esc(cp.name) + '</strong><small>' + esc(cp.phone) + '</small></div>' : '') + '<div><small>STATUS</small><strong>' + stageName(p) + '</strong></div><div><small>PAYMENT AGREEMENT</small><strong>' + AGREE[p.agreement] + '</strong></div><div><small>BALANCE</small><strong class="blue-text">' + peso(bal) + '</strong></div></div></div>' +
                '<div class="stepper-card">' + stepper(p) + '</div><div class="tracker-main-grid"><div class="tracker-left">' + stagePanel(p) + '</div><div class="tracker-right">' + sidePanel(p) + '</div></div>';
        }
        $('#projDetail').innerHTML = '<button class="btn-outline back-btn" data-pj="back"><i class="fa-solid fa-arrow-left"></i> ' + (projView === 'stage' ? 'Back to Projects' : 'Back to Project') + '</button>' + body;
    }
    function stagePanel(p) {
        switch (projStage) {
            case 0: return quotePanel(p);
            case 1: return paymentPanel(p);
            case 2: return installPanel(p);
            case 3: return finalPanel(p);
            default: return donePanel(p);
        }
    }
    const card = (label, inner) => '<div class="section-card"><span class="card-label-top">' + label + '</span>' + inner + '</div>';
    const banner = (title, text) => '<div class="returns-banner"><strong>' + title + '</strong><p>' + text + '</p></div>';

    function quotePanel(p) {
        const q = projQuote(p);
        return card('STEP 1 \u00B7 QUOTATION APPROVED', banner('APPROVED BY THE CUSTOMER', 'Quotation ' + q.id + ' was approved, so this project was created automatically.') +
            '<div class="sched-detail-row"><span>Quotation</span><strong>' + q.id + '</strong></div><div class="sched-detail-row"><span>Total</span><strong>' + peso(qTotal(q)) + '</strong></div>' +
            '<div class="action-row-buttons">' + (stepIdx(p) === 0 ? '<button class="btn-primary" data-pj="toPay"><i class="fa-solid fa-arrow-right"></i> Proceed to Payment</button>' : '') +
            '<button class="btn-outline" data-pj="quote"><i class="fa-solid fa-file-invoice"></i> View quotation</button></div>');    }
    function methodCards(p, locked) {
        return '<div class="payment-methods-grid">' + [['Online', 'QR code and screenshot upload'], ['Over the Counter', 'Admin confirms cash payment']].map(m => '<div class="method-card' + (p.method === m[0] ? ' active' : '') + '" data-pj="method" data-v="' + m[0] + '"' + (locked ? ' style="opacity:.6;cursor:not-allowed"' : '') + '><h4>' + m[0] + '</h4><p>' + m[1] + '</p></div>').join('') + '</div>';
    }
    function proofCard(p, kind) {
        const pr = kind === 'down' ? p.proof : p.finalProof, due = kind === 'down' ? dueNow(p) : balanceOf(p);
        if (pr) {
            const mismatch = Math.abs(pr.amount - due) > 0.009;
            const proofUrl = window.BW.fileUrl('/admin/payments/' + pr.paymentId + '/proof');
            return '<div class="proof-content"><a class="proof-image-box" href="' + proofUrl + '" target="_blank" rel="noopener" title="Open the uploaded proof">' +
                (pr.hasPhoto ? '<img src="' + proofUrl + '" alt="Payment proof" style="max-width:100%;max-height:160px;object-fit:contain" onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),{innerHTML:\'OPEN PROOF<br><small>PDF file</small>\'}))">' : '<span>NO FILE</span>') +
                '</a><div class="proof-details">' +
                '<div class="proof-row"><span>Reference No.</span><strong>' + esc(pr.ref) + '</strong></div><div class="proof-row"><span>Amount on proof</span><strong>' + peso(pr.amount) + '</strong></div><div class="proof-row"><span>Submitted</span><strong>' + esc(pr.submitted) + '</strong></div>' +
                '<div class="proof-row"><span>Verification</span><span class="status-warning"><span class="dot yellow"></span> ' + (mismatch ? 'Amount differs from amount due' : 'Awaiting your approval') + '</span></div>' +
                '<div class="proof-actions"><button class="btn-primary" data-pj="confirm" data-k="' + kind + '">Approve Payment</button><button class="btn-secondary" data-pj="reupload" data-k="' + kind + '">Request Re-upload</button></div></div></div>';
        }
        const pay = kind === 'down' ? p.down : p.fin;
        const rej = pay && pay.status === 'Rejected' ? '<p class="next-step-desc"><b>Re-upload requested:</b> ' + esc(pay.reject_reason || '') + '</p>' : '';
        if (p.method === 'Online') return rej + '<p class="next-step-desc">Waiting for the customer to upload a payment screenshot and reference number. You will be notified when it arrives.</p>';
        return rej + '<p class="next-step-desc" style="margin-bottom:10px">Over the counter: record the cash received. Your confirmation acts as the proof.</p><div class="form-group"><label>AMOUNT RECEIVED</label><input type="number" id="cashAmt" min="0.01" step="0.01" value="' + due + '"></div><button class="btn-primary" data-pj="cash" data-k="' + kind + '">Record Cash Payment</button>';
    }
    function paymentPanel(p) {
        const idx = stepIdx(p), t = qTotal(projQuote(p)), due = dueNow(p);
        if (idx > 1) {
            const r = p.receipts.find(x => x.kind === 'down');
            return card('STEP 2 \u00B7 PAYMENT', banner(p.agreement === 'after' ? 'NO PAYMENT BEFORE INSTALLATION' : 'PAYMENT APPROVED', p.agreement === 'after' ? 'The customer pays the full amount after installation (step 4).' : peso(r ? r.amount : due) + ' was approved' + (r ? ' on ' + fmtDate(r.date) + '. Receipt \u2116 ' + r.no + ' was issued.' : '.')) +
                (r ? '<div class="action-row-buttons"><button class="btn-outline" data-pj="rcview" data-no="' + r.no + '">View receipt \u2116 ' + r.no + '</button></div>' : ''));
        }
        const locked = p.locked;
        const note = p.agreement === 'half' ? '50% down payment \u00B7 half of ' + peso(t) : p.agreement === 'full' ? 'Full payment \u00B7 100% of ' + peso(t) : 'Nothing due now \u00B7 ' + peso(t) + ' is collected after installation';
        let proof;
        if (p.agreement === 'after') proof = '<p class="next-step-desc" style="margin-bottom:12px">No payment is due now. The full amount is collected after installation, in step 4.</p><button class="btn-primary" data-pj="start">Proceed to Installation</button>';
        else proof = proofCard(p, 'down');
        return card('STEP 2 \u00B7 AMOUNT DUE \u00B7 ' + esc(p.customer.toUpperCase()), '<div class="amount-display"><h2>' + peso(due) + '</h2><p>' + note + '</p></div>' +
                '<div class="payment-agreement-section"><span class="sub-label">PAYMENT AGREEMENT (CHOSEN BY THE CUSTOMER)</span><div class="agreement-tabs">' + [['half', '50% / 50%'], ['full', 'FULL PAYMENT'], ['after', 'FULL AFTER INSTALLATION']].map(a => '<button class="tab-btn' + (p.agreement === a[0] ? ' active' : '') + '" data-pj="agree" data-v="' + a[0] + '"' + (locked ? ' disabled style="opacity:.6;cursor:not-allowed"' : '') + '>' + a[1] + '</button>').join('') + '</div>' +
                '<p class="agreement-note">' + (locked ? 'Locked: a payment proof has already been submitted.' : '50% / 50% issues two receipts (down payment and final payment). The other options issue one. Full After Installation is for residential customers only.') + '</p></div>' +
                '<div class="financial-breakdown"><div class="breakdown-row"><span>Quotation total</span><span>' + peso(t) + '</span></div><div class="breakdown-row"><span>Paid to date</span><span>' + peso(p.paid) + '</span></div><div class="breakdown-row highlight"><span>Amount due now</span><span class="blue-text">' + peso(due) + '</span></div><div class="breakdown-row"><span>Balance after this payment</span><span>' + peso(round2(t - p.paid - due)) + '</span></div></div>') +
            (p.agreement === 'after' ? '' : card('PAYMENT METHOD', methodCards(p, locked))) +
            card('PROOF OF PAYMENT', proof);
    }
    function installPanel(p) {
        const idx = stepIdx(p);
        if (idx < 2) return card('STEP 3 \u00B7 INSTALLATION', '<p class="next-step-desc">Installation unlocks once the payment in step 2 is approved.</p>');
        const bk = bookingById(p.bookingId), cur = p.install, done = cur === 'Completed';
        const btn = (label, v, enabled) => '<button class="s-tab' + (cur === v ? ' active' : '') + '" data-pj="inst" data-v="' + v + '"' + (enabled ? '' : ' disabled') + '>' + label + '</button>';
        const tabs = '<div class="status-tabs inst-btns">' + btn('SCHEDULED', 'Scheduled', !done && cur !== 'In progress') + btn('IN PROGRESS', 'In progress', cur === 'Scheduled') + btn('COMPLETED', 'Completed', cur === 'In progress') + '</div>';
        const dn = p.checklist.filter(c => c.state === 'Done').length, pct = Math.round(dn / p.checklist.length * 100);
        const stCls = { 'Done': ['status-green', 'green'], 'In progress': ['status-yellow', 'yellow'], 'Pending': ['status-gray', 'gray'] };
        const editable = cur === 'In progress';
        const when = '<div class="sched-detail-row"><span>Installation schedule</span><strong>' + (bk ? fmtLong(bk.date) + ', ' + bk.time : 'Not scheduled yet') + '</strong></div>' +
            (p.startDate ? '<div class="sched-detail-row"><span>Started</span><strong>' + fmtDate(p.startDate) + '</strong></div>' : '') + (p.endDate ? '<div class="sched-detail-row"><span>Completed</span><strong>' + fmtDate(p.endDate) + '</strong></div>' : '');
        const hint = !cur ? banner('NEXT', 'Click SCHEDULED to book the installation date with the customer.')
            : cur === 'Scheduled' ? banner('NEXT', 'On the installation day, click IN PROGRESS. You can still click SCHEDULED to move the date.')
            : cur === 'In progress' ? banner('NEXT', 'Click a checklist row to update it. Click COMPLETED when the job is finished. ' + (p.agreement === 'full' ? 'The project then moves to Done.' : 'The final payment of ' + peso(balanceOf(p)) + ' then becomes due.'))
            : banner('INSTALLATION COMPLETED', 'Prepare the installation certificate and accomplishment report with photos, then send it to the customer.') + '<div class="action-row-buttons" style="margin-bottom:12px"><button class="btn-primary" data-pj="cert"><i class="fa-solid fa-award"></i> ' + (p.cert ? 'Open certificate' : 'Prepare certificate') + '</button></div>';
        const invBtn = done ? '' : '<div class="action-row-buttons" style="margin:10px 0 0"><button class="btn-outline" data-pj="doc" data-d="inv"><i class="fa-solid fa-clipboard-list"></i> Inventory checklist for the crew</button></div>';
        return card('STEP 3 \u00B7 INSTALLATION', tabs + when + invBtn + '<div class="progress-info-row" style="margin-top:12px"><span>Checklist progress</span><strong>' + pct + '%</strong></div><div class="progress-bar-container"><div class="progress-bar-fill" style="width:' + pct + '%"></div></div><div class="checklist-items">' +
            p.checklist.map((c, i) => '<div class="check-row"' + (editable ? ' data-pj="check" data-i="' + i + '" style="cursor:pointer"' : '') + '><span>' + esc(c.label) + '</span><span class="' + stCls[c.state][0] + '"><span class="dot ' + stCls[c.state][1] + '"></span> ' + c.state + '</span></div>').join('') + '</div>' + hint +
            (editable ? '<div class="action-row-buttons"><button class="btn-secondary" data-pj="save">Save Progress</button></div>' : ''));
    }
    function finalPanel(p) {
        const idx = stepIdx(p);
        if (p.agreement === 'full') return card('STEP 4 \u00B7 FINAL PAYMENT', banner('NOT REQUIRED', 'The customer paid in full before installation, so the project goes straight to Done once installation is completed.'));
        if (idx < 3) return card('STEP 4 \u00B7 FINAL PAYMENT', '<p class="next-step-desc">The final payment becomes due once installation is marked completed.</p>');
        if (idx > 3) {
            const r = p.receipts.find(x => x.kind === 'final');
            return card('STEP 4 \u00B7 FINAL PAYMENT', banner('FINAL PAYMENT APPROVED', (r ? peso(r.amount) + ' was approved on ' + fmtDate(r.date) + '. Receipt \u2116 ' + r.no + ' was issued.' : 'Settled.')) +
                (r ? '<div class="action-row-buttons"><button class="btn-outline" data-pj="rcview" data-no="' + r.no + '">View receipt \u2116 ' + r.no + '</button></div>' : ''));
        }
        const bal = balanceOf(p), locked = p.locked;
        return card('STEP 4 \u00B7 FINAL PAYMENT DUE \u00B7 ' + esc(p.customer.toUpperCase()), '<div class="amount-display"><h2>' + peso(bal) + '</h2><p>' + (p.agreement === 'half' ? 'Remaining 50% after installation' : 'Full payment after installation') + '</p></div>' +
                '<div class="financial-breakdown"><div class="breakdown-row"><span>Quotation total</span><span>' + peso(qTotal(projQuote(p))) + '</span></div><div class="breakdown-row"><span>Paid to date</span><span>' + peso(p.paid) + '</span></div><div class="breakdown-row highlight"><span>Final payment</span><span class="blue-text">' + peso(bal) + '</span></div></div>') +
            card('PAYMENT METHOD', methodCards(p, locked)) +
            card('PROOF OF FINAL PAYMENT', proofCard(p, 'final') + '<p class="helper-text" style="margin-top:10px">Approving this proof marks the project as Done.</p>');
    }
    function donePanel(p) {
        if (p.status !== 'Done') return card('STEP 5 \u00B7 DONE', '<p class="next-step-desc">The project is marked done automatically when ' + (p.agreement === 'full' ? 'installation is completed.' : 'the final payment proof is approved.') + '</p>');
        return card('STEP 5 \u00B7 DONE', banner('PROJECT COMPLETED', 'Installation is complete and the project is fully paid (' + peso(p.paid) + ').') +
            '<div class="sched-detail-row"><span>Installation</span><strong>' + (p.startDate ? fmtDate(p.startDate) : '\u2014') + ' to ' + (p.endDate ? fmtDate(p.endDate) : '\u2014') + '</strong></div>' +
            '<div class="sched-detail-row"><span>Receipts issued</span><strong>' + p.receipts.length + '</strong></div>' +
            '<div class="sched-detail-row"><span>Certificate</span><strong>' + (p.cert && p.cert.sent ? 'Sent ' + fmtDate(p.cert.sent) : p.cert ? 'Prepared, not sent' : 'Not prepared') + '</strong></div>' +
            '<div class="action-row-buttons"><button class="btn-primary" data-pj="cert"><i class="fa-solid fa-award"></i> ' + (p.cert ? 'Open certificate' : 'Prepare certificate') + '</button></div>');
    }
    function sidePanel(p) {
        const q = projQuote(p), t = qTotal(q), bal = balanceOf(p);
        const expected = p.agreement === 'half' ? 2 : 1;
        const rc = p.receipts.map((r, i) => '<div class="doc-row"><div><b>\u2116 ' + r.no + ' \u00B7 ' + esc(r.label) + '</b><small>Receipt ' + (i + 1) + ' of ' + expected + ' \u00B7 ' + peso(r.amount) + ' \u00B7 ' + fmtDate(r.date) + '</small>' + (r.sent ? '<span class="sent-tag"><i class="fa-solid fa-check"></i> Sent to customer ' + fmtDate(r.sent) + '</span>' : '') + '</div>' +
            '<div class="doc-acts"><button class="btn-xs" data-pj="rcview" data-no="' + r.no + '">View</button><button class="btn-xs" data-pj="rcpdf" data-no="' + r.no + '" title="Download PDF"><i class="fa-solid fa-file-pdf"></i></button><button class="btn-xs" data-pj="rcsend" data-no="' + r.no + '" title="Send to customer"><i class="fa-solid fa-paper-plane"></i></button></div></div>').join('') ||
            '<p class="helper-text">A receipt is issued each time you approve a payment. ' + (expected === 2 ? 'This 50/50 project gets two.' : 'This project gets one.') + '</p>';
        const certReady = p.install === 'Completed';
        const certInner = !certReady ? '<p class="helper-text">Available once installation is completed.</p>'
            : '<div class="doc-row"><div><b>' + esc((p.cert && p.cert.system) || 'CCTV') + ' Installation Certificate</b><small>' + (p.cert ? (p.cert.photos || []).length + ' installation photo(s)' : 'Not prepared yet') + '</small>' + (p.cert && p.cert.sent ? '<span class="sent-tag"><i class="fa-solid fa-check"></i> Sent to customer ' + fmtDate(p.cert.sent) + '</span>' : '') + '</div>' +
              '<div class="doc-acts"><button class="btn-xs" data-pj="cert">' + (p.cert ? 'Open' : 'Prepare') + '</button></div></div>';
        const crew = (q.crew || []).length ? card('ASSIGNED CREW', q.crew.map(w => '<div class="sched-detail-row"><span>' + esc(w.role) + '</span><strong>' + w.count + ' \u00D7 ' + w.days + ' day(s)</strong></div>').join('')) : '';
        return card('PAYMENT SUMMARY', '<div class="sched-detail-row"><span>Quotation total</span><strong>' + peso(t) + '</strong></div><div class="sched-detail-row"><span>Paid to date</span><strong class="green-text">' + peso(p.paid) + '</strong></div><div class="sched-detail-row"><span>Balance</span><strong>' + peso(bal) + '</strong></div>') +
            card('RECEIPTS', rc) + card('PROJECT DOCUMENTS', ['moa', 'jo', 'inv'].map(k => '<div class="doc-row"><div><b>' + DOCS[k].title + '</b><small>' + (k === 'inv' ? 'Crew checklist before installation (internal)' : 'Filled in from quotation ' + esc(q.id)) + '</small>' +
                (p.docsSent[k] ? '<span class="sent-tag"><i class="fa-solid fa-check"></i> Sent to customer ' + fmtDate(p.docsSent[k]) + '</span>' : '') + '</div>' +
                '<div class="doc-acts"><button class="btn-xs" data-pj="doc" data-d="' + k + '">View</button><button class="btn-xs" data-pj="docpdf" data-d="' + k + '" title="Download PDF"><i class="fa-solid fa-file-pdf"></i></button>' +
                (k === 'inv' ? '' : '<button class="btn-xs" data-pj="docsend" data-d="' + k + '" title="Send to customer"><i class="fa-solid fa-paper-plane"></i></button>') + '</div></div>').join('')) +
            card('CERTIFICATE OF ACCOMPLISHMENT', certInner) + crew;
    }

    /* ---------- receipts (acknowledgement receipt template) ---------- */
    function issueReceipt(p, amount, kind, ref) {
        DB.counters.receipt++;
        const label = kind === 'down' ? (p.agreement === 'half' ? '50% down payment' : 'Full payment')
            : (p.agreement === 'half' ? '50% balance (final payment)' : 'Full payment after installation');
        const r = { no: pad(DB.counters.receipt, 6), amount, method: p.method, date: TODAY, kind, label, ref: ref || '', sent: null };
        p.receipts.push(r); return r;
    }
    /* Acknowledgement Receipt (AR) template: the payment receipt */
    function receiptDocHTML(p, r) {
        const q = projQuote(p), inq = DB.inquiries.find(i => i.id === q.inqId);
        const addr = q.address || (inq && inq.address) || '';
        const desc = (q.project || p.title) + ' - ' + r.label + ' (Quotation ' + q.id + ')';
        const paid = r.method === 'Over the Counter' ? 'Paid in cash (over the counter)' : 'Paid online' + (r.ref ? (/^\d{4}$/.test(r.ref) ? ', Reference No. ending in ' : ', Reference No. ') + r.ref : '');
        const money = n => Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const earlier = p.receipts.slice(0, Math.max(0, p.receipts.indexOf(r)));   // e.g. the down payment, listed on the final receipt
        const total = qTotal(q), before = round2(earlier.reduce((s2, x) => s2 + x.amount, 0));
        const less = earlier.length ? earlier.map(x => ['', '', 'Less: Receipt No. ' + x.no + ' (' + x.label + ', ' + fmtDate(x.date) + '): \u20B1' + money(x.amount), '', ''])
            : [['', '', 'Less: payments received before this receipt: \u20B1' + money(before), '', '']];
        const rows = [['1', 'lot', desc, money(r.amount), money(r.amount)], ['', '', paid, '', ''], ['', '', '', '', ''],
            ['', '', 'Total project cost: \u20B1' + money(total), '', '']].concat(less, [
            ['', '', 'Remaining balance after this payment: \u20B1' + money(Math.max(0, round2(total - before - r.amount))), '', '']]);
        while (rows.length < 11) rows.push(['', '', '', '', '']);
        return '<div class="ar-page"><div class="ar-head"><img src="' + BIZ.logo + '" alt="BeyondWires"><div class="ar-biz"><h1>BeyondWires</h1><h2>SECURITY SYSTEM SERVICES</h2>' +
            '<p class="ar-contact">' + BIZ.arPhone + '| ' + BIZ.arEmail + '</p><p class="ar-svc">' + BIZ.arServices.map(esc).join('<br>') + '</p></div></div>' +
            '<table class="ar-info"><tr><td><b>NAME:</b> ' + esc(p.customer) + '</td><td class="ar-r"><b>DATE:</b> ' + fmtDate(r.date) + '</td></tr>' +
            '<tr><td><b>ADDRESS:</b> ' + esc(addr) + '</td><td class="ar-r"><b>NO:</b> <span class="ar-no">' + esc(r.no) + '</span></td></tr></table>' +
            '<div class="ar-title">Acknowledgement Receipt</div>' +
            '<table class="ar-items"><colgroup><col style="width:42px"><col style="width:44px"><col><col style="width:84px"><col style="width:90px"><col style="width:20px"></colgroup>' +
            '<thead><tr><th>QTY</th><th>UNIT</th><th class="l">DESCRIPTION OF GOODS</th><th>RATE</th><th>PRICE</th><th></th></tr></thead><tbody>' +
            rows.map(x => '<tr><td class="c">' + x[0] + '</td><td class="c">' + x[1] + '</td><td>' + esc(x[2]) + '</td><td class="r">' + x[3] + '</td><td class="r">' + x[4] + '</td><td></td></tr>').join('') +
            '<tr class="ar-foot"><td colspan="3" rowspan="2" class="ar-note"><i>Make sure to receive the above mentioned goods in good condition. No refund of money after payment.</i></td><td></td><td></td><td></td></tr>' +
            '<tr class="ar-foot"><td></td><td></td><td></td></tr>' +
            '<tr class="ar-sign"><td colspan="3">Authorized Signature:</td><td colspan="3"><b>Total:</b> ₱' + money(r.amount) + '</td></tr></tbody></table></div>';
    }
    const receiptPDF = (p, r) => makePDF(receiptDocHTML(p, r), 'Acknowledgement-Receipt-' + r.no + '.pdf', 560, 760, '.ar-page');

    /* ---------- project documents: Memorandum of Agreement, Job Order, Inventory checklist ---------- */
    const DOCS = {
        moa: { title: 'Memorandum of Agreement', file: 'MOA', page: '.moa-page' },
        jo:  { title: 'Job Order', file: 'Job-Order', page: '.jo-page' },
        inv: { title: 'Inventory Checklist', file: 'Inventory-Checklist', page: '.inv-page' }
    };
    const money2 = n => Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const line = (v, w) => '<span class="dl" style="min-width:' + (w || 160) + 'px">' + (esc(v) || '&nbsp;') + '</span>';
    function projParts(p) {
        const q = projQuote(p), inq = DB.inquiries.find(i => i.id === q.inqId) || {};
        const typeOf = i => (DB.catalog.find(c => c.id === i.id) || { type: 'product' }).type;
        const pkg = q.items.find(i => typeOf(i) === 'package');
        return { q, inq, typeOf, pkg, addr: q.address || inq.address || '', t: calc(q) };
    }
    function moaDocHTML(p) {
        const { q, pkg, addr, t } = projParts(p);
        const system = pkg ? pkg.name.replace(/\s*CCTV Package$/i, '').replace(/\s*Package$/i, '') : (q.project || p.title);
        const rcNos = p.receipts.map(r => r.no).join(', ');
        return '<div class="moa-page"><h1>Memorandum of Agreement</h1>' +
            '<p>This agreement dated ' + line(fmtFull(p.approvedOn), 130) + ' is made by and between BEYONDWIRES SECURITY SYSTEM SERVICES <b>(BeyondWires)</b> with an office address at Rosal St., Tala, Caloocan City, 1427 hereby known as the <b><u>Company</u></b>.</p>' +
            '<p class="c">-and-</p>' +
            '<p class="l">Mr./Ms./Mrs. ' + line(p.customer, 230) + ' with an office address at ' + line(addr, 260) + ' hereby known as the <b><u>Client</u></b>.</p>' +
            '<p class="c">-Witnesseth that-</p>' +
            '<p>Whereas the above-listed Client wishes to install their Close Circuit Television (CCTV) Security System. Whereas the Company, through <b><u>Mr. Eugene Isabelo</u></b>, agrees to provide such services to the Client and thus both parties hereby agree to the following terms of this agreement:</p>' +
            '<h3>Scope of Work</h3><p>The Company shall work on doing the delivery and installation of ' + line(system, 120) + ' Package CCTV system for Mr./Ms./Mrs. ' + line(p.customer, 200) + '.</p>' +
            '<h3>Contract Amount</h3><p>The agreement shall amount to ₱' + line(money2(t.total), 140) + ' (Total Contract Price). Such amount will <b>NOT</b> increase without prior notice to both parties.</p>' +
            '<h3>Confidentiality</h3><p>The Company, its agents, personnel, employee(s), and/or subcontractor(s) shall keep the confidentiality to all information received during performance of the Services and maintain confidentiality beyond the termination of this Agreement.</p>' +
            '<h3>Service Warranty</h3><p>We will perform the services in a professional, workmanlike manner, consistent with industry standards. In the event we provide services that do not conform to this warranty, we will re-perform such services at no additional cost to you. This warranty shall be valid for 90 days from the date of installation. Relocation of the system after the installation day is not covered by this warranty.</p>' +
            '<h3>Product Warranty</h3><p><b>The surveillance Cameras, recording device (DVR), Surveillance Hard Drive, and Monitor are all under warranty for One (1) year from the date of installation; all other accessories are not under this warranty.</b></p><ul>' +
            ['We will check the device if the defect/damage is on the warranty.', 'No burned parts, crack on the lens, or sign of drop.', 'Any form of Mishandling from an end-user (Client side) will deem the Warranty as Void.',
             'Accessories like Power Supplies, Connectors, Cable wires, etc. are not covered by this warranty.', 'Natural Calamities and uncontrollable events that might affect the system are not covered by this warranty.',
             'Unless advised by our Head Technician, allowing other installers/technicians to move any items in the system will void both the product and the service warranty.'].map(x => '<li><b>' + x + '</b></li>').join('') + '</ul>' +
            '<h3>Service and Site Visit Conditions</h3><p><b>Included on the Installation Amount is TWO (2) Free On-Site Services within the warranty period. After the two on-site service has been consumed or after the 90-day service warranty (whichever comes first), succeeding requests for On-site Service will have an On-Site Service Fee amounting to ₱1,000 plus applicable Transportation Charges if outside of Metro Manila.</b></p>' +
            '<div class="moa-sign"><div><div class="sl">' + esc(q.incharge || '') + '</div><b>Representative/Installer\'s Signature</b><div class="sl" style="margin-top:44px"></div><span>BeyondWires Authorized Signature</span></div>' +
            '<div class="moa-logo"><img src="' + BIZ.logo + '" alt="BeyondWires"></div>' +
            '<div><div class="sl">' + esc(p.customer) + '</div><b>Client (Signature above printed name)</b><div class="moa-office"><i><b>FOR OFFICE USE ONLY:</b></i>' +
            '<div>Job Order Number: ' + line(p.id, 110) + '</div><div>Receipt Number: ' + line(rcNos, 110) + '</div><div>DR Number: ' + line('', 110) + '</div></div></div></div></div>';
    }
    function jobOrderDocHTML(p) {
        const { q, inq, typeOf, pkg, addr, t } = projParts(p);
        const has = k => q.items.some(i => typeOf(i) === k);
        const box = on => '<span class="jo-box">' + (on ? '&#10003;' : '') + '</span>';
        const items = q.items.filter(i => typeOf(i) !== 'service');
        const svc = round2(q.items.filter(i => typeOf(i) === 'service').reduce((s, i) => s + i.qty * i.price, 0) + t.lab);
        const parts = round2(items.reduce((s, i) => s + i.qty * i.price, 0));
        const paidBy = m => p.receipts.filter(r => r.method === m).reduce((s, r) => s + r.amount, 0);
        const rows = items.map(i => ({ qty: i.qty, name: i.name, desc: (DB.catalog.find(c => c.id === i.id) || {}).desc || '' }));
        while (rows.length < 14) rows.push({ qty: '', name: '', desc: '' });
        const crew = (q.crew || []).map(w => w.count + ' ' + w.role + (w.count > 1 ? 's' : '')).join(', ');
        const amt = (l, v) => '<div class="jo-amt"><b>' + l + ':</b><span>₱ ' + (v == null ? '' : money2(v)) + '</span></div>';
        return '<div class="jo-page"><h1>JOB ORDER</h1><p class="jo-sub">CCTV INSTALLATION AND SERVICES</p>' +
            '<div class="jo-top"><div><b>Date Issued:</b> ' + line(fmtDate(p.approvedOn), 170) + '</div><div><b>Job Number:</b> ' + line(p.id, 190) + '</div></div>' +
            '<table class="jo-t"><tr><th colspan="2">CLIENT/JOBSITE DETAILS</th></tr>' +
            '<tr><td><i>Client Name:</i> ' + esc(p.customer) + '</td><td class="w"><i>Contact Person:</i> ' + esc(inq.contact ? inq.contact.name + (inq.contact.role ? ' (' + inq.contact.role + ')' : '') : p.customer) + '</td></tr>' +
            '<tr><td rowspan="2" class="tall"><i>Job Site Address:</i> ' + esc(addr) + (inq.landmark ? '<br><i>Landmark:</i> ' + esc(inq.landmark) : '') + '</td><td><i>Contact Number:</i> ' + esc(inq.contact ? inq.contact.phone : inq.phone || '') + '</td></tr>' +
            '<tr><td><i>Email Address:</i> ' + esc(q.email || p.email || '') + '</td></tr></table>' +
            '<table class="jo-t"><tr><th colspan="2">WORK ORDER DESCRIPTION</th></tr><tr><td class="jo-chk">' +
            '<div>' + box(!!pkg) + ' CCTV Installation Package: ' + line(pkg ? pkg.name : '', 120) + '</div><div>' + box(false) + ' Diagnostic &amp; Repairs</div><div>' + box(false) + ' CCTV Upgrades</div><div>' + box(false) + ' Relocation/Dismantle &amp; Reinstall</div></td>' +
            '<td class="jo-chk"><div>' + box(false) + ' Rewiring</div><div>' + box(!items.length) + ' Labor Only</div><div>' + box(!!items.length && !has('service') && q.noLabor) + ' Materials Only</div><div>' + box(!pkg && !!items.length && (has('service') || !q.noLabor)) + ' Others: ' + line(!pkg && items.length ? (q.project || 'Supply and installation') : '', 110) + '</div></td></tr></table>' +
            '<table class="jo-t jo-items"><colgroup><col style="width:46px"><col style="width:34%"><col><col style="width:26%"></colgroup><tr><th colspan="4">ITEMS USED IN THE JOB SITE</th></tr>' +
            '<tr class="h"><td>QTY</td><td>Materials Used</td><td>Description</td><td>Serial Number</td></tr>' +
            rows.map(r => '<tr><td class="c">' + r.qty + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.desc) + '</td><td></td></tr>').join('') + '</table>' +
            '<div class="jo-amts">' + amt('Total Services Cost', svc) + amt('Total Parts/Accessories Cost', parts) + amt('Other On-Site Reimbursement', t.exp) + (t.vat ? amt('VAT (' + Math.round(VAT_RATE * 100) + '%)', t.vat) : '') + amt('Total Amount Due', t.total) + '</div>' +
            '<table class="jo-t"><tr><th colspan="2">TECHNICIAN INFORMATION</th></tr><tr><td class="tall2"><i>Technician/Installer:</i> ' + esc([q.incharge, crew].filter(Boolean).join(' • ')) + '</td><td class="tall2"><i>Remarks:</i></td></tr>' +
            '<tr><td><i>Date Completed:</i> ' + (p.endDate ? fmtDate(p.endDate) : '') + '</td><td><i>Time required:</i> ' + esc(q.duration || '') + '</td></tr>' +
            '<tr><td class="jo-signs"><b>JOB ORDER ISSUED BY:</b><div class="sl"></div>Authorized Signature</td><td class="jo-signs"><b>WORK APPROVED BY:</b><div class="sl"></div>Client\'s Signature Over Printed Name</td></tr></table>' +
            '<table class="jo-t"><tr><th colspan="2">FOR OFFICE NOTES ONLY</th></tr><tr><td class="jo-chk"><b>Payments from Client:</b>' +
            '<div>' + box(paidBy('Over the Counter') > 0) + ' Cash: ₱' + line(paidBy('Over the Counter') ? money2(paidBy('Over the Counter')) : '', 120) + '</div>' +
            '<div>' + box(paidBy('Online') > 0) + ' Online Transfer: ₱' + line(paidBy('Online') ? money2(paidBy('Online')) : '', 100) + '</div>' +
            '<div>' + box(false) + ' Cheque: ₱' + line('', 120) + '</div><div>' + box(false) + ' Others: ' + line('', 130) + '</div><div>Unused Items Checked by: ' + line('', 120) + '</div></td>' +
            '<td class="jo-chk jo-office"><div>JO No: ' + line(p.id, 150) + '</div><div>AR No: ' + line(p.receipts.map(r => r.no).join(', '), 150) + '</div><div>OR/SI No: ' + line('', 150) + '</div><div>Sales Team/Page: ' + line('', 120) + '</div><div>Tested by: ' + line('', 140) + '</div></td></tr></table></div>';
    }
    /* Inventory check & balance: quotation items first, then the standard materials, accessories, documents and tools */
    const INV_GROUPS = [
        ['POWER SUPPLY', ['2 amp', '5 amp', 'CPS']], ['JUNCTION BOX', ['100x100x70', '255x200x80']], ['CABLE WIRE (CAT6)', ['black', 'gray', 'others']], ['MONITOR', ['17\'\' square', '19\'\' wide', 'others']],
        ['ACCESSORIES', ['Splitter', 'DC-male', 'DC-female', 'VIDEO BALUN-black', 'VIDEO BALUN-yellow', 'CABLE CLIP-9mm', 'CABLE CLIP-12mm', 'CABLE CLIP-16mm', 'CABLE TIE', 'BLACK SCREW', 'ELECTRICAL TAPE-white', 'ELECTRICAL TAPE-black', 'BRACKET', 'VGA/HDMI', 'POWER CORD', 'RJ45', 'BNC', 'WHITE ADAPTOR', 'EXTENSION (FOR CUSTOMER)']],
        ['CONSUMABLES', ['SEALANT & SEALANT GUN', 'MOLDING MATERIALS', 'NO MORE NAILS/ADHESIVE', 'PACKAGING TAPE', 'POCKET MONEY']],
        ['DOCUMENTS', ['MOA', 'AR/OR/DR', 'J.O', 'I.D', 'BALLPEN']],
        ['TOOLS/Equipment', ['DRILL', 'WIRE STRIPPER', 'EXTENSION (FOR INSTALLERS)', 'CRIMPING', 'TESTER', 'SCISSORS', 'HAMMER', 'SCREW DRIVERS', 'LADDER-1 (non-telescopic)', 'LADDER-2 (A-type telescopic)', 'LADDER-3 (straight telescopic)', 'HEADLIGHT/FLASH LIGHT', 'WELDING MACHINE SET', 'MOTOR TOOLS']]
    ];
    function invDocHTML(p) {
        const { q, typeOf } = projParts(p);
        const groups = [];
        q.items.filter(i => typeOf(i) !== 'service').forEach(i => {
            const c = DB.catalog.find(x => x.id === i.id) || {}, g = typeOf(i) === 'package' ? 'PACKAGE' : String(c.cat || 'PRODUCTS').toUpperCase();
            let grp = groups.find(x => x.name === g); if (!grp) groups.push(grp = { name: g, quote: true, rows: [] });
            grp.rows.push({ d: i.name + (c.desc && typeOf(i) === 'package' ? ' (' + c.desc + ')' : ''), qty: i.qty });
        });
        INV_GROUPS.forEach(g => groups.push({ name: g[0], rows: g[1].map(d => ({ d, qty: '' })) }));
        const flat = []; groups.forEach(g => g.rows.forEach((r, k) => flat.push(Object.assign({ g: g.name, quote: g.quote, first: !k }, r))));
        const pages = []; let i = 0;
        while (i < flat.length) { const n = pages.length ? 46 : 40; pages.push(flat.slice(i, i + n)); i += n; }
        const head = '<h1>INVENTORY CHECK &amp; BALANCE</h1><div class="inv-meta"><span><b>Job No:</b> ' + esc(p.id) + '</span><span><b>Customer:</b> ' + esc(p.customer) + '</span><span><b>Quotation:</b> ' + esc(q.id) + '</span></div>' +
            '<div class="inv-meta"><span><b>Installation:</b> ' + esc((bookingById(p.bookingId) ? fmtDate(bookingById(p.bookingId).date) + ', ' + bookingById(p.bookingId).time : 'Not scheduled yet')) + '</span><span><b>Crew:</b> ' + esc((q.crew || []).map(w => w.count + ' ' + w.role + (w.count > 1 ? 's' : '')).join(', ') || '—') + '</span></div>';
        return pages.map((rows, pi) => {
            const body = rows.map((r, k) => {
                const span = rows.filter(x => x.g === r.g).length, firstHere = k === 0 || rows[k - 1].g !== r.g;
                return '<tr' + (r.quote ? ' class="q"' : '') + '>' + (firstHere ? '<td class="g" rowspan="' + span + '">' + esc(r.g) + (r.quote ? '<small>from quotation</small>' : '') + '</td>' : '') +
                    '<td>' + esc(r.d) + '</td><td class="c">' + r.qty + '</td><td class="c"><span class="jo-box"></span></td><td class="c"><span class="jo-box"></span></td><td></td></tr>';
            }).join('');
            return '<div class="inv-page">' + (pi ? '<h1 class="sm">INVENTORY CHECK &amp; BALANCE (continued) • ' + esc(p.id) + '</h1>' : head) +
                '<table class="inv-t"><colgroup><col style="width:130px"><col><col style="width:50px"><col style="width:70px"><col style="width:76px"><col style="width:130px"></colgroup>' +
                '<tr class="h"><td>ITEMS</td><td>DESCRIPTION</td><td>QTY</td><td>CHECKED OUT</td><td>RETURNED</td><td>REMARKS</td></tr>' + body + '</table>' +
                (pi === pages.length - 1 ? '<div class="inv-sign"><div><div class="sl"></div>Prepared by</div><div><div class="sl"></div>Checked by (before installation)</div><div><div class="sl"></div>Checked by (after installation)</div></div>' : '') +
                '<div class="ct-foot">Page ' + (pi + 1) + ' of ' + pages.length + '</div></div>';
        }).join('');
    }
    const docHTML = (p, k) => k === 'moa' ? moaDocHTML(p) : k === 'jo' ? jobOrderDocHTML(p) : invDocHTML(p);
    function viewDoc(p, k) {
        const d = DOCS[k]; if (!d) { projView = 'stage'; return ''; }
        const note = { moa: 'Filled in from the approved quotation. Sending saves this PDF in the customer\'s Documents. Print two copies for signing: one for the client and one for the office.',
            jo: 'Filled in from the quotation, the assigned crew and the payments so far. Serial numbers and remarks are written in by hand on site. Sending saves this PDF in the customer\'s Documents.',
            inv: 'Checklist for the crew before they leave for the installation. The first rows come from the quotation; tick CHECKED OUT when loading and RETURNED after the job.' }[k];
        return '<div class="receipt-preview-grid"><div class="qd-wrap"><div class="qd-scale">' + docHTML(p, k) + '</div></div>' +
            '<div>' + card(d.title.toUpperCase(), '<div class="sched-detail-row"><span>Project</span><strong>' + esc(p.id) + '</strong></div><div class="sched-detail-row"><span>Customer</span><strong>' + esc(p.customer) + '</strong></div>' +
            (k === 'inv' ? '' : '<div class="sched-detail-row"><span>Sent to customer</span><strong>' + (p.docsSent[k] ? fmtDate(p.docsSent[k]) : 'Not yet') + '</strong></div>') +
            '<p class="helper-text" style="margin:10px 0">' + note + '</p>' +
            (k === 'inv' ? '' : '<button class="btn-primary full-width" data-pj="docsend" data-d="' + k + '"><i class="fa-solid fa-paper-plane"></i> ' + (p.docsSent[k] ? 'Resend to customer' : 'Send to customer') + '</button>') +
            '<button class="' + (k === 'inv' ? 'btn-primary' : 'btn-outline') + ' full-width" data-pj="docpdf" data-d="' + k + '"><i class="fa-solid fa-file-pdf"></i> Download PDF</button>' +
            '<button class="btn-outline full-width" data-pj="docprint" data-d="' + k + '"><i class="fa-solid fa-print"></i> Print</button>') + '</div></div>';
    }
    function sendReceipt(p, r) {
        const first = !r.sent; r.sent = TODAY; save();
        toast('Receipt \u2116 ' + r.no + (first ? ' sent' : ' resent') + ' to ' + p.customer);
    }
    function viewReceipt(p, r) {
        if (!r) { projView = 'stage'; return ''; }
        const i = p.receipts.indexOf(r) + 1, n = p.agreement === 'half' ? 2 : 1;
        return '<div class="receipt-preview-grid"><div class="qd-wrap"><div class="qd-scale">' + receiptDocHTML(p, r) + '</div></div>' +
            '<div>' + card('ACKNOWLEDGEMENT RECEIPT \u2116 ' + r.no, '<div class="sched-detail-row"><span>Receipt</span><strong>' + i + ' of ' + n + '</strong></div><div class="sched-detail-row"><span>For</span><strong>' + esc(r.label) + '</strong></div><div class="sched-detail-row"><span>Amount</span><strong class="green-text">' + peso(r.amount) + '</strong></div><div class="sched-detail-row"><span>Date</span><strong>' + fmtDate(r.date) + '</strong></div><div class="sched-detail-row"><span>Method</span><strong>' + esc(r.method) + '</strong></div>' +
            '<div class="sched-detail-row"><span>Sent to customer</span><strong>' + (r.sent ? fmtDate(r.sent) : 'Not yet') + '</strong></div>' +
            '<button class="btn-primary full-width" data-pj="rcsend" data-no="' + r.no + '" style="margin-top:8px"><i class="fa-solid fa-paper-plane"></i> ' + (r.sent ? 'Resend to customer' : 'Send to customer') + '</button>' +
            '<button class="btn-outline full-width" data-pj="rcpdf" data-no="' + r.no + '"><i class="fa-solid fa-file-pdf"></i> Download PDF</button>' +
            '<p class="helper-text">The receipt is emailed to ' + esc(projQuote(p).email || 'the customer') + ' as a PDF.</p>') + '</div></div>';
    }

    /* ---------- certificate of installation + accomplishment report ---------- */
    function certDefaults(p) {
        const q = projQuote(p), inq = DB.inquiries.find(i => i.id === q.inqId);
        const work = q.project || p.title;
        const equip = q.items.filter(i => (DB.catalog.find(c => c.id === i.id) || { type: 'product' }).type !== 'service').map(i => i.qty + ' \u00D7 ' + i.name).join(', ');
        return {
            system: 'CCTV', title: 'Installation of ' + work + ' for ' + p.customer, work: work,
            location: q.address || (inq && inq.address) || '', manager: q.incharge || 'Mr. Eugene Isabelo', team: '',
            start: p.startDate || TODAY, end: p.endDate || TODAY, contractor: BIZ.contractor, residence: BIZ.residence,
            overview: 'This project involved the installation of ' + work + ' for ' + p.customer + '. The objective was to enhance security by providing reliable surveillance coverage across the property, including entrances and other critical areas, while keeping disruption to daily operations to a minimum.',
            scope: 'Site Survey and Equipment Placement Design: Conducted a site survey to identify the best placement for each device.\n' +
                'Installation of Equipment:\n- Installed ' + (equip || 'the equipment listed in the quotation') + ' at the designated locations.\n- Ran and secured all cabling and power connections.\n' +
                'Network Configuration and System Integration: Configured the recorder and network settings for centralized access and remote viewing.\n' +
                'Testing and Turnover: Tested every device, walked the customer through the system and turned it over.',
            photos: [], sent: null
        };
    }
    function scopeHTML(text, from, to) {
        const items = []; String(text || '').split('\n').map(s => s.trim()).filter(Boolean).forEach(l => {
            if (/^[-\u2022*]\s*/.test(l) && items.length) items[items.length - 1].subs.push(l.replace(/^[-\u2022*]\s*/, ''));
            else { const m = /^([^:]{2,80}):\s*(.*)$/.exec(l); items.push(m ? { t: m[1], d: m[2], subs: [] } : { t: '', d: l, subs: [] }); }
        });
        const part = items.slice(from, to);
        return { total: items.length, html: part.length ? '<ol start="' + (from + 1) + '">' + part.map(it => '<li>' + (it.t ? '<b>' + esc(it.t) + ':</b>' + (it.d ? '<br>' : '') : '') + esc(it.d) + (it.subs.length ? '<ul>' + it.subs.map(s => '<li>' + esc(s) + '</li>').join('') + '</ul>' : '') + '</li>').join('') + '</ol>' : '' };
    }
    function certDocHTML(p, c) {
        const head = sm => '<div class="ct-head' + (sm ? ' sm' : '') + '"><div class="ct-logo"><img src="' + BIZ.logo + '" alt="Beyond Wires"></div><div class="ct-tag"><span>Beyond Secured.</span><b>Beyond Excellence.</b></div>' +
            '<p class="ct-addr"><i>' + BIZ.certAddr + '</i> | ' + BIZ.email + '<br>' + BIZ.phone + ' | NON-VAT TIN: ' + BIZ.certTin + '</p></div>';
        const sys = esc((c.system || 'CCTV').toUpperCase()), row = (l, v) => '<span>' + l + '</span><div>' + (esc(v) || '&nbsp;') + '</div>';
        const pages = [];
        pages.push(head() + '<h1 class="ct-title">' + sys + ' INSTALLATION CERTIFICATE</h1>' +
            '<div class="ct-rows">' + row('Project Title:', c.title) + '</div><div class="ct-rows">' + row('Location:', c.location) + '</div>' +
            '<div class="ct-rows">' + row('Main Contractor:', BIZ.legal) + row('Project Manager:', c.manager) + row('Team Members:', c.team) + '</div>' +
            '<div class="ct-rows">' + row('Project Start Date:', fmtFull(c.start)) + row('Project End Date:', fmtFull(c.end)) + '</div>' +
            '<p class="ct-p">I, <b>' + esc(c.contractor) + '</b>, an individual residing at <b>' + esc(c.residence) + '</b>, hereby certifies that as of the date stated above, the said installation of the ' + esc(c.work) + ' has been finished in accordance with the requirements of the building owner and adheres to all local government codes and bylaws regarding ' + esc(c.system || 'CCTV') + ' installation.</p>' +
            '<div class="ct-sign"><div class="sig"></div><b>' + esc(c.contractor) + '</b><span>Signature of Contractor over Printed Name</span><span>Date Signed: ' + fmtFull(c.end) + '</span></div>' +
            '<div class="ct-ack">Acknowledged by:<div>' + esc(p.customer) + '<br><small>Signature over Printed Name</small></div></div>');
        const first = scopeHTML(c.scope, 0, 4);
        pages.push(head() + '<h1 class="ct-title">ACCOMPLISHMENT REPORT</h1><h2>Project Overview</h2><p class="ct-just">' + esc(c.overview) + '</p>' +
            '<h2>Project Scope</h2><p>The project scope included the following activities:</p>' + first.html);
        for (let i = 4; i < first.total; i += 7) pages.push(head(true) + '<h2>Project Scope (continued)</h2>' + scopeHTML(c.scope, i, i + 7).html);
        const ph = c.photos || [];
        for (let i = 0; i < ph.length; i += 4) pages.push(head(true) + '<h1 class="ct-title">PROOF OF INSTALLATION</h1><div class="ct-photos">' +
            ph.slice(i, i + 4).map((x, j) => '<figure><img src="' + x.src + '" alt=""><figcaption>' + (esc(x.caption) || 'Photo ' + (i + j + 1)) + '</figcaption></figure>').join('') + '</div>');
        return pages.map((x, i) => '<div class="ct-page">' + x + '<div class="ct-foot">Page ' + (i + 1) + ' of ' + pages.length + '</div></div>').join('');
    }
    function viewCert(p) {
        if (!p.cert) p.cert = certDefaults(p);   // saved to the server on the first edit (or when sent)
        const c = p.cert, v = x => esc(x || '');
        const fld = (k, l, type) => '<div class="form-group"><label for="cf-' + k + '">' + l + '</label><input type="' + (type || 'text') + '" id="cf-' + k + '" data-cf="' + k + '" value="' + v(c[k]) + '" maxlength="160"></div>';
        const area = (k, l, rows) => '<label class="card-label-top" for="cf-' + k + '" style="margin-bottom:6px">' + l + '</label><textarea id="cf-' + k + '" data-cf="' + k + '" rows="' + rows + '" maxlength="1500">' + v(c[k]) + '</textarea>';
        const photos = (c.photos || []).map((x, i) => '<div class="ct-thumb"><img src="' + x.src + '" alt=""><button type="button" class="rm" data-pj="ctrm" data-i="' + i + '" aria-label="Remove photo">&times;</button><input type="text" data-cap="' + i + '" maxlength="60" placeholder="Caption (e.g. Lobby camera)" value="' + v(x.caption) + '"></div>').join('');
        return '<div class="receipt-preview-grid"><div class="qd-wrap"><div class="qd-scale" id="ctPreview">' + certDocHTML(p, c) + '</div></div>' +
            '<div><div class="section-card b-right ct-form"><span class="card-label-top">CERTIFICATE OF ACCOMPLISHMENT</span>' +
            '<p class="helper-text" style="margin-bottom:12px">Sent after installation, together with the accomplishment report and installation photos. Edits save automatically.</p>' +
            fld('system', 'SYSTEM TYPE (TITLE)') + fld('title', 'PROJECT TITLE') + fld('work', 'WORK COMPLETED (USED IN THE CERTIFICATION)') + fld('location', 'LOCATION') + fld('manager', 'PROJECT MANAGER') + fld('team', 'TEAM MEMBERS') +
            '<div class="two-col">' + fld('start', 'START DATE', 'date') + fld('end', 'END DATE', 'date') + '</div>' + fld('contractor', 'CONTRACTOR (SIGNATORY)') + fld('residence', 'CONTRACTOR ADDRESS') +
            area('overview', 'PROJECT OVERVIEW', 5) + area('scope', 'PROJECT SCOPE (ONE ACTIVITY PER LINE: "Title: details". START A LINE WITH "-" FOR A SUB-POINT)', 8) +
            '<span class="card-label-top">PROOF OF INSTALLATION (' + (c.photos || []).length + '/' + PHOTO_MAX + ' PHOTOS)</span>' +
            '<label class="ct-upload"><i class="fa-solid fa-camera"></i> Add installation photos<input type="file" id="ctPhotos" accept="image/*" multiple hidden></label>' +
            '<div class="ct-thumbs">' + photos + '</div>' +
            '<div class="sched-detail-row" style="margin-top:12px"><span>Sent to customer</span><strong>' + (c.sent ? fmtDate(c.sent) : 'Not yet') + '</strong></div>' +
            '<button class="btn-primary full-width" data-pj="ctsend"><i class="fa-solid fa-paper-plane"></i> ' + (c.sent ? 'Resend to customer' : 'Send to customer') + '</button>' +
            '<button class="btn-outline full-width" data-pj="ctpdf"><i class="fa-solid fa-file-pdf"></i> Download PDF</button></div></div></div>';
    }
    function compressImage(file) {
        return new Promise((res, rej) => {
            const fr = new FileReader();
            fr.onload = () => { const img = new Image(); img.onload = () => {
                const s = Math.min(1, 1000 / Math.max(img.width, img.height)), cv = document.createElement('canvas');
                cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
                cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); res(cv.toDataURL('image/jpeg', 0.72));
            }; img.onerror = rej; img.src = fr.result; };
            fr.onerror = rej; fr.readAsDataURL(file);
        });
    }
    function refreshCertPreview(p) { const el = $('#ctPreview'); if (el) el.innerHTML = certDocHTML(p, p.cert); }
    /* Certificate fields are saved on the server (edits save automatically after a short pause) */
    const CERT_KEYS = ['system', 'title', 'work', 'location', 'manager', 'team', 'contractor', 'residence', 'overview', 'scope', 'start', 'end'];
    function saveCert(p) {
        const body = {}; CERT_KEYS.forEach(k => { body[k] = p.cert[k] || ''; });
        body.captions = {}; (p.cert.photos || []).forEach(ph => { if (ph.id) body.captions[ph.id] = ph.caption || ''; });
        return api('/admin/projects/' + p.dbId + '/certificate', { method: 'PUT', body });
    }
    let certTimer = null;
    const queueCertSave = p => { clearTimeout(certTimer); certTimer = setTimeout(() => saveCert(p).catch(err => toast(err.message)), 700); };
    $('#projDetail').addEventListener('input', e => {
        const p = DB.projects.find(x => x.id === curProj); if (!p || !p.cert) return;
        const t = e.target;
        if (t.dataset.cf) { p.cert[t.dataset.cf] = t.value; refreshCertPreview(p); queueCertSave(p); }
        else if (t.dataset.cap != null) { const ph = p.cert.photos[+t.dataset.cap]; if (ph) { ph.caption = t.value; refreshCertPreview(p); queueCertSave(p); } }
    });
    const dataUrlToBlob = u => { const [h, b64] = u.split(','), bin = atob(b64), arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); return new Blob([arr], { type: (/data:([^;]+)/.exec(h) || [])[1] || 'image/jpeg' }); };
    $('#projDetail').addEventListener('change', e => {
        const p = DB.projects.find(x => x.id === curProj); if (!p) return;
        if (e.target.id !== 'ctPhotos') return;
        const files = Array.from(e.target.files || []).filter(f => /^image\//.test(f.type));
        const room = PHOTO_MAX - p.cert.photos.length;
        if (!files.length) return;
        if (room <= 0) return toast('Up to ' + PHOTO_MAX + ' photos per certificate');
        if (files.length > room) toast('Only the first ' + room + ' photo(s) were added (limit ' + PHOTO_MAX + ')');
        Promise.all(files.slice(0, room).map(compressImage)).then(list => act(async () => {
            await saveCert(p);                        // make sure the certificate exists first
            for (const src of list) { const fd = new FormData(); fd.append('photo', dataUrlToBlob(src), 'photo.jpg'); await api('/admin/projects/' + p.dbId + '/certificate/photos', { form: fd }); }
        }, list.length + ' photo(s) added')).catch(() => toast('Could not read one of the images'));
    });

    /* ---------- project actions ---------- */
    function scheduleInstall(p) {
        const bk = bookingById(p.bookingId); let sel = bk ? { date: bk.date, time: bk.time } : { date: '', time: '' };
        const h = openModal('<button class="mc-x" data-close aria-label="Close">&times;</button><h2>Schedule Installation</h2><p class="mc-sub">' + esc(p.customer) + ' \u2022 ' + p.id + (bk ? ' \u2022 currently ' + fmtDate(bk.date) + ', ' + bk.time : '') + '</p><div id="instCal"></div>' +
            '<label class="mc-check"><input type="checkbox" id="instNotify" checked> Notify the customer</label>' +
            '<div class="mc-actions"><button class="mc-btn" data-close>Cancel</button><button class="mc-btn pri" data-m="save">Save schedule</button></div>',
            e => {
                if (!e.target.closest('[data-m="save"]')) return;
                if (!sel.date || !sel.time) return toast('Choose a date and a time slot');
                const notify = $('#instNotify').checked;
                closeModal();
                act(() => api('/admin/projects/' + p.dbId + '/schedule', { body: { date: sel.date, slot: sel.time, notify } }),
                    'Installation scheduled for ' + fmtDate(sel.date) + ', ' + sel.time + (notify ? '. Customer notified.' : ''));
            });
        Picker($('#instCal', h), { date: sel.date, time: sel.time, exclude: bk && bk.id, times: true, onChange: (d, t) => { sel = { date: d, time: t }; } });
    }
    /* Approving a payment issues the receipt on the server; the page then shows it. */
    function payConfirmed(p, amt, kind, paymentId, cash) {
        act(() => api('/admin/payments/' + paymentId + '/confirm', { body: cash ? { amount: amt } : {} }), 'Payment of ' + peso(amt) + ' approved. Receipt issued.')
            .then(ok => {
                if (!ok) return;
                const np = DB.projects.find(x => x.dbId === p.dbId); if (!np) return;
                const r = np.receipts.find(x => x.paymentId === paymentId);
                if (r) { projView = 'receipt'; projRc = r.no; }
                projStage = Math.min(stepIdx(np), 4); renderProjView();
            });
    }
    $('#projDetail').addEventListener('click', e => {
        const el = e.target.closest('[data-pj]'); if (!el || el.disabled) return;
        const p = DB.projects.find(x => x.id === curProj), a = el.dataset.pj, k = el.dataset.k;
        const rerender = () => { save(); refreshAll(); renderProjView(); };
        const rc = el.dataset.no ? p.receipts.find(r => r.no === el.dataset.no) : null;
        switch (a) {
            case 'back': if (projView !== 'stage') { projView = 'stage'; renderProjView(); } else pane('projects', 'projList'); break;
            case 'stage': projStage = +el.dataset.i; renderProjView(); break;
            case 'quote': showTab('quotations'); openQuoteView(p.quoteId); break;
            case 'agree':
                if (el.dataset.v === 'after' && p.type !== 'Residential') return toast('Full Payment After Installation is for residential customers only');
                if (p.locked) return toast('The payment terms are locked after a proof is submitted');
                act(() => api('/admin/projects/' + p.dbId + '/terms', { body: { payment_agreement: AGREE_SRV[el.dataset.v], payment_method: METHOD_SRV[p.method] } }), 'Payment agreement updated. The customer was notified.'); break;
            case 'method':
                if (p.locked) return toast('The payment method is locked after a proof is submitted');
                act(() => api('/admin/projects/' + p.dbId + '/terms', { body: { payment_agreement: AGREE_SRV[p.agreement], payment_method: METHOD_SRV[el.dataset.v] } }), 'Payment method updated.'); break;
            case 'reupload': {
                const pr = k === 'down' ? p.proof : p.finalProof; if (!pr) return;
                const reason = prompt('Why does the customer need to upload again? (sent to the customer)', 'The screenshot is not clear. Please upload a clearer copy.');
                if (!reason || !reason.trim()) return;
                act(() => api('/admin/payments/' + pr.paymentId + '/reject', { body: { reason: reason.trim() } }), 'Re-upload request sent to ' + p.customer); break;
            }
            case 'confirm': {
                const pr = k === 'down' ? p.proof : p.finalProof, due = k === 'down' ? dueNow(p) : balanceOf(p);
                if (!pr) return;
                if (Math.abs(pr.amount - due) > 0.009 && !confirm('The amount on the proof (' + peso(pr.amount) + ') differs from the amount due (' + peso(due) + '). Approve anyway?')) return;
                payConfirmed(p, pr.amount, k, pr.paymentId, false); break;
            }
            case 'cash': {
                const pay = k === 'down' ? p.down : p.fin, amt = round2(+$('#cashAmt').value);
                if (!pay) return;
                if (!(amt > 0)) return toast('Enter the amount received');
                if (Math.abs(amt - +pay.amount_due) > 0.009) return toast('The amount received must be exactly ' + peso(+pay.amount_due) + ' for this payment');
                payConfirmed(p, amt, k, +pay.payment_id, true); break;
            }
            case 'inst': {
                const v = el.dataset.v;
                if (v === 'Scheduled') return scheduleInstall(p);
                if (v === 'In progress') return act(() => api('/admin/projects/' + p.dbId + '/install', { body: { status: 'In progress' } }), 'Installation in progress');
                if (v === 'Completed') {
                    if (!p.checklist.every(c => c.state === 'Done') && !confirm('Some checklist items are not done yet. Mark all of them done and complete the installation?')) return;
                    act(() => api('/admin/projects/' + p.dbId + '/installation-complete', { body: {} })).then(ok => {
                        if (!ok) return;
                        const np = DB.projects.find(x => x.dbId === p.dbId); if (!np) return;
                        projStage = Math.min(stepIdx(np), 4); renderProjView();
                        toast(np.status === 'Done' ? 'Installation completed. Project is done.' : 'Installation completed. Final payment of ' + peso(balanceOf(np)) + ' is now due.');
                    });
                }
                break;
            }
            case 'check': {
                if (p.install !== 'In progress') return;
                const c = p.checklist[+el.dataset.i]; c.state = { Pending: 'In progress', 'In progress': 'Done', Done: 'Pending' }[c.state];
                renderProjView();
                api('/admin/projects/' + p.dbId + '/update', { body: { checklist: p.checklist } }).catch(err => toast(err.message));
                break;
            }
            case 'save': act(() => api('/admin/projects/' + p.dbId + '/update', { body: { checklist: p.checklist } }), 'Progress saved'); break;
            case 'rcview': projView = 'receipt'; projRc = el.dataset.no; renderProjView(); window.scrollTo(0, 0); break;
            case 'rcpdf': if (rc) receiptPDF(p, rc); break;
            case 'rcsend': if (rc) act(() => api('/admin/receipts/' + rc.paymentId + '/send', { body: {} }), 'Receipt № ' + rc.no + (rc.sent ? ' resent' : ' sent') + ' to ' + p.customer + '. It is in their Documents.'); break;
            case 'cert': projView = 'cert'; renderProjView(); window.scrollTo(0, 0); break;
            case 'doc': projView = 'doc'; projDoc = el.dataset.d; renderProjView(); window.scrollTo(0, 0); break;
            case 'docpdf': makePDF(docHTML(p, el.dataset.d), DOCS[el.dataset.d].file + '-' + p.id + '.pdf', 794, 1123, DOCS[el.dataset.d].page); break;
            case 'docprint': printHTML(docHTML(p, el.dataset.d)); break;
            case 'docsend': {
                const k = el.dataset.d, d = DOCS[k]; if (!d || k === 'inv') return;
                if (p.docsSent[k] && !confirm('Send the ' + d.title + ' again? It replaces the copy the customer already has.')) return;
                el.disabled = true;
                makePDF(docHTML(p, k), d.file + '-' + p.id + '.pdf', 794, 1123, true).then(blob => {
                    const fd = new FormData(); fd.append('kind', k); fd.append('pdf', blob, d.file + '-' + p.id + '.pdf');
                    return act(() => api('/admin/projects/' + p.dbId + '/documents', { form: fd }), d.title + ' saved and sent to ' + p.customer + '. It is in their Documents.');
                }).catch(err => toast(err.message || 'Could not build the PDF')).finally(() => { el.disabled = false; });
                break;
            }
            case 'ctrm': { const ph = p.cert.photos[+el.dataset.i]; if (ph) act(() => api('/admin/projects/' + p.dbId + '/certificate/photos/' + ph.id, { method: 'DELETE' })); break; }
            case 'ctpdf': makePDF(certDocHTML(p, p.cert), 'Certificate-' + p.id + '.pdf', 794, 1123, '.ct-page'); break;
            case 'ctsend': {
                if (!p.cert.photos.length) return toast('Add at least one installation photo before sending');
                const first = !p.cert.sent;
                act(async () => { await saveCert(p); await api('/admin/projects/' + p.dbId + '/certificate/send', { body: {} }); },
                    'Certificate, accomplishment report and ' + p.cert.photos.length + ' photo(s) ' + (first ? 'sent' : 'resent') + ' to ' + p.customer + '. They are in the customer\'s Documents.');
                break;
            }
        }
    });
    $('#projDetail').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.step-item[data-pj]')) { e.preventDefault(); e.target.click(); } });

    /* =========================================================
       Schedules
    ========================================================= */
    let schedDate = DB.bookings.filter(b => b.date >= TODAY).map(b => b.date).sort()[0] || TODAY;
    let schedPicker = null;

    function renderSchedule() {
        if (!schedPicker) schedPicker = Picker($('#schedCal'), { date: schedDate, allowAll: true, dots: true, onChange: d => { schedDate = d; renderDay(); } });
        else schedPicker.setDate(schedDate);
        renderDay(); renderRequests();
    }
    function availabilityEditor(times) {
        const missing = DEFAULT_SLOTS.filter(t => !times.includes(t));
        return '<div class="avail-edit"><span class="card-label-top">PUBLISH AN OPEN SLOT FOR THIS DAY</span><div class="avail-row"><input type="time" id="slotTime" step="300" aria-label="Slot start time"><button type="button" class="btn-primary-sm" data-s="add">Add slot</button></div>' +
            (missing.length ? '<div class="chip-row">' + missing.map(t => '<button type="button" class="chip" data-s="preset" data-t="' + t + '">+ ' + t + '</button>').join('') + '</div>' : '') +
            '<div class="avail-foot"><button type="button" class="btn-outline-sm" data-s="defaults">Use standard hours</button><button type="button" class="btn-outline-sm" data-s="clear">Clear open slots</button></div></div>';
    }
    function renderDay() {
        const list = DB.bookings.filter(b => b.date === schedDate), past = schedDate < TODAY, pub = slotsOf(schedDate);
        const times = sortTimes(Array.from(new Set(pub.concat(list.map(b => b.time)))));
        const open = pub.filter(t => !list.some(b => b.time === t)).length;
        $('#schedDay').innerHTML = '<div class="day-head"><h3>' + fmtLong(schedDate) + '</h3><span>' + list.length + ' booked \u00B7 ' + open + ' open</span></div>' +
            (times.map(t => { const b = list.find(x => x.time === t);
                return '<div class="slot-row"><span class="slot-time">' + t + '</span><div class="slot-body">' + (b ? esc(b.customer) + '<small>' + b.type + '</small>' : '<span class="slot-open">Open for booking</span>') + '</div>' +
                    (b ? '<span class="type-pill ' + typeCls(b.type) + '">' + b.type.toUpperCase() + '</span><button class="btn-xs" data-s="edit" data-id="' + b.id + '"><i class="fa-solid fa-pen"></i> Edit</button>'
                       : (past ? '' : '<button class="btn-xs" data-s="rm" data-t="' + t + '" title="Remove this open slot"><i class="fa-solid fa-xmark"></i> Remove</button>')) + '</div>'; }).join('') ||
                '<div class="empty-note">No slots published for this day. Customers cannot book it until you add some.</div>') +
            (past ? '<p class="slot-hint">This date has passed, so its availability can no longer be changed.</p>' : availabilityEditor(times));
    }
    $('#schedDay').addEventListener('click', e => {
        const b = e.target.closest('[data-s]'); if (!b) return;
        const a = b.dataset.s;
        if (a === 'edit') return editBooking(b.dataset.id);
        if (schedDate < TODAY) return;
        const cur = slotsOf(schedDate), date = schedDate;
        const send = (add, remove, msg) => act(() => api('/admin/availability', { body: { date, add, remove } }), msg);
        if (a === 'add') {
            const t = from24($('#slotTime').value);
            if (!t) return toast('Pick a start time first');
            if (cur.includes(t)) return toast(t + ' is already published for this day');
            return send([t], [], t + ' is now open for booking');
        }
        if (a === 'preset') return send([b.dataset.t], []);
        if (a === 'rm') return send([], [b.dataset.t], 'Slot removed');
        if (a === 'defaults') return send(DEFAULT_SLOTS, []);
        if (a === 'clear') return send([], cur, 'Open slots cleared. Booked slots were kept.');
    });
    function openBulk() {
        const start = schedDate > TODAY ? schedDate : TODAY;
        const chips = (cls, vals, label, on) => vals.map((v, i) => '<label class="chip-check"><input type="checkbox" class="' + cls + '" value="' + v + '"' + (on(v) ? ' checked' : '') + '><span>' + label(v, i) + '</span></label>').join('');
        openModal('<button class="mc-x" data-close aria-label="Close">&times;</button><h2>Set Availability</h2><p class="mc-sub">Publish open slots for many days at once. Slots that are already booked are never removed.</p>' +
            '<div class="mc-form"><div><label for="bkFrom">FROM</label><input class="mc-in" type="date" id="bkFrom" value="' + start + '"></div><div><label for="bkTo">TO</label><input class="mc-in" type="date" id="bkTo" value="' + shiftIso(start, 13) + '"></div>' +
            '<div class="full"><label>DAYS OF THE WEEK</label><div class="chip-row">' + chips('bk-dow', [1, 2, 3, 4, 5, 6, 0], v => DAYS[v], v => v !== 0) + '</div></div>' +
            '<div class="full"><label>TIME SLOTS</label><div class="chip-row" id="bkTimes">' + chips('bk-time', DEFAULT_SLOTS, v => v, () => true) + '</div><div class="avail-row"><input class="mc-in" type="time" id="bkCustom" aria-label="Custom time"><button type="button" class="mc-btn" data-m="bkaddtime">Add time</button></div></div>' +
            '<div class="full"><label for="bkMode">ACTION</label><select class="mc-in" id="bkMode"><option value="add">Add these slots (keep existing open slots)</option><option value="replace">Replace open slots with these</option><option value="clear">Remove open slots on these days</option></select></div></div>' +
            '<div class="mc-actions"><button class="mc-btn" data-close>Cancel</button><button class="mc-btn pri" data-m="bkapply">Apply</button></div>',
            e => {
                const m = e.target.closest('[data-m]'); if (!m) return;
                if (m.dataset.m === 'bkaddtime') {
                    const t = from24($('#bkCustom').value); if (!t) return toast('Pick a time to add');
                    if ($$('.bk-time').some(c => c.value === t)) return toast(t + ' is already in the list');
                    $('#bkTimes').insertAdjacentHTML('beforeend', '<label class="chip-check"><input type="checkbox" class="bk-time" value="' + t + '" checked><span>' + t + '</span></label>');
                    $('#bkCustom').value = ''; return;
                }
                if (m.dataset.m !== 'bkapply') return;
                const from = $('#bkFrom').value, to = $('#bkTo').value, mode = $('#bkMode').value;
                const dows = $$('.bk-dow').filter(c => c.checked).map(c => +c.value), times = $$('.bk-time').filter(c => c.checked).map(c => c.value);
                if (!from || !to) return toast('Choose a start and end date');
                if (from > to) return toast('The end date must be on or after the start date');
                if ((toDate(to) - toDate(from)) / 864e5 > 366) return toast('Please keep the range to one year or less');
                if (!dows.length) return toast('Pick at least one day of the week');
                if (mode !== 'clear' && !times.length) return toast('Pick at least one time slot');
                let n = 0;
                act(async () => { n = (await api('/admin/availability/bulk', { body: { from, to, dows, times, mode } })).days; })
                    .then(ok => { if (ok) { closeModal(); toast('Availability updated for ' + n + ' day(s)'); } });
            });
    }
    $('#bulkAvail').addEventListener('click', openBulk);

    function renderRequests() {
        const reqs = DB.requests.filter(r => (r.status === 'Pending' || r.status === 'Counter Sent') && bookingById(r.bookingId));
        const up = DB.bookings.filter(b => b.date >= TODAY).sort((a, b) => (a.date + pad(t2m(a.time), 4)).localeCompare(b.date + pad(t2m(b.time), 4))).slice(0, 6);
        const change = '<span class="section-top-label" style="margin-top:8px">CHANGE SCHEDULE</span><div class="alert-card border-blue"><p class="alert-desc">Move an upcoming site visit or installation to another published slot. The customer is notified of the new date.</p>' +
            (up.map(b => '<div class="cs-row"><div><b>' + esc(b.customer) + '</b><small>' + b.type + ' \u00B7 ' + fmtDate(b.date) + ', ' + b.time + '</small></div><button class="btn-outline-sm" data-r="change" data-id="' + b.id + '">Change</button></div>').join('') || '<p class="alert-desc" style="margin:0">No upcoming bookings.</p>') + '</div>';
        $('#schedReq').innerHTML = '<span class="section-top-label">RESCHEDULE REQUESTS</span>' + (reqs.map(r => {
            const b = bookingById(r.bookingId);
            if (r.status === 'Pending') return '<div class="alert-card border-red"><div class="alert-header-row"><span class="alert-title text-red">SCHEDULE CHANGE</span><span class="alert-time">' + r.ago + '</span></div><p class="alert-desc">' + esc(b.customer) + ' moved the ' + b.type + ' from <b>' + fmtDate(r.oldDate) + ', ' + r.oldTime + '</b> to <b>' + fmtDate(r.newDate) + ', ' + r.newTime + '</b>. Approve it, or propose another time.</p>' +
                '<div class="alert-actions"><button class="btn-primary-sm" data-r="approve" data-id="' + r.id + '">Approve</button><button class="btn-outline-sm" data-r="negotiate" data-id="' + r.id + '">Negotiate</button><button class="btn-outline-sm" data-r="details" data-id="' + r.id + '">Details</button></div></div>';
            return '<div class="alert-card border-blue"><div class="alert-header-row"><span class="alert-title text-blue">COUNTER-PROPOSAL SENT</span><span class="alert-time">waiting</span></div><p class="alert-desc">Proposed <b>' + fmtDate(r.proposed.date) + ', ' + r.proposed.time + '</b> to ' + esc(b.customer) + '. Waiting for their reply.</p>' +
                '<div class="alert-actions"><button class="btn-outline-sm" data-r="details" data-id="' + r.id + '">Details</button><button class="btn-link" data-r="accepted" data-id="' + r.id + '" title="Stands in for the customer\'s reply until the backend is connected">Customer accepted</button></div></div>';
        }).join('') || '<div class="alert-card border-green"><p class="alert-desc" style="margin:0">No pending reschedule requests.</p></div>') + change;
    }
    $('#schedReq').addEventListener('click', e => {
        const b = e.target.closest('[data-r]'); if (!b) return;
        if (b.dataset.r === 'change') return editBooking(b.dataset.id);
        const r = DB.requests.find(x => x.id === b.dataset.id); if (!r) return;
        if (b.dataset.r === 'approve') approveRequest(r);
        if (b.dataset.r === 'details') requestDetails(r);
        if (b.dataset.r === 'negotiate') negotiate(r);

    });
    /* keep the linked inquiry's preferred date in sync when a booking moves */
    function moveBooking(b, date, time) {
        b.date = date; b.time = time;
        const iq = b.inqId && DB.inquiries.find(i => i.id === b.inqId);
        if (iq && iq.siteVisit) iq.pref = { date, time };
    }
    function approveRequest(r) {
        const b = bookingById(r.bookingId);
        closeModal(); schedDate = b.date;
        act(() => api('/admin/schedules/' + b.sid + '/confirm', { body: {} }), 'Reschedule approved for ' + b.customer + '. The customer was notified.');
    }
    function requestDetails(r) {
        const b = bookingById(r.bookingId), f = (l, v, full) => '<div' + (full ? ' class="mc-full"' : '') + '><label>' + l + '</label><b>' + v + '</b></div>';
        openModal('<button class="mc-x" data-close aria-label="Close">&times;</button><h2>Reschedule Details</h2><p class="mc-sub">' + esc(b.customer) + ' \u2022 ' + b.type + ' \u2022 requested ' + r.ago + '</p><div class="mc-grid">' +
            f('PREVIOUS SCHEDULE', fmtDate(r.oldDate) + ' \u2022 ' + r.oldTime) + f('REQUESTED NEW SCHEDULE', fmtDate(r.newDate) + ' \u2022 ' + r.newTime) +
            f('REASON FOR RESCHEDULING', esc(r.reason), true) + f('STATUS', r.status === 'Counter Sent' ? 'Counter-proposal sent' : r.status) + (r.proposed ? f('YOUR PROPOSAL', fmtDate(r.proposed.date) + ' \u2022 ' + r.proposed.time) : '') + '</div>' +
            (r.status === 'Pending' ? '<div class="mc-actions"><button class="mc-btn" data-m="negotiate">Negotiate</button><button class="mc-btn pri" data-m="approve">Approve</button></div>' : ''),
            e => { const m = e.target.closest('[data-m]'); if (!m) return; if (m.dataset.m === 'approve') approveRequest(r); else negotiate(r); });
    }
    function negotiate(r) {
        const b = bookingById(r.bookingId); let sel = { date: '', time: '' };
        const h = openModal('<button class="mc-x" data-close aria-label="Close">&times;</button><h2>Propose a New Schedule</h2><p class="mc-sub">' + esc(b.customer) + ' \u2022 ' + b.type + '</p>' +
            '<div class="mc-note">Customer asked for <b>' + fmtDate(r.newDate) + ', ' + r.newTime + '</b>. Pick the date and time you can offer instead.</div><div id="negCal"></div>' +
            '<div class="mc-note">The booking moves to the time you pick and the customer is notified.</div><div class="mc-actions"><button class="mc-btn" data-close>Cancel</button><button class="mc-btn pri" data-m="send">Send to Customer</button></div>',
            e => {
                if (!e.target.closest('[data-m="send"]')) return;
                if (!sel.date || !sel.time) return toast('Choose a date and a time slot first');
                closeModal(); schedDate = sel.date;
                act(() => api('/admin/schedules/' + b.sid + '/reschedule', { body: { date: sel.date, slot: sel.time, note: 'Proposed by BeyondWires', notify: true } }),
                    'New schedule sent to ' + b.customer + ': ' + fmtDate(sel.date) + ', ' + sel.time);
            });
        Picker($('#negCal', h), { date: '', exclude: b.id, times: true, onChange: (d, t) => { sel = { date: d, time: t }; } });
    }
    function editBooking(id) {
        const b = bookingById(id); if (!b) return; let sel = { date: b.date, time: b.time };
        const h = openModal('<button class="mc-x" data-close aria-label="Close">&times;</button><h2>Change Schedule</h2><p class="mc-sub">' + esc(b.customer) + ' \u2022 ' + b.type + ' \u2022 currently ' + fmtDate(b.date) + ', ' + b.time + '</p><div id="editCal"></div>' +
            '<label style="margin-top:18px">REASON FOR CHANGE (OPTIONAL)</label><textarea id="editReason" placeholder="e.g. Crew unavailable, travel conflict..."></textarea>' +
            '<label class="mc-check"><input type="checkbox" id="editNotify" checked> Notify the customer about this change</label>' +
            '<div class="mc-actions"><button class="mc-btn" data-close>Cancel</button><button class="mc-btn pri" data-m="save">Save Changes</button></div>',
            e => {
                if (!e.target.closest('[data-m="save"]')) return;
                if (!sel.date || !sel.time) return toast('Choose a date and a time slot');
                const notify = $('#editNotify').checked, note = $('#editReason').value.trim();
                closeModal(); schedDate = sel.date;
                act(() => api('/admin/schedules/' + b.sid + '/reschedule', { body: { date: sel.date, slot: sel.time, note, notify } }), 'Schedule updated' + (notify ? ' and customer notified' : ''));
            });
        Picker($('#editCal', h), { date: b.date, time: b.time, exclude: b.id, times: true, onChange: (d, t) => { sel = { date: d, time: t }; } });
    }

    /* =========================================================
       Products & pricing
       Quotations store the price each line had when it was created, so a price
       change here never alters an existing quotation.
    ========================================================= */
    const TYPE_LABEL = { product: 'Product', service: 'Service', package: 'Package' };
    function renderProducts() {
        const catSel = $('#pdCat'), keep = catSel.value || 'all', tyF = $('#pdType').value;
        const supSel = $('#pdSup'), sp = supSel.value || 'all';
        supSel.innerHTML = supOptions(DB.catalog.filter(c => tyF === 'all' || c.type === tyF), sp, 'All Suppliers');
        if (supSel.value !== sp) supSel.value = 'all';
        catSel.innerHTML = '<option value="all">All Categories</option>' + catList(true, tyF, supSel.value).map(c => '<option value="' + esc(c) + '"' + (c === keep ? ' selected' : '') + '>' + esc(c) + '</option>').join('');
        const s = $('#pdSearch').value.trim().toLowerCase(), ty = $('#pdType').value, ct = catSel.value, sh = $('#pdShow').value;
        const rows = DB.catalog.filter(c => (ty === 'all' || c.type === ty) && (ct === 'all' || c.cat === ct) && supMatch(c, supSel.value) && (sh === 'all' || (sh === 'archived') === !!c.archived) &&
            (!s || (c.name + ' ' + (c.cat || '') + ' ' + (c.desc || '') + ' ' + (c.supplier || '')).toLowerCase().includes(s)));
        $('#pdTable').innerHTML = '<table><thead><tr><th>ITEM</th><th>TYPE</th><th>CATEGORY</th><th>SUPPLIER</th><th>PRICE</th><th>UPDATED</th><th class="text-right">ACTIONS</th></tr></thead><tbody>' +
            (rows.map(c => { const last = c.history[0];
                return '<tr data-id="' + c.id + '"' + (c.archived ? ' class="pd-arch"' : '') + '><td><div class="pd-item"><div class="pd-ico"><i class="fa-solid ' + esc(c.icon || TYPE_ICON[c.type]) + '"></i></div><div><span>' + esc(c.name) + '</span><small class="cust-sub">' + esc(c.desc || c.cat || '') + '</small></div></div></td>' +
                    '<td><span class="badge blue">' + TYPE_LABEL[c.type] + '</span></td><td>' + esc(c.cat || '\u2014') + '</td><td>' + esc(c.supplier || '\u2014') + '</td>' +
                    '<td><b>' + (c.price ? peso(c.price) : 'Free') + '</b>' + (last ? '<small class="pd-was">was ' + peso(last.from) + '</small>' : '') + '</td><td class="date-col">' + (c.updated ? fmtDate(c.updated) : '\u2014') + '</td>' +
                    '<td class="actions-col"><button class="btn-accept" data-a="price">Edit price</button><button class="btn-details" data-a="edit" style="margin-right:6px">Edit</button><button class="btn-details" data-a="arch" title="' + (c.archived ? 'Show in the quotation builder again' : 'Archive or delete this item') + '">' + (c.archived ? 'Restore' : 'Archive') + '</button></td></tr>'; }).join('') ||
                '<tr><td colspan="7" class="empty-row">No items match these filters.</td></tr>') + '</tbody></table>';
    }
    ['#pdSearch', '#pdType', '#pdSup', '#pdCat', '#pdShow'].forEach(sel => $(sel).addEventListener(sel === '#pdSearch' ? 'input' : 'change', renderProducts));
    $('#pdAdd').addEventListener('click', () => openItemModal(null));
    $('#pdTable').addEventListener('click', e => {
        const b = e.target.closest('button[data-a]'); if (!b) return;
        const c = DB.catalog.find(x => x.id === b.closest('tr').dataset.id);
        if (b.dataset.a === 'price') return openPriceModal(c);
        if (b.dataset.a === 'edit') return openItemModal(c);
        if (c.archived) return act(() => api('/admin/products/' + c.id + '/archive', { body: { archived: false } }), c.name + ' restored to the quotation builder.');
        confirmArchive(c);
    });
    /* "Are you sure?" before an item is archived or deleted */
    function confirmArchive(c) {
        openModal('<button class="mc-x" data-close aria-label="Close">&times;</button><h2>Archive this item?</h2><p class="mc-sub">' + esc(c.name) + ' \u2022 ' + peso(c.price) + '</p>' +
            '<div class="mc-note"><b>Archive</b> hides the item from the quotation builder. You can restore it any time (Show: Archived).<br><b>Delete</b> removes it from the catalog permanently.<br>Existing quotations are not affected either way.</div>' +
            '<div class="mc-actions"><button class="mc-btn" data-close>Cancel</button><button class="mc-btn danger" data-m="del">Delete permanently</button><button class="mc-btn pri" data-m="arch">Yes, archive</button></div>',
            e => {
                const m = e.target.closest('[data-m]'); if (!m) return;
                if (m.dataset.m === 'arch') { closeModal(); return act(() => api('/admin/products/' + c.id + '/archive', { body: { archived: true } }), c.name + ' archived. It no longer appears in the quotation builder or to customers.'); }
                if (m.dataset.m === 'del') {
                    if (!confirm('Delete ' + c.name + ' permanently? This cannot be undone.')) return;
                    closeModal(); act(() => api('/admin/products/' + c.id, { method: 'DELETE' }), c.name + ' deleted from the catalog');
                }
            });
    }
    function applyPrice(c, np, note) {
        if (np === c.price) return false;
        c.history.unshift({ date: TODAY, from: c.price, to: np, note: note || '' }); c.history = c.history.slice(0, 20);
        c.price = np; c.updated = TODAY; return true;
    }
    function openPriceModal(c) {
        openModal('<button class="mc-x" data-close aria-label="Close">&times;</button><h2>Update Price</h2><p class="mc-sub">' + esc(c.name) + ' \u2022 current price ' + peso(c.price) + '</p>' +
            '<div class="mc-form"><div class="full"><label for="pdNewPrice">NEW PRICE (\u20B1)</label><input class="mc-in" type="number" id="pdNewPrice" min="0.01" max="' + PRICE_MAX + '" step="0.01" value="' + c.price + '"><small class="st-hint" style="color:#64748b">Must be more than \u20B10 and no more than ' + peso(PRICE_MAX) + '.</small></div>' +
            '<div class="full"><label for="pdReason">NOTE (OPTIONAL)</label><input class="mc-in" type="text" id="pdReason" maxlength="120" placeholder="e.g. Supplier price increase"></div></div>' +
            '<div class="mc-note" style="margin:16px 0 0">Existing quotations keep the price they were created with. Only new line items use the updated price.</div>' +
            '<div class="mc-actions"><button class="mc-btn" data-close>Cancel</button><button class="mc-btn pri" data-m="save">Save price</button></div>',
            e => {
                if (!e.target.closest('[data-m="save"]')) return;
                const raw = $('#pdNewPrice').value, err = priceIssue(raw);
                if (err) return toast(err);
                const np = round2(+raw);
                if (np === c.price) return toast('The price is unchanged');
                const note = $('#pdReason').value.trim(); closeModal();
                act(() => api('/admin/products/' + c.id + '/price', { body: { unit_price: np, note } }), c.name + ' is now ' + peso(np));
            });
        const i = $('#pdNewPrice'); if (i) { i.focus(); i.select(); }
    }
    function openItemModal(c) {
        const isNew = !c, tf = $('#pdType').value;
        const it = c || { type: tf !== 'all' ? tf : 'product', cat: '', price: '', name: '', desc: '', supplier: '' };
        const catOptsFor = (type, cur) => {
            const cats = catList(true, type), sel = cur && cats.includes(cur) ? cur : (type === 'product' ? (cats[0] || '__new') : '');
            return (type === 'product' ? '' : '<option value=""' + (sel === '' ? ' selected' : '') + '>No category</option>') +
                cats.map(x => '<option value="' + esc(x) + '"' + (x === sel ? ' selected' : '') + '>' + esc(x) + '</option>').join('') +
                '<option value="__new"' + (sel === '__new' ? ' selected' : '') + '>+ New category...</option>';
        };
        const catOpts = catOptsFor(it.type, it.cat), sel = /value="__new" selected/.test(catOpts) ? '__new' : 'x';
        const hist = c && c.history.length ? '<div class="full"><label>PRICE HISTORY</label><div class="mc-hist">' + c.history.slice(0, 6).map(h => '<div><span>' + fmtDate(h.date) + (h.note ? ' \u2022 ' + esc(h.note) : '') + '</span><b>' + peso(h.from) + ' \u2192 ' + peso(h.to) + '</b></div>').join('') + '</div></div>' : '';
        openModal('<button class="mc-x" data-close aria-label="Close">&times;</button><h2>' + (isNew ? 'Add Item' : 'Edit Item') + '</h2><p class="mc-sub">' + (isNew ? 'New items appear in the quotation builder right away.' : esc(c.id)) + '</p>' +
            '<div class="mc-form"><div class="full"><label for="pdName">NAME</label><input class="mc-in" type="text" id="pdName" maxlength="80" value="' + esc(it.name) + '" placeholder="e.g. Dahua 4MP Turret Camera"></div>' +
            '<div><label for="pdItemType">TYPE</label><select class="mc-in" id="pdItemType"><option value="product"' + (it.type === 'product' ? ' selected' : '') + '>Product</option><option value="service"' + (it.type === 'service' ? ' selected' : '') + '>Service</option><option value="package"' + (it.type === 'package' ? ' selected' : '') + '>Package</option></select></div>' +
            '<div><label for="pdPrice">PRICE (\u20B1)</label><input class="mc-in" type="number" id="pdPrice" min="0.01" max="' + PRICE_MAX + '" step="0.01" value="' + it.price + '"></div>' +
            '<div class="full" id="pdCatRow"><label for="pdCatSel">CATEGORY' + (it.type === 'product' ? '' : ' (OPTIONAL)') + '</label><select class="mc-in" id="pdCatSel">' + catOpts + '</select><input class="mc-in" type="text" id="pdCatNew" maxlength="40" placeholder="New category name" style="margin-top:8px;' + (sel === '__new' ? '' : 'display:none') + '"></div>' +
            '<div class="full"><label for="pdSupplier">SUPPLIER (OPTIONAL)</label><input class="mc-in" type="text" id="pdSupplier" maxlength="60" value="' + esc(it.supplier || '') + '" list="pdSupList" placeholder="Pick a supplier or type a new one"><datalist id="pdSupList">' + supList(DB.catalog).map(x => '<option value="' + esc(x) + '">').join('') + '</datalist></div>' +
            '<div class="full"><label for="pdDesc">DESCRIPTION (OPTIONAL)</label><textarea class="mc-in" id="pdDesc" maxlength="160">' + esc(it.desc || '') + '</textarea></div>' + hist + '</div>' +
            '<div class="mc-actions"><button class="mc-btn" data-close>Cancel</button><button class="mc-btn pri" data-m="save">' + (isNew ? 'Add item' : 'Save changes') + '</button></div>',
            e => {
                if (!e.target.closest('[data-m="save"]')) return;
                const name = $('#pdName').value.trim(), type = $('#pdItemType').value, raw = $('#pdPrice').value;
                if (!name) return toast('Enter a name for the item');
                const err = priceIssue(raw); if (err) return toast(err);
                const price = round2(+raw);
                if (DB.catalog.some(x => x.id !== (c && c.id) && x.name.toLowerCase() === name.toLowerCase())) return toast('An item with that name already exists');
                const cat = $('#pdCatSel').value === '__new' ? $('#pdCatNew').value.trim() : $('#pdCatSel').value;
                if (type === 'product' && !cat) return toast('Choose a category or enter a new one');
                if ($('#pdCatSel').value === '__new' && !cat) return toast('Enter the new category name');
                const body = { name, item_type: type, category: cat || '', supplier: $('#pdSupplier').value.trim(), description: $('#pdDesc').value.trim(), unit_price: price, icon: CAT_ICON[cat] || TYPE_ICON[type] };
                closeModal();
                if (isNew) act(() => api('/admin/products', { body }), name + ' added to the catalog. Customers can choose it now.');
                else act(() => api('/admin/products/' + c.id, { method: 'PUT', body }), name + ' updated');
            });
    }
    $('#modalHost').addEventListener('change', e => {
        const t = e.target;
        if (t.id === 'pdItemType') {
            const cs = $('#pdCatSel'); cs.innerHTML = (t.value === 'product' ? '' : '<option value="">No category</option>') +
                catList(true, t.value).map(x => '<option value="' + esc(x) + '">' + esc(x) + '</option>').join('') + '<option value="__new">+ New category...</option>';
            $('#pdCatNew').style.display = cs.value === '__new' ? '' : 'none';
        }
        if (t.id === 'pdCatSel') $('#pdCatNew').style.display = t.value === '__new' ? '' : 'none';
    });

    /* =========================================================
       Settings (theme / profile / password)
    ========================================================= */
    function setStatus(dirty, text) {
        $('#stStatus').classList.toggle('dirty', dirty);
        $('#stStatus i').className = 'fa-solid ' + (dirty ? 'fa-circle-exclamation' : 'fa-circle-check');
        $('#stStatusText').textContent = text;
    }
    const savedTheme = () => store.get('bw_admin_theme', 'light') === 'dark' ? 'dark' : 'light';   // Light Mode unless the admin saved Dark
    let pendingTheme = savedTheme();
    function renderThemeButtons() {
        $$('.st-theme').forEach(b => {
            const t = b.dataset.themeOpt;
            b.classList.toggle('selected', t === pendingTheme); b.classList.toggle('is-active', t === savedTheme());
            b.setAttribute('aria-pressed', t === pendingTheme ? 'true' : 'false');
        });
    }
    $$('.st-theme').forEach(b => b.addEventListener('click', () => {
        pendingTheme = b.dataset.themeOpt; renderThemeButtons();
        const dirty = pendingTheme !== savedTheme(); setStatus(dirty, dirty ? 'Unsaved theme change' : 'All settings up to date');
    }));
    $('#stSaveTheme').addEventListener('click', () => {
        store.set('bw_admin_theme', pendingTheme); document.documentElement.setAttribute('data-theme', pendingTheme);
        renderThemeButtons(); setStatus(false, 'All settings up to date'); toast((pendingTheme === 'light' ? 'Light' : 'Dark') + ' theme saved');
    });

    const profile = { name: ME.name, email: ME.email };   // saved on the server (Settings > Account)
    const nameIn = $('#stFullName'), emailIn = $('#stEmail');
    function fieldError(input, errId, msg) { $('#' + errId).textContent = msg || ''; input.closest('.st-input').classList.toggle('invalid', !!msg); return !msg; }
    const validName = () => fieldError(nameIn, 'stFullNameErr', nameIn.value.trim().length < 2 ? 'Please enter your full name.' : '');
    const validEmail = () => fieldError(emailIn, 'stEmailErr', /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailIn.value.trim()) ? '' : 'Please enter a valid email address.');
    function saveProfile() {
        const ok = validName() & validEmail(); if (!ok) return;
        const next = { name: nameIn.value.trim(), email: emailIn.value.trim() };
        if (next.name === profile.name && next.email === profile.email) return;
        api('/auth/profile', { body: { full_name: next.name, email: next.email } })
            .then(() => { Object.assign(profile, next); $('#top-name').textContent = profile.name; toast('Profile saved'); })
            .catch(err => fieldError(/email/i.test(err.message) ? emailIn : nameIn, /email/i.test(err.message) ? 'stEmailErr' : 'stFullNameErr', err.message));
    }
    nameIn.value = profile.name; emailIn.value = profile.email; $('#top-name').textContent = profile.name;
    nameIn.addEventListener('blur', saveProfile); emailIn.addEventListener('blur', saveProfile);
    nameIn.addEventListener('input', () => fieldError(nameIn, 'stFullNameErr', ''));
    emailIn.addEventListener('input', () => fieldError(emailIn, 'stEmailErr', ''));
    $('#stProfileForm').addEventListener('submit', e => { e.preventDefault(); saveProfile(); });

    const EYE = '<svg viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
    const EYE_OFF = '<svg viewBox="0 0 24 24"><path d="M17.9 17.9A10.9 10.9 0 0112 19c-7 0-11-7-11-7a19.8 19.8 0 015.1-5.9M9.9 5.1A10.4 10.4 0 0112 5c7 0 11 7 11 7a19.8 19.8 0 01-3.2 4.2M1 1l22 22"/></svg>';
    $$('.st-eye').forEach(btn => {
        btn.innerHTML = EYE;
        btn.addEventListener('click', () => {
            const input = document.getElementById(btn.dataset.target), show = input.type === 'password';
            input.type = show ? 'text' : 'password'; btn.innerHTML = show ? EYE_OFF : EYE; btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        });
    });
    $('#stPwForm').addEventListener('submit', e => {
        e.preventDefault();
        const cur = $('#stCurPw'), nw = $('#stNewPw'), cf = $('#stConfPw'); let ok = true;
        ok = fieldError(cur, 'stCurPwErr', cur.value ? '' : 'Enter your current password.') && ok;
        let m = ''; if (nw.value.length < 8) m = 'Use at least 8 characters.'; else if (!/\d/.test(nw.value)) m = 'Include at least one number.'; else if (nw.value === cur.value) m = 'New password must differ from the current one.';
        ok = fieldError(nw, 'stNewPwErr', m) && ok;
        ok = fieldError(cf, 'stConfPwErr', cf.value === nw.value && cf.value ? '' : 'Passwords do not match.') && ok;
        if (!ok) return;
        const form = e.target;
        api('/auth/password', { body: { current_password: cur.value, new_password: nw.value, confirm_password: cf.value } })
            .then(() => { form.reset(); $$('.st-eye').forEach(b => { document.getElementById(b.dataset.target).type = 'password'; b.innerHTML = EYE; }); toast('Password changed successfully'); })
            .catch(err => fieldError(err.status === 403 ? cur : nw, err.status === 403 ? 'stCurPwErr' : 'stNewPwErr', err.message));
    });
    ['stCurPw', 'stNewPw', 'stConfPw'].forEach(id => document.getElementById(id).addEventListener('input', () => fieldError(document.getElementById(id), id + 'Err', '')));

    /* =========================================================
       Refresh + init
    ========================================================= */
    function refreshAll() {
        renderDashboard(); renderInquiries(); renderQuoteList(); renderProjects(); renderSchedule(); renderProducts(); renderNotifs();
    }
    /* pick up changes made elsewhere (customers booking, the superadmin approving) when this tab is used again */
    let lastSync = Date.now();
    window.addEventListener('focus', () => { if (Date.now() - lastSync > 30000 && !B && $('#modalHost').style.display !== 'flex') { lastSync = Date.now(); act(() => null); } });
    /* the mouse wheel never changes a number box (quantity, price, workers, days...): it only scrolls the page */
    document.addEventListener('wheel', e => { if (e.target.type === 'number' && e.target === document.activeElement) e.target.blur(); }, { passive: true });
    setSidebar(!!store.get('bw_admin_sidebar', false));
    renderThemeButtons();
    activateTab(location.hash.slice(1) || 'dashboard');
})();


/* ===== Shared: date limits (2026 to 2028) + mobile drawer ===== */
(function () {
  'use strict';
  const MIN = '2026-01-01', MAX = '2028-12-31', MN = 2026, MX = 2028;
  const MON = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  function toast(msg) {
    const t = document.createElement('div'); t.className = 'bw-toast'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 2800);
  }
  const limitInputs = () => document.querySelectorAll('input[type=date]').forEach(i => { i.min = MIN; i.max = MAX; });
  limitInputs();
  document.addEventListener('change', e => {
    const i = e.target;
    if (i.type === 'date' && i.value && (i.value < MIN || i.value > MAX)) { i.value = ''; toast('Please choose a date from 2026 to 2028.'); }
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