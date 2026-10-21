/* =====================================================================
   BeyondWires — LandingPage.js  (all landing page behaviour)
   Load AFTER LandingPageData.js:
     <script src="LandingPageData.js" defer></script>
     <script src="LandingPage.js" defer></script>

   PART A. Site basics
     1. Theme toggle (dark / light)
     2. Account sidebars (hero, open from the right) + fallback modal
     3. Login / Create account / CTA consultation button
     3B. Hidden Admin / Super Admin sign in (10 logo clicks)
     4. Smooth scroll buttons ([data-scroll])
     5. (Products: see PART D)
     6. FAQ accordion + footer year
     7. Services cards: cursor glow + touch press
     8. Padlock: replay on click + pointer tilt
   PART B. Our Works gallery + project detail
   PART C. Shared information window (BWDetailModal) — Products + Packages
   PART D. Our Products catalog
   PART E. Packages
   Content (projects, products, packages) lives in LandingPageData.js.
   ===================================================================== */

/* ---------------------------------------------------------------------
   PART A. SITE BASICS
   --------------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", function () {
  const html = document.documentElement;

  /* =========================
     1. DARK / LIGHT MODE
     ========================= */
  const themeToggleBtn = document.getElementById("themeToggle");
  const themeIcon = document.getElementById("themeIcon");

  function applyTheme(theme) {
    const dark = theme === "dark";
    html.classList.toggle("dark-theme", dark);
    // The last block of LandingPage.css reads [data-theme], so keep it in sync
    html.setAttribute("data-theme", dark ? "dark" : "light");
    if (themeIcon) themeIcon.textContent = dark ? "light_mode" : "dark_mode";
  }

  let savedTheme = "light";
  try { savedTheme = localStorage.getItem("theme") || "light"; } catch (e) {}
  applyTheme(savedTheme);

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", function () {
      const next = html.classList.contains("dark-theme") ? "light" : "dark";
      applyTheme(next);
      try { localStorage.setItem("theme", next); } catch (e) {}
    });
  }

  /* =========================
     2. ACCOUNT SIDEBAR + MODAL
     ========================= */
  const hero = document.querySelector(".hero");
  const panel = document.getElementById("accountPanel");
  const scrim = document.getElementById("panelScrim");
  const panelClose = document.getElementById("panelClose");
  const accountBtn = document.getElementById("accountBtn");
  const footerAccount = document.getElementById("footerAccount");
  const adminPanel = document.getElementById("adminPanel");
  const adminClose = document.getElementById("adminPanelClose");
  let activePanel = null;   // the sidebar that is open right now (customer or staff)
  let swapTimer = null;     // pending "close one, then open the other"
  const SWAP_MS = 700;      // a little longer than the slide-out
  const overlayMq = window.matchMedia("(max-width: 900px)");

  const accountModal = document.getElementById("accountModal");
  const modalClose = document.getElementById("modalClose");
  const modalBackdrop = accountModal ? accountModal.querySelector(".modal-backdrop") : null;

  const isPanelOpen = () => !!hero && hero.classList.contains("panel-open");

  // Opens / closes a sidebar. `target` is the customer panel (default) or the
  // staff panel. Only one sidebar is ever open: asking for the other one closes
  // the current one first, so the two never overlap.
  function setPanelOpen(open, target) {
    if (!hero || !panel) return;
    clearTimeout(swapTimer);
    const which = open ? (target || panel) : (activePanel || panel);

    if (open && activePanel && activePanel !== which) {
      setPanelOpen(false);
      swapTimer = setTimeout(() => setPanelOpen(true, which), SWAP_MS);
      return;
    }

    [panel, adminPanel].forEach((p) => {
      if (!p) return;
      const on = open && p === which;
      p.classList.toggle("is-active", on);
      p.setAttribute("aria-hidden", String(!on));
      p.inert = !on;
    });
    activePanel = open ? which : null;
    const staff = which === adminPanel;

    hero.classList.toggle("panel-open", open);
    hero.classList.toggle("admin-open", open && staff);
    if (accountBtn) accountBtn.setAttribute("aria-expanded", String(open && !staff));
    document.body.classList.toggle("panel-lock", open && overlayMq.matches);

    if (open) {
      const closeBtn = staff ? adminClose : panelClose;
      if (closeBtn) setTimeout(() => closeBtn.focus({ preventScroll: true }), 400);
    } else if (accountBtn && !staff) {
      accountBtn.focus({ preventScroll: true });
    }
  }

  // Fallback modal (used only if the sidebar is missing from the page)
  function openAccountModal() {
    if (!accountModal) return;
    accountModal.classList.add("show");
    accountModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeAccountModal() {
    if (!accountModal) return;
    accountModal.classList.remove("show");
    accountModal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  if (panel) panel.inert = true;
  if (adminPanel) adminPanel.inert = true;

  if (accountBtn) {
    accountBtn.addEventListener("click", function (e) {
      e.preventDefault();
      if (panel) setPanelOpen(!(isPanelOpen() && activePanel === panel), panel);
      else openAccountModal();
    });
  }

  if (footerAccount) {
    footerAccount.addEventListener("click", function (e) {
      e.preventDefault();
      if (!panel) { openAccountModal(); return; }
      [document.getElementById("loginForm"), document.getElementById("signupForm")].forEach((f) => { if (f) f.reset(); });
      if (window.scrollY > 40) {
        window.scrollTo({ top: 0, behavior: "smooth" });
        setTimeout(() => setPanelOpen(true), 500);
      } else {
        setPanelOpen(true);
      }
    });
  }

  if (panelClose) panelClose.addEventListener("click", () => setPanelOpen(false));
  // When the sidebar closes, reset it to the welcome view (after the slide-out)
  if (panel) panel.addEventListener("transitionend", (e) => {
    if (e.target === panel && !isPanelOpen() && typeof showView === "function") showView("home");
  });
  if (adminClose) adminClose.addEventListener("click", () => setPanelOpen(false));
  if (scrim) scrim.addEventListener("click", () => setPanelOpen(false));
  if (modalClose) modalClose.addEventListener("click", closeAccountModal);
  if (modalBackdrop) modalBackdrop.addEventListener("click", closeAccountModal);

  // Release the scroll lock if the window is resized wider than 900px
  overlayMq.addEventListener("change", () => {
    document.body.classList.toggle("panel-lock", isPanelOpen() && overlayMq.matches);
  });

  // ESC closes whichever is open (customer or staff sidebar)
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (isPanelOpen() || swapTimer) setPanelOpen(false);
    closeAccountModal();
  });

  /* =========================
     3. LOGIN / CREATE ACCOUNT (inside the account sidebar)
     -------------------------
     The sidebar is the only login + create account interface. Validations
     (the server checks the same rules):
       - names: letters and spaces only
       - Gmail: 6-30 letters, numbers or periods before @gmail.com,
         no leading / trailing / double periods
       - password: at least 8 characters including a number
     ========================= */
  const panelTitle = document.getElementById("panelTitle");
  const panelBack = document.getElementById("panelBack");
  const views = panel ? Array.from(panel.querySelectorAll(".panel-view")) : [];
  const signupForm = document.getElementById("signupForm");
  const loginForm = document.getElementById("loginForm");
  const signupNotice = document.getElementById("signupNotice");
  const loginNotice = document.getElementById("loginNotice");
  const verifyForm = document.getElementById("verifyForm");
  const verifyNotice = document.getElementById("verifyNotice");
  const VIEW_TITLE = { home: "ACCOUNT", login: "LOG IN", signup: "CREATE ACCOUNT", verify: "VERIFY EMAIL" };
  const VIEW_FOCUS = { login: "loginEmail", signup: "firstName", verify: "verifyCode" };

  // Accounts are created and checked by the server (api/auth.php). The page only
  // pre-checks the same rules so mistakes show right away; nothing is stored here.
  const busy = (form, on) => { const b = form && form.querySelector('button[type="submit"]'); if (b) b.disabled = on; };

  function showNotice(element, message, isError) {
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("error", !!isError);
    element.classList.add("show");
  }

  function clearNotice(element) {
    if (!element) return;
    element.textContent = "";
    element.classList.remove("show", "error");
  }

  function setError(inputId, message) {
    const input = document.getElementById(inputId);
    const error = document.getElementById(inputId + "Error");
    if (input) {
      input.classList.toggle("invalid", Boolean(message));
      input.setAttribute("aria-invalid", message ? "true" : "false");
    }
    if (error) error.textContent = message || "";
  }

  function clearErrors(form) {
    if (!form) return;
    form.querySelectorAll(".field-error").forEach((item) => { item.textContent = ""; });
    form.querySelectorAll("input").forEach((input) => {
      input.classList.remove("invalid");
      input.removeAttribute("aria-invalid");
    });
  }

  function showView(name) {
    if (!VIEW_TITLE[name]) name = "home";
    views.forEach((v) => { v.hidden = v.dataset.view !== name; });
    if (panelTitle) panelTitle.textContent = VIEW_TITLE[name];
    if (panelBack) panelBack.hidden = name === "home";
    clearNotice(signupNotice);
    clearNotice(loginNotice);
    clearNotice(verifyNotice);
    clearErrors(signupForm);
    clearErrors(loginForm);
    clearErrors(verifyForm);
    const inner = panel && panel.querySelector(".panel-inner");
    if (inner) inner.scrollTop = 0;
  }

  // Opens the sidebar on a given view: "home", "login" or "signup"
  function openAccount(view) {
    closeAccountModal();
    [loginForm, signupForm].forEach((f) => { if (f) f.reset(); });   // start empty: no details from a previous user
    showView(view || "home");
    if (!panel) return;
    const open = () => {
      setPanelOpen(true);
      const focusId = VIEW_FOCUS[view];
      if (focusId) setTimeout(() => {
        const el = document.getElementById(focusId);
        if (el) el.focus({ preventScroll: true });
      }, 650);
    };
    if (window.scrollY > 40) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      setTimeout(open, 450);
    } else {
      open();
    }
  }

  document.querySelectorAll("[data-account]").forEach((btn) => {
    btn.addEventListener("click", () => openAccount(btn.dataset.account));
  });

  [["panelLogin", "login"], ["panelCreate", "signup"], ["loginBtn", "login"], ["createBtn", "signup"]].forEach(([id, view]) => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener("click", () => openAccount(view));
  });

  document.querySelectorAll("[data-view-switch]").forEach((btn) => {
    btn.addEventListener("click", () => {
      showView(btn.dataset.viewSwitch);
      const focusId = VIEW_FOCUS[btn.dataset.viewSwitch];
      if (focusId) document.getElementById(focusId).focus({ preventScroll: true });
    });
  });
  if (panelBack) panelBack.addEventListener("click", () => showView("home"));

  // "Request Consultation": inquiries are sent from a signed-in account,
  // so it opens the Log In view of the sidebar
  const ctaConsult = document.getElementById("ctaConsult");
  if (ctaConsult) ctaConsult.addEventListener("click", () => openAccount("login"));
  window.BWOpenAccount = openAccount;   // also used by the "Request Consultation" button in the package window

  // Old links such as AccountSignIn.html#signupView now land here
  const hashView = { "#login": "login", "#loginView": "login", "#signup": "signup", "#signupView": "signup" }[window.location.hash];
  if (hashView) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
    setTimeout(() => openAccount(hashView), 300);
  }

  const EYE_OPEN = '<svg class="eye-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_SHUT = '<svg class="eye-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.1 4.1"/><path d="M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7c1.2 0 2.3-.2 3.3-.6"/></svg>';
  document.querySelectorAll(".eye-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.password);
      const reveal = input.type === "password";
      input.type = reveal ? "text" : "password";
      button.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
      button.setAttribute("aria-pressed", String(reveal));
      button.innerHTML = reveal ? EYE_SHUT : EYE_OPEN;
    });
  });

  [signupForm, loginForm, verifyForm].forEach((form) => {
    if (form) form.addEventListener("input", (e) => { if (e.target.id && !e.target.dataset.live) setError(e.target.id, ""); });
  });

  // First name and last name: letters and spaces only.
  function validName(value) {
    return /^[\p{L}]+(?:\s+[\p{L}]+)*$/u.test(value);
  }

  // Gmail username: 6-30 letters, numbers or periods; cannot start or end
  // with a period; no consecutive periods; @gmail.com domain only.
  function validGmail(value) {
    const match = value.toLowerCase().match(/^([a-z0-9.]+)@gmail\.com$/);
    if (!match) return false;
    const username = match[1];
    if (username.length < 6 || username.length > 30) return false;
    if (username.startsWith(".") || username.endsWith(".")) return false;
    if (username.includes("..")) return false;
    return true;
  }

  const GMAIL_MSG = "Enter a valid Gmail address. Use 6–30 letters, numbers, or periods before @gmail.com.";

  // Chrome fills saved logins into the boxes when the page opens. The login boxes start read-only
  // (Chrome skips those) and unlock as soon as they are clicked, tapped or tabbed into.
  ["loginEmail", "loginPassword"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) ["pointerdown", "focus"].forEach((ev) => el.addEventListener(ev, () => el.removeAttribute("readonly")));
  });

  // Live email check: once the field has been left, the message updates while typing
  ["loginEmail", "signupEmail"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const check = () => setError(id, el.value.trim() && !validGmail(el.value.trim()) ? GMAIL_MSG : "");
    el.addEventListener("blur", () => { el.dataset.live = "1"; check(); });
    el.addEventListener("input", () => { if (el.dataset.live) check(); });
  });

  if (signupForm) signupForm.addEventListener("submit", (event) => {
    event.preventDefault();
    clearErrors(signupForm);
    clearNotice(signupNotice);

    const firstName = document.getElementById("firstName").value.trim().replace(/\s+/g, " ");
    const lastName = document.getElementById("lastName").value.trim().replace(/\s+/g, " ");
    const email = document.getElementById("signupEmail").value.trim().toLowerCase();
    const password = document.getElementById("signupPassword").value;
    const confirm = document.getElementById("signupConfirm").value;
    let valid = true;

    if (!firstName) { setError("firstName", "Please enter your first name."); valid = false; }
    else if (!validName(firstName)) { setError("firstName", "First name can contain letters and spaces only."); valid = false; }

    if (!lastName) { setError("lastName", "Please enter your last name."); valid = false; }
    else if (!validName(lastName)) { setError("lastName", "Last name can contain letters and spaces only."); valid = false; }

    if (!validGmail(email)) { setError("signupEmail", GMAIL_MSG); valid = false; }

    if (password.length < 8 || !/\d/.test(password)) {
      setError("signupPassword", "Use at least 8 characters and include a number.");
      valid = false;
    }
    // Confirm password: must be filled in and match the password above
    if (!confirm) { setError("signupConfirm", "Please confirm your password."); valid = false; }
    else if (confirm !== password) { setError("signupConfirm", "Passwords do not match."); valid = false; }

    if (!valid) {
      const firstBad = signupForm.querySelector("input.invalid");
      if (firstBad) firstBad.focus();
      return;
    }

    // Create the account on the server, then ask for the 6-digit code we emailed
    busy(signupForm, true);
    window.BW.api("/auth/register", { body: { first_name: firstName, last_name: lastName, email, password, confirm_password: confirm } })
      .then((res) => {
        showNotice(signupNotice, res.message);
        signupForm.reset();
        window.setTimeout(() => openVerify(email, res.message), 900);
      })
      .catch((err) => {
        if (err.status === 409) setError("signupEmail", err.message);
        else showNotice(signupNotice, err.message, true);
      })
      .finally(() => busy(signupForm, false));
  });

  if (loginForm) loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    clearErrors(loginForm);
    clearNotice(loginNotice);

    const email = document.getElementById("loginEmail").value.trim().toLowerCase();
    const password = document.getElementById("loginPassword").value;
    let valid = true;

    if (!validGmail(email)) { setError("loginEmail", GMAIL_MSG); valid = false; }
    if (!password) { setError("loginPassword", "Please enter your password."); valid = false; }
    if (!valid) return;

    // The server checks the password AND that this is a customer account
    busy(loginForm, true);
    window.BW.api("/auth/login", { body: { email, password, role: "customer" }, noRedirect: true })
      .then((res) => {
        showNotice(loginNotice, `Welcome back, ${res.user.name.split(" ")[0]}! Login successful.`);
        loginForm.reset();
        window.setTimeout(() => { window.location.href = res.redirect || "HomePage.html"; }, 700);
      })
      .catch((err) => {
        if (err.status === 403) { busy(loginForm, false); openVerify(email, err.message); return; }   // correct password, email not verified yet
        showNotice(loginNotice, err.message, true);   // e.g. "Invalid email or password. 2 attempts left before a 5-minute lock."
        if (err.status === 401 || err.status === 429) {
          ["loginEmail", "loginPassword"].forEach((id) => { const el = document.getElementById(id); el.classList.add("invalid"); el.setAttribute("aria-invalid", "true"); });
          const pw = document.getElementById("loginPassword"); pw.value = ""; pw.focus();
        }
        busy(loginForm, false);
      });
  });

  // Email verification: the code we emailed after sign-up (api/auth.php: /auth/verify, /auth/resend)
  let verifyEmail = "";
  function openVerify(email, message) {
    verifyEmail = email;
    showView("verify");
    document.getElementById("verifyEmailText").textContent = email;
    if (message) showNotice(verifyNotice, message);
    document.getElementById("verifyCode").focus({ preventScroll: true });
  }

  if (verifyForm) verifyForm.addEventListener("submit", (event) => {
    event.preventDefault();
    clearNotice(verifyNotice);
    const code = document.getElementById("verifyCode").value.trim();
    if (!/^\d{6}$/.test(code)) { setError("verifyCode", "Enter the 6-digit code from the email."); return; }
    busy(verifyForm, true);
    window.BW.api("/auth/verify", { body: { email: verifyEmail, code } })
      .then((res) => {
        verifyForm.reset();
        showView("login");
        document.getElementById("loginEmail").value = verifyEmail;
        showNotice(loginNotice, res.message);
        document.getElementById("loginPassword").focus({ preventScroll: true });
      })
      .catch((err) => { setError("verifyCode", err.message); })
      .finally(() => busy(verifyForm, false));
  });

  const verifyResend = document.getElementById("verifyResend");
  if (verifyResend) verifyResend.addEventListener("click", () => {
    clearNotice(verifyNotice);
    setError("verifyCode", "");
    verifyResend.disabled = true;
    window.BW.api("/auth/resend", { body: { email: verifyEmail } })
      .then((res) => showNotice(verifyNotice, res.message))
      .catch((err) => showNotice(verifyNotice, err.message, true))
      .finally(() => { verifyResend.disabled = false; });
  });

  showView("home");

  /* =========================
     3B. HEADER LOGO
     -------------------------
     The logo keeps the page where it is (it does not jump down to #home);
     if the page was scrolled, it takes you back to the top.
     Staff (Admin / Super Admin) sign in on their own page:
     HTML/Super&AdminAccount.html. It is not linked on the public pages.
     ========================= */
  const brandLink = document.getElementById("brandLink");
  if (brandLink) brandLink.addEventListener("click", (e) => {
    e.preventDefault();
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: "smooth" });
  });

  /* =========================
     4. SMOOTH SCROLL BUTTONS
     ========================= */
  document.querySelectorAll("[data-scroll]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = document.querySelector(button.getAttribute("data-scroll"));
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });


  /* =========================
     6. FAQ ACCORDION (one item open at a time)
     ========================= */
  const faqToggles = document.querySelectorAll(".faq-toggle");

  function setFaqOpen(toggle, open) {
    const card = toggle.closest(".faq-card");
    if (!card) return;
    card.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  }

  faqToggles.forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const wasOpen = toggle.getAttribute("aria-expanded") === "true";
      faqToggles.forEach((t) => setFaqOpen(t, false));
      if (!wasOpen) setFaqOpen(toggle, true);
    });
  });

  const footerYear = document.getElementById("footerYear");
  if (footerYear) footerYear.textContent = new Date().getFullYear();

  /* =========================
     7. SERVICES: CURSOR GLOW + TOUCH PRESS
     ========================= */
  const serviceCards = document.querySelectorAll(".services-section .service-card");
  const glowState = new WeakMap();

  const animateGlow = (card) => {
    const s = glowState.get(card);
    s.x += (s.tx - s.x) * 0.2;
    s.y += (s.ty - s.y) * 0.2;
    card.style.setProperty("--mx", s.x + "px");
    card.style.setProperty("--my", s.y + "px");
    s.raf = Math.abs(s.tx - s.x) > 0.5 || Math.abs(s.ty - s.y) > 0.5
      ? requestAnimationFrame(() => animateGlow(card))
      : 0;
  };

  const setGlowTarget = (card, e, snap) => {
    const r = card.getBoundingClientRect();
    const s = glowState.get(card);
    s.tx = e.clientX - r.left;
    s.ty = e.clientY - r.top;
    if (snap) { s.x = s.tx; s.y = s.ty; }
    if (!s.raf) s.raf = requestAnimationFrame(() => animateGlow(card));
  };

  serviceCards.forEach((card) => {
    glowState.set(card, { x: 0, y: 0, tx: 0, ty: 0, raf: 0 });
    let timer;

    card.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") setGlowTarget(card, e, true); });
    card.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") setGlowTarget(card, e, false); });

    card.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch") return;
      clearTimeout(timer);
      setGlowTarget(card, e, true);
      card.classList.add("is-lit");
    });

    const release = () => { timer = setTimeout(() => card.classList.remove("is-lit"), 350); };
    card.addEventListener("pointerup", release);
    card.addEventListener("pointercancel", release);
  });

  /* =========================
     8. PADLOCK: REPLAY + TILT
     ========================= */
  const scene = document.getElementById("lockScene");
  const stage = hero ? hero.querySelector(".hero-stage") : null;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (scene && stage) {
    const fly = scene.querySelector(".lock-fly");
    const tilt = scene.querySelector(".lock-tilt");

    const replay = () => {
      if (reduceMotion) return;
      scene.classList.remove("is-playing", "replay");
      void scene.offsetWidth; // restart the CSS animations
      scene.classList.add("replay");
    };

    if (fly) {
      fly.addEventListener("click", replay);
      fly.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          replay();
        }
      });
    }

    if (tilt && !reduceMotion && window.matchMedia("(hover: hover)").matches) {
      stage.addEventListener("pointermove", (e) => {
        const r = stage.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        tilt.style.setProperty("--ry", (x * 14).toFixed(2) + "deg");
        tilt.style.setProperty("--rx", (-y * 10).toFixed(2) + "deg");
      });
      stage.addEventListener("pointerleave", () => {
        tilt.style.setProperty("--ry", "0deg");
        tilt.style.setProperty("--rx", "0deg");
      });
    }
  }
});


/* ---------------------------------------------------------------------
   PART B. OUR WORKS — project gallery + project detail
   --------------------------------------------------------------------- */
(function () {
  "use strict";
  const BW_DATA = window.BW_DATA || {};

  /* 1. Project data: see LandingPageData.js (BW_DATA.projects) */
  const WORKS_PROJECTS = BW_DATA.projects || [];

  const pad = (n) => String(n).padStart(2, "0");
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function init() {
    const section = document.getElementById("works");
    const track = document.getElementById("worksTrack");
    if (!section || !track) return;

    const gallery = document.getElementById("worksGallery");
    const controls = document.getElementById("worksControls");
    const prevBtn = document.getElementById("worksPrev");
    const nextBtn = document.getElementById("worksNext");
    const currentEl = document.getElementById("worksCurrent");
    const totalEl = document.getElementById("worksTotal");
    const progressBar = document.getElementById("worksProgressBar");

    /* =========================
       2. CARD RENDERING
       ========================= */
    track.innerHTML = WORKS_PROJECTS.map((p, i) => {
      const img = p.images[0] || { src: "", alt: "" };
      const systems = p.systems.map((s) => esc(s.name)).join(" &bull; ");
      return `
        <li class="project-card" data-project="${esc(p.id)}" style="--i:${i}">
          <div class="project-card__media">
            <img src="${esc(img.src)}" alt="${esc(img.alt)}" loading="lazy" decoding="async" draggable="false">
          </div>
          <div class="project-card__shade" aria-hidden="true"></div>
          <span class="project-card__frame" aria-hidden="true"></span>
          <div class="project-card__top" aria-hidden="true">
            <span class="project-card__status">${esc(p.status)}</span>
            <span class="project-card__index">${pad(i + 1)}</span>
          </div>
          <div class="project-card__info">
            <span class="project-card__label">${esc(p.category)} &middot; ${esc(p.projectType)}</span>
            <h3 class="project-card__title">${esc(p.title)}</h3>
            <div class="project-card__more">
              <div class="project-card__more-inner">
                <p class="project-card__systems">${systems}</p>
                <p class="project-card__desc">${esc(p.summary)}</p>
                <span class="project-card__cta">View Project <span class="material-icons-round" aria-hidden="true">arrow_forward</span></span>
              </div>
            </div>
          </div>
          <button class="project-card__open" type="button"
                  aria-label="View project: ${esc(p.title)}"
                  aria-controls="projectDetail" aria-expanded="false"></button>
        </li>`;
    }).join("");

    const cards = Array.from(track.querySelectorAll(".project-card"));
    if (totalEl) totalEl.textContent = pad(cards.length);

    /* =========================
       3. GALLERY NAVIGATION
       ========================= */
    const step = () => {
      const card = cards[0];
      if (!card) return track.clientWidth;
      const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      return card.getBoundingClientRect().width + gap;
    };

    function updateNav() {
      const max = track.scrollWidth - track.clientWidth;
      const scrollable = max > 2;

      track.classList.toggle("is-static", !scrollable);
      if (gallery) gallery.classList.toggle("is-static", !scrollable);
      if (controls) controls.classList.toggle("is-static", !scrollable);

      if (prevBtn) prevBtn.disabled = track.scrollLeft <= 2;
      if (nextBtn) nextBtn.disabled = track.scrollLeft >= max - 2;

      // counter = first card that is mostly in view
      const index = Math.min(cards.length - 1, Math.round(track.scrollLeft / step()));
      if (currentEl) currentEl.textContent = pad(Math.max(0, index) + 1);

      if (progressBar) {
        const thumb = scrollable ? track.clientWidth / track.scrollWidth : 1;
        const ratio = scrollable ? track.scrollLeft / max : 0;
        progressBar.style.setProperty("--wk-thumb", (thumb * 100).toFixed(2) + "%");
        progressBar.style.transform = "translateX(" + (ratio * (1 / thumb - 1) * 100).toFixed(2) + "%)";
      }
    }

    const scrollByCards = (dir) => {
      track.scrollBy({ left: dir * step(), behavior: reduceMotion ? "auto" : "smooth" });
    };

    if (prevBtn) prevBtn.addEventListener("click", () => scrollByCards(-1));
    if (nextBtn) nextBtn.addEventListener("click", () => scrollByCards(1));

    let navRaf = 0;
    track.addEventListener("scroll", () => {
      if (!navRaf) navRaf = requestAnimationFrame(() => { navRaf = 0; updateNav(); });
    }, { passive: true });
    window.addEventListener("resize", updateNav);
    updateNav();

    // Mouse drag to scroll (touch already swipes natively)
    let drag = null;
    let suppressClick = false;

    track.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse" || e.button !== 0 || track.classList.contains("is-static")) return;
      drag = { x: e.clientX, left: track.scrollLeft, moved: false, id: e.pointerId };
    });

    track.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) > 6) {
        drag.moved = true;
        track.classList.add("is-dragging");
        track.setPointerCapture(drag.id);
      }
      if (drag.moved) track.scrollLeft = drag.left - dx;
    });

    const endDrag = () => {
      if (!drag) return;
      if (drag.moved) {
        suppressClick = true;
        track.classList.remove("is-dragging");
        const target = Math.round(track.scrollLeft / step()) * step();
        track.scrollTo({ left: target, behavior: reduceMotion ? "auto" : "smooth" });
        setTimeout(() => { suppressClick = false; }, 0);
      }
      drag = null;
    };
    track.addEventListener("pointerup", endDrag);
    track.addEventListener("pointercancel", endDrag);

    // a drag should not count as a click on a card
    track.addEventListener("click", (e) => {
      if (suppressClick) { e.preventDefault(); e.stopPropagation(); }
    }, true);

    /* =========================
       4. ENTRANCE ANIMATION
       ========================= */
    const settle = () => setTimeout(() => section.classList.add("is-settled"), 900 + cards.length * 90);

    if ("IntersectionObserver" in window && !reduceMotion) {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((en) => en.isIntersecting)) {
          section.classList.add("is-inview");
          settle();
          io.disconnect();
        }
      }, { threshold: 0.15 });
      io.observe(gallery || track);
    } else {
      section.classList.add("is-inview", "is-settled");
    }

    /* =========================
       5. PROJECT DETAIL
       ========================= */
    const detail = document.getElementById("projectDetail");
    const panel = document.getElementById("projectDetailPanel");
    const el = (id) => document.getElementById(id);
    const pd = {
      crumb: el("pdCrumb"), type: el("pdType"), title: el("pdTitle"), desc: el("pdDesc"),
      client: el("pdClient"), projectType: el("pdProjectType"), scope: el("pdScope"),
      status: el("pdStatus"), systems: el("pdSystems"), main: el("pdMainImg"),
      caption: el("pdCaption"), thumbs: el("pdThumbs")
    };

    let currentIndex = -1;
    let lastTrigger = null;
    let swapTimer = 0;

    function setMainImage(project, i, animate) {
      const img = project.images[i];
      if (!img || !pd.main) return;

      const apply = () => {
        pd.main.src = img.src;
        pd.main.alt = img.alt;
        pd.main.classList.remove("is-fading");
      };

      if (animate && !reduceMotion) {
        pd.main.classList.add("is-fading");
        setTimeout(apply, 180);
      } else {
        apply();
      }

      if (pd.caption) {
        pd.caption.textContent = project.images.length > 1
          ? "Photo " + (i + 1) + " of " + project.images.length
          : project.category + " installation";
      }
      if (pd.thumbs) {
        pd.thumbs.querySelectorAll(".project-detail__thumb").forEach((t, n) => {
          t.classList.toggle("is-current", n === i);
          t.setAttribute("aria-current", n === i ? "true" : "false");
        });
      }
    }

    function fillDetail(project) {
      if (pd.crumb) pd.crumb.textContent = project.title;
      if (pd.type) pd.type.textContent = project.category + " · " + project.projectType;
      if (pd.title) pd.title.textContent = project.title;
      if (pd.desc) pd.desc.textContent = project.description;
      if (pd.client) pd.client.textContent = project.client;
      if (pd.projectType) pd.projectType.textContent = project.category + " — " + project.projectType;
      if (pd.scope) pd.scope.textContent = project.scope;
      if (pd.status) pd.status.textContent = project.status;

      if (pd.systems) {
        pd.systems.innerHTML = project.systems.map((s) =>
          `<li class="project-chip"><span class="material-icons-round" aria-hidden="true">${esc(s.icon)}</span>${esc(s.name)}</li>`
        ).join("");
      }

      if (pd.thumbs) {
        pd.thumbs.innerHTML = project.images.map((img, n) =>
          `<li><button class="project-detail__thumb" type="button" data-index="${n}" aria-label="Show photo ${n + 1}">
             <img src="${esc(img.src)}" alt="" loading="lazy" decoding="async">
           </button></li>`
        ).join("");
        pd.thumbs.hidden = project.images.length < 2;
      }
      const media = pd.main && pd.main.closest(".project-detail__media");
      if (media) media.classList.toggle("is-single", project.images.length < 2);

      setMainImage(project, 0, false);
    }

    function markActive(index) {
      cards.forEach((card, n) => {
        const on = n === index;
        card.classList.toggle("is-active", on);
        const btn = card.querySelector(".project-card__open");
        if (btn) btn.setAttribute("aria-expanded", String(on));
      });
    }

    function revealCard(index) {
      const card = cards[index];
      if (!card) return;
      const c = card.getBoundingClientRect();
      const t = track.getBoundingClientRect();
      const visible = c.left >= t.left - 2 && c.right <= t.right + 2;
      if (visible) return;
      const padLeft = parseFloat(getComputedStyle(track).paddingLeft) || 0;
      const left = track.scrollLeft + (c.left - t.left) - padLeft;
      track.scrollTo({ left: Math.max(0, left), behavior: reduceMotion ? "auto" : "smooth" });
    }

    function openProject(index, trigger) {
      if (!detail || index < 0 || index >= WORKS_PROJECTS.length) return;
      const project = WORKS_PROJECTS[index];
      const wasOpen = !detail.hidden && detail.classList.contains("is-open");
      if (trigger) lastTrigger = trigger;

      markActive(index);
      revealCard(index);

      if (wasOpen && index !== currentIndex && !reduceMotion) {
        clearTimeout(swapTimer);
        detail.classList.add("is-swapping");
        swapTimer = setTimeout(() => {
          fillDetail(project);
          detail.classList.remove("is-swapping");
        }, 220);
      } else {
        fillDetail(project);
      }
      currentIndex = index;

      if (!wasOpen) {
        detail.hidden = false;
        void detail.offsetWidth;            // let the browser register the closed state first
        detail.classList.add("is-open");
        setTimeout(() => {
          if (panel) panel.focus({ preventScroll: true });
          detail.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
        }, reduceMotion ? 0 : 260);
      }
      section.dispatchEvent(new CustomEvent("works:layout"));
    }

    function closeProject() {
      if (!detail || detail.hidden) return;
      detail.classList.remove("is-open");
      markActive(-1);
      const done = () => {
        detail.hidden = true;
        section.dispatchEvent(new CustomEvent("works:layout"));
      };
      if (reduceMotion) done(); else setTimeout(done, 420);

      const back = lastTrigger;
      currentIndex = -1;
      if (back) back.focus({ preventScroll: true });
      const card = back && back.closest(".project-card");
      if (card) card.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest", inline: "nearest" });
    }

    track.addEventListener("click", (e) => {
      const btn = e.target.closest(".project-card__open");
      if (!btn) return;
      const index = cards.indexOf(btn.closest(".project-card"));
      if (index === currentIndex && !detail.hidden) {
        // second click on the selected project just brings the detail back into view
        detail.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
        return;
      }
      openProject(index, btn);
    });

    const cycle = (dir) => {
      const n = WORKS_PROJECTS.length;
      const next = (currentIndex + dir + n) % n;
      const btn = cards[next] && cards[next].querySelector(".project-card__open");
      if (btn) lastTrigger = btn;
      openProject(next);
    };

    const pdPrev = el("pdPrev");
    const pdNext = el("pdNext");
    const pdClose = el("pdClose");
    if (pdPrev) pdPrev.addEventListener("click", () => cycle(-1));
    if (pdNext) pdNext.addEventListener("click", () => cycle(1));
    if (pdClose) pdClose.addEventListener("click", closeProject);

    if (pd.thumbs) {
      pd.thumbs.addEventListener("click", (e) => {
        const t = e.target.closest(".project-detail__thumb");
        if (!t || currentIndex < 0) return;
        setMainImage(WORKS_PROJECTS[currentIndex], Number(t.dataset.index), true);
      });
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && detail && !detail.hidden && section.contains(document.activeElement)) {
        closeProject();
      }
    });

    /* =========================
       6. MOUSE-RESPONSIVE BACKGROUND DOTS
       -------------------------
       Drawn on a canvas inside .works-bg (behind all content).
       Dots are only placed in empty space: never under the heading,
       the gallery or the detail panel.
       ========================= */
    const canvas = document.getElementById("worksParticles");
    if (canvas && canvas.getContext) setupParticles(section, canvas);
  }

  function setupParticles(section, canvas) {
    const ctx = canvas.getContext("2d");
    const html = document.documentElement;
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

    let w = 0, h = 0, dpr = 1;
    let dots = [];
    let palette = null;
    const mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999, inside: false, glow: 0 };
    let raf = 0;
    let visible = true;

    const readPalette = () => {
      const dark = html.classList.contains("dark-theme");
      palette = dark
        ? { dot: "147, 197, 253", hot: "0, 119, 246", glow: "0, 119, 246", glowA: 0.10, base: 1 }
        : { dot: "27, 73, 184", hot: "0, 119, 246", glow: "0, 119, 246", glowA: 0.06, base: 0.85 };
    };

    const blockedRects = () => {
      const s = section.getBoundingClientRect();
      const pad = 18;
      return [".works-head", ".works-gallery", ".project-detail:not([hidden])"]
        .map((sel) => section.querySelector(sel))
        .filter(Boolean)
        .map((node) => {
          const r = node.getBoundingClientRect();
          return { l: r.left - s.left - pad, t: r.top - s.top - pad, r: r.right - s.left + pad, b: r.bottom - s.top + pad };
        });
    };

    function build() {
      const rect = section.getBoundingClientRect();
      w = Math.round(rect.width);
      h = Math.round(rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const blocked = blockedRects();
      const gap = w < 650 ? 38 : 46;
      dots = [];
      // seeded pseudo-random so the pattern doesn't jump on every resize
      let seed = 7;
      const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

      for (let y = gap / 2; y < h; y += gap) {
        for (let x = gap / 2; x < w; x += gap) {
          const r1 = rand(), r2 = rand(), r3 = rand(), r4 = rand();
          if (r1 < 0.45) continue;
          const px = x + (r2 - 0.5) * gap * 0.7;
          const py = y + (r3 - 0.5) * gap * 0.7;
          if (blocked.some((b) => px > b.l && px < b.r && py > b.t && py < b.b)) continue;
          dots.push({ x: px, y: py, ox: 0, oy: 0, s: 0.6 + r4 * 0.9, a: 0.18 + r4 * 0.32, boost: 0 });
        }
      }
      draw();
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);
      if (!palette) readPalette();

      // soft ambient light that follows the cursor (empty space only, very faint)
      if (mouse.glow > 0.01) {
        const g = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 260);
        g.addColorStop(0, `rgba(${palette.glow}, ${palette.glowA * mouse.glow})`);
        g.addColorStop(1, `rgba(${palette.glow}, 0)`);
        ctx.fillStyle = g;
        ctx.fillRect(mouse.x - 260, mouse.y - 260, 520, 520);
      }

      for (const d of dots) {
        const a = (d.a + d.boost * 0.45) * palette.base;
        ctx.beginPath();
        ctx.arc(d.x + d.ox, d.y + d.oy, d.s + d.boost * 0.8, 0, Math.PI * 2);
        ctx.fillStyle = d.boost > 0.05 ? `rgba(${palette.hot}, ${a})` : `rgba(${palette.dot}, ${a})`;
        ctx.fill();
      }
    }

    function tick() {
      raf = 0;
      mouse.x += (mouse.tx - mouse.x) * 0.15;
      mouse.y += (mouse.ty - mouse.y) * 0.15;
      mouse.glow += ((mouse.inside ? 1 : 0) - mouse.glow) * 0.08;

      let active = Math.abs(mouse.tx - mouse.x) > 0.3 || Math.abs(mouse.ty - mouse.y) > 0.3 || (mouse.glow > 0.01 && mouse.glow < 0.99);
      const R = 150;

      for (const d of dots) {
        let tx = 0, ty = 0, tb = 0;
        if (mouse.inside) {
          const dx = d.x - mouse.x;
          const dy = d.y - mouse.y;
          const dist = Math.hypot(dx, dy);
          if (dist < R && dist > 0.01) {
            const f = 1 - dist / R;
            tx = (dx / dist) * f * 7;                    // gentle push away (max ~7px)
            ty = (dy / dist) * f * 7;
            tb = f;
          }
        }
        d.ox += (tx - d.ox) * 0.12;
        d.oy += (ty - d.oy) * 0.12;
        d.boost += (tb - d.boost) * 0.12;
        if (Math.abs(tx - d.ox) > 0.05 || Math.abs(ty - d.oy) > 0.05 || Math.abs(tb - d.boost) > 0.01) active = true;
      }

      draw();
      if (active && visible) raf = requestAnimationFrame(tick);
    }

    const kick = () => { if (!raf && visible) raf = requestAnimationFrame(tick); };

    if (finePointer && !reduceMotion) {
      section.addEventListener("pointermove", (e) => {
        if (e.pointerType !== "mouse") return;
        const r = section.getBoundingClientRect();
        mouse.tx = e.clientX - r.left;
        mouse.ty = e.clientY - r.top;
        if (!mouse.inside) { mouse.x = mouse.tx; mouse.y = mouse.ty; }
        mouse.inside = true;
        kick();
      });
      section.addEventListener("pointerleave", () => { mouse.inside = false; kick(); });
    }

    // rebuild when the layout changes (resize, detail opened/closed)
    let buildTimer = 0;
    const rebuild = () => { clearTimeout(buildTimer); buildTimer = setTimeout(build, 120); };
    if ("ResizeObserver" in window) new ResizeObserver(rebuild).observe(section);
    else window.addEventListener("resize", rebuild);
    section.addEventListener("works:layout", () => setTimeout(build, 520));

    // redraw in the right colours when the theme switches
    new MutationObserver(() => { readPalette(); draw(); })
      .observe(html, { attributes: true, attributeFilter: ["class", "data-theme"] });

    // pause the loop while the section is off-screen
    if ("IntersectionObserver" in window) {
      new IntersectionObserver((entries) => {
        visible = entries[0].isIntersecting;
        if (visible) kick();
      }).observe(section);
    }

    readPalette();
    build();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();


/* ---------------------------------------------------------------------
   PART C. SHARED INFORMATION WINDOW (used by Packages)
   BWDetailModal.open({ items, index, trigger, onBrowse })
   --------------------------------------------------------------------- */
window.BWDetailModal = (function () {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pad = (n) => String(n).padStart(2, "0");
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let modal = null, dialog = null, m = null;
  let items = [], current = 0, lastFocus = null, onBrowse = null, swapTimer = 0;

  function setup() {
    if (modal) return true;
    modal = document.getElementById("detailModal");
    if (!modal) return false;
    dialog = modal.querySelector(".catalog-modal__dialog");
    const $ = (id) => document.getElementById(id);
    m = {
      cat: $("dmCategory"), catIcon: $("dmCatIcon"), art: $("dmArt"), index: $("dmIndex"), total: $("dmTotal"),
      title: $("dmTitle"), desc: $("dmDesc"), sections: $("dmSections"),
      prev: $("dmPrev"), next: $("dmNext"), ask: $("dmAsk"), browseBox: $("dmBrowse")
    };
    modal.inert = true;

    modal.querySelectorAll("[data-modal-close]").forEach((el) => el.addEventListener("click", close));
    m.prev.addEventListener("click", () => browse(-1));
    m.next.addEventListener("click", () => browse(1));

    // follow-up button: closes the window and opens Log In (inquiries are sent from an account)
    m.ask.addEventListener("click", () => {
      lastFocus = null;
      close();
      if (window.BWOpenAccount) window.BWOpenAccount("login");
    });

    // Escape closes, arrow keys browse, Tab stays inside the window
    modal.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key === "ArrowRight") { browse(1); return; }
      if (e.key === "ArrowLeft") { browse(-1); return; }
      if (e.key !== "Tab") return;

      const focusable = Array.from(dialog.querySelectorAll("button:not([hidden]), [href]"))
        .filter((el) => el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    });
    return true;
  }

  function render(i) {
    const item = items[i];
    if (!item) return;
    current = i;

    m.cat.textContent = item.category || "";
    m.catIcon.textContent = item.categoryIcon || "category";
    m.art.innerHTML = item.visual || "";
    m.index.textContent = pad(i + 1);
    m.total.textContent = pad(items.length);
    m.title.textContent = item.title || "";
    m.desc.textContent = item.description || "";

    m.sections.innerHTML = (item.sections || [])
      .filter((s) => s && Array.isArray(s.items) && s.items.length)
      .map((s) => {
        const list = s.type === "list"
          ? `<ul class="catalog-modal__list">${s.items.map((t) =>
              `<li><span class="material-icons-round" aria-hidden="true">check_circle</span>${esc(t)}</li>`).join("")}</ul>`
          : `<ul class="catalog-modal__chips">${s.items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;
        return `<h4 class="catalog-modal__sub">${esc(s.label)}</h4>${list}`;
      }).join("");

    m.ask.hidden = !item.askLabel;
    m.ask.textContent = item.askLabel || "";

    const single = items.length < 2;
    m.browseBox.classList.toggle("is-single", single);
    m.prev.hidden = single;
    m.next.hidden = single;
  }

  function open(options) {
    if (!setup() || !options || !options.items || !options.items.length) return;
    items = options.items;
    onBrowse = options.onBrowse || null;
    lastFocus = options.trigger || document.activeElement;
    render(Math.max(0, Math.min(items.length - 1, options.index || 0)));

    modal.inert = false;
    modal.setAttribute("aria-hidden", "false");
    modal.classList.add("is-open");
    document.body.classList.add("catalog-modal-open");
    setTimeout(() => dialog.focus({ preventScroll: true }), reduceMotion ? 0 : 60);
  }

  function close() {
    if (!modal || !modal.classList.contains("is-open")) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    modal.inert = true;
    document.body.classList.remove("catalog-modal-open");
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  }

  function browse(dir) {
    if (items.length < 2) return;
    const next = (current + dir + items.length) % items.length;
    if (onBrowse) {
      const el = onBrowse(next);
      if (el) lastFocus = el;
    }
    if (reduceMotion) { render(next); return; }
    clearTimeout(swapTimer);
    dialog.classList.add("is-swapping");
    swapTimer = setTimeout(() => { render(next); dialog.classList.remove("is-swapping"); }, 200);
  }

  return { open, close };
})();


/* ---------------------------------------------------------------------
   PART D. OUR PRODUCTS — compact catalog
   --------------------------------------------------------------------- */
(function () {
  "use strict";
  const BW_DATA = window.BW_DATA || {};

  /* 1. Products come live from the Admin "Products" tab, through the public list without prices
        (api/customer.php: /catalog). Packages have their own section (PART E). */
  let CATALOG_PRODUCTS = [];
  const CATALOG_GROUPS = {};
  // drawing per admin category (any other category uses the CCTV drawing)
  const ART_BY_CATEGORY = { "Access Control": "smartLock", "Solar & Lighting": "solarLight", "Recorders & Storage": "accessories",
                            "Power & Cabling": "accessories", "Wi-Fi CCTV Kits": "ipCctv", "Cameras": "ipCctv" };

  /* 2. Illustrations: see LandingPageData.js (BW_DATA.productArt) */
  const ART = BW_DATA.productArt || {};

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // product visual: real photo if provided, otherwise the illustration
  function visualMarkup(p) {
    if (p.image && p.image.src) {
      return `<img src="${esc(p.image.src)}" alt="${esc(p.image.alt || p.name)}" loading="lazy" decoding="async">`;
    }
    const art = ART[p.art] || ART.irCctv;
    return `<svg viewBox="0 0 120 90" role="img" aria-label="${esc(p.name)} illustration" focusable="false">${art}</svg>`;
  }

  async function init() {
    const section = document.getElementById("products");
    const grid = document.getElementById("catalogGrid");
    if (!section || !grid) return;
    try {
      const res = await fetch("../api/index.php?r=%2Fcatalog");
      CATALOG_PRODUCTS = ((await res.json()).data || []).filter((c) => c.item_type === "product").map((c) => ({
        name: c.name, group: c.category || "Other", art: ART_BY_CATEGORY[c.category] || "irCctv",
        summary: c.description || "", description: c.description || "" }));
    } catch (e) { CATALOG_PRODUCTS = []; }
    CATALOG_PRODUCTS.forEach((p) => { CATALOG_GROUPS[p.group] = { label: p.group, icon: "category" }; });
    if (!CATALOG_PRODUCTS.length) {
      grid.innerHTML = '<li style="grid-column:1/-1;text-align:center;opacity:.7">Our product list could not be loaded right now. Please try again later.</li>';
      return;
    }

    const filtersBox = document.getElementById("catalogFilters");

    /* =========================
       3. FILTERS + CARDS
       ========================= */
    grid.innerHTML = CATALOG_PRODUCTS.map((p, i) => {
      const group = CATALOG_GROUPS[p.group] || { label: "" };
      const h = p.highlight;
      const tags = h
        ? `<span class="catalog-card__tag"><span class="material-icons-round" aria-hidden="true">${esc(h.icon)}</span>${esc(h.text)}</span>`
        : "";
      return `
        <li class="catalog-card" data-index="${i}" data-group="${esc(p.group)}">
          <div class="catalog-card__stage">
            <span class="catalog-card__rings" aria-hidden="true"></span>
            <div class="catalog-card__art">${visualMarkup(p)}</div>
            <div class="catalog-card__tags" aria-hidden="true">${tags}</div>
          </div>
          <div class="catalog-card__body">
            <span class="catalog-card__cat">${esc(group.label)}</span>
            <h3 class="catalog-card__name">${esc(p.name)}</h3>
            <p class="catalog-card__desc">${esc(p.summary)}</p>
          </div>
        </li>`;
    }).join("");

    const cards = Array.from(grid.querySelectorAll(".catalog-card"));

    // 12 cards at a time ("Show more" adds 12), since the full list is long
    const PAGE = 12;
    let filterKey = "all", limit = PAGE;
    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "bw-btn bw-btn--outline catalog-more";
    moreBtn.textContent = "Show more";
    grid.after(moreBtn);
    function applyFilter() {
      let n = 0, total = 0;
      cards.forEach((card) => {
        const show = (filterKey === "all" || card.dataset.group === filterKey) && total++ < limit;
        const appear = show && card.hidden;
        card.hidden = !show;
        if (appear && !reduceMotion) {
          card.classList.remove("is-entering");
          card.style.setProperty("--n", n++);
          void card.offsetWidth;          // restart the entrance animation
          card.classList.add("is-entering");
        }
      });
      moreBtn.hidden = total <= limit;
    }
    moreBtn.addEventListener("click", () => { limit += PAGE; applyFilter(); });
    applyFilter();

    // Filter buttons: "All" + one per group that has products
    if (filtersBox) {
      const counts = {};
      CATALOG_PRODUCTS.forEach((p) => { counts[p.group] = (counts[p.group] || 0) + 1; });
      const entries = [["all", { label: "All Products" }, CATALOG_PRODUCTS.length]]
        .concat(Object.keys(CATALOG_GROUPS).filter((k) => counts[k]).map((k) => [k, CATALOG_GROUPS[k], counts[k]]));

      filtersBox.innerHTML = entries.map(([key, g, n]) =>
        `<button class="catalog-filter" type="button" data-filter="${esc(key)}" aria-pressed="${key === "all"}">
           ${esc(g.label)}<span class="catalog-filter__count" aria-hidden="true">${n}</span>
         </button>`
      ).join("");

      filtersBox.addEventListener("click", (e) => {
        const btn = e.target.closest(".catalog-filter");
        if (!btn) return;
        const key = btn.dataset.filter;
        filtersBox.querySelectorAll(".catalog-filter").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
        cards.forEach((card) => { card.hidden = true; });   // so every card of the new filter animates in
        filterKey = key; limit = PAGE; applyFilter();
      });
    }

    /* =========================
       5. CURSOR LIGHT (background only, mouse only)
       ========================= */
    const bg = document.getElementById("productsBg");
    if (bg && !reduceMotion && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      let raf = 0, x = 50, y = 40;
      section.addEventListener("pointermove", (e) => {
        if (e.pointerType !== "mouse") return;
        const r = section.getBoundingClientRect();
        x = ((e.clientX - r.left) / r.width) * 100;
        y = ((e.clientY - r.top) / r.height) * 100;
        if (!raf) raf = requestAnimationFrame(() => {
          raf = 0;
          bg.style.setProperty("--px", x.toFixed(1) + "%");
          bg.style.setProperty("--py", y.toFixed(1) + "%");
        });
      });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();


/* ---------------------------------------------------------------------
   PART E. PACKAGES
   --------------------------------------------------------------------- */
(function () {
  "use strict";
  const BW_DATA = window.BW_DATA || {};

  /* Package data: see LandingPageData.js (BW_DATA.packages) */
  const SECURITY_PACKAGES = BW_DATA.packages || [];

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // visual for the information window: shield with the package icon
  const packageVisual = (p) => `
    <svg viewBox="0 0 120 90" role="img" aria-label="${esc(p.name)} illustration" focusable="false">
      <path class="pa-beam" d="M60 6l30 11v23c0 21-13 35-30 42-17-7-30-21-30-42V17z"/>
      <path class="pa-body" d="M60 10l26 10v20c0 18-11 31-26 37-15-6-26-19-26-37V20z"/>
      <path class="pa-stroke-accent" d="M48 44l8 8 16-17"/>
      <path class="pa-thin" d="M14 70h18M88 70h18M10 24h14M96 24h14"/>
      <circle class="pa-accent" cx="14" cy="70" r="2"/><circle class="pa-accent" cx="106" cy="70" r="2"/>
      <circle class="pa-accent" cx="10" cy="24" r="2"/><circle class="pa-accent" cx="110" cy="24" r="2"/>
    </svg>`;

  function init() {
    const grid = document.getElementById("packageGrid");
    if (!grid) return;

    grid.innerHTML = SECURITY_PACKAGES.map((p, i) => {
      const bars = [1, 2, 3].map((n) => `<span class="pkg-level__bar${n <= p.level ? " is-on" : ""}"></span>`).join("");
      return `
        <li class="pkg-card" data-index="${i}">
          <div class="pkg-card__head">
            <span class="pkg-card__icon material-icons-round" aria-hidden="true">${esc(p.icon)}</span>
            <span class="pkg-level" aria-label="${esc(p.levelLabel)}">${bars}<span class="pkg-level__text">${esc(p.levelLabel)}</span></span>
          </div>

          <span class="pkg-card__tier">${esc(p.tier)}</span>
          <h3 class="pkg-card__name">${esc(p.name)}</h3>
          ${p.price ? `<p class="pkg-card__price">₱${Number(p.price).toLocaleString("en-PH")}</p>` : ""}
          <p class="pkg-card__desc">${esc(p.summary)}</p>

          <h4 class="pkg-card__label">Included Systems</h4>
          <ul class="pkg-card__list">
            ${p.systems.map((s) => `<li><span class="material-icons-round" aria-hidden="true">check</span>${esc(s)}</li>`).join("")}
          </ul>

          <h4 class="pkg-card__label">Suitable For</h4>
          <ul class="pkg-card__suits">
            ${p.suitable.map((s) => `<li>${esc(s)}</li>`).join("")}
          </ul>

          <button class="bw-btn bw-btn--outline pkg-card__btn" type="button" aria-haspopup="dialog" aria-controls="detailModal">
            View Package<span class="visually-hidden-text">: ${esc(p.name)}</span>
            <span class="material-icons-round" aria-hidden="true">arrow_forward</span>
          </button>
        </li>`;
    }).join("");

    const cards = Array.from(grid.querySelectorAll(".pkg-card"));

    const toModalItem = (p) => ({
      category: p.tier + " Package",
      categoryIcon: p.icon,
      visual: packageVisual(p),
      title: p.name,
      description: p.description,
      sections: [
        { label: "Package Price", type: "chips", items: p.price ? ["₱" + Number(p.price).toLocaleString("en-PH")] : [] },
        { label: "Included Systems", type: "list", items: p.systems },
        { label: "Service Includes", type: "chips", items: p.services },
        { label: "Suitable For", type: "chips", items: p.suitable }
      ],
      askLabel: "Request Consultation"
    });

    // whole card opens the window; the button is the keyboard target
    grid.addEventListener("click", (e) => {
      const card = e.target.closest(".pkg-card");
      if (!card || !window.BWDetailModal) return;
      window.BWDetailModal.open({
        items: SECURITY_PACKAGES.map(toModalItem),
        index: Number(card.dataset.index),
        trigger: card.querySelector(".pkg-card__btn"),
        onBrowse: (i) => cards[i].querySelector(".pkg-card__btn")
      });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();