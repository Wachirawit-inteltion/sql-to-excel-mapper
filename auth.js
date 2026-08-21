/* ============================================================================
   auth — login screen + session handling for the SQL Mapping tool.

   Talks to a Google Apps Script Web App (see Code.gs / SETUP_GUIDE.md) which
   verifies credentials against a "Users" sheet and logs every login attempt
   to a "LoginLog" sheet, one row per attempt, grouped by date.

   TO CONNECT THIS TO YOUR GOOGLE SHEET:
   paste your Apps Script deployment URL (ends in /exec) below.
   ========================================================================== */
(function () {
  'use strict';

  var APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzdL1Io4zn3trLBDz3JVOZHDe4k7yzjW0J9eIIw5CJW_TLzfTDooRFJde56FwP1s2k/exec';

  var SESSION_KEY = 'sqlmap_session'; /* { username, role, displayName } — never the password */
  var currentPassword = null; /* kept in memory only for this page load, never persisted */

  function $(sel) { return document.querySelector(sel); }

  /* ---- API call — text/plain avoids a CORS preflight against Apps Script ---- */
  function callApi(action, payload) {
    if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf('PASTE_YOUR') === 0) {
      return Promise.resolve({ ok: false, error: 'not_configured' });
    }
    var body = Object.assign({ action: action }, payload || {});
    return fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }).then(function (res) { return res.json(); })
      .catch(function () { return { ok: false, error: 'network' }; });
  }

  function getSession() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function setSession(s) {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {}
  }

  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  function applySessionUi(session) {
    var bar = $('#authBar');
    var who = $('#authWho');
    var cfgBtn = $('#btnConfig');
    if (!session) {
      document.body.classList.add('locked');
      if (bar) bar.hidden = true;
      return;
    }
    document.body.classList.remove('locked');
    if (bar) bar.hidden = false;
    if (who) who.textContent = session.displayName + ' (' + session.role + ')';
    if (cfgBtn) cfgBtn.hidden = session.role !== 'admin';
  }

  function showError(msg) {
    var err = $('#lockError');
    if (err) { err.textContent = msg; err.hidden = false; }
    var card = $('.lockcard');
    if (card) {
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
    }
  }

  function errorMessage(code) {
    if (code === 'not_configured') return 'ยังไม่ได้ตั้งค่า Apps Script URL — ดู SETUP_GUIDE.md';
    if (code === 'invalid_credentials') return 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
    if (code === 'network') return 'เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง';
    if (code === 'not_setup') return 'ยังไม่ได้รัน setup() บน Apps Script — ดู SETUP_GUIDE.md';
    return 'เข้าสู่ระบบไม่สำเร็จ';
  }

  function doLogin(username, password) {
    if (!username || !password) { showError('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน'); return; }
    var btn = $('#lockForm button[type=submit]');
    if (btn) btn.disabled = true;
    callApi('login', { username: username, password: password }).then(function (r) {
      if (btn) btn.disabled = false;
      if (r && r.ok) {
        setSession({ username: r.username, role: r.role, displayName: r.displayName });
        currentPassword = password;
        applySessionUi(getSession());
        var pwInput = $('#lockPassword');
        if (pwInput) pwInput.value = '';
      } else {
        showError(errorMessage(r && r.error));
      }
    });
  }

  function doLogout() {
    clearSession();
    currentPassword = null;
    applySessionUi(null);
    var cm = $('#configModal');
    if (cm) cm.hidden = true;
  }

  document.addEventListener('DOMContentLoaded', function () {
    applySessionUi(getSession());

    var form = $('#lockForm');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        doLogin($('#lockUsername') ? $('#lockUsername').value.trim() : '', $('#lockPassword') ? $('#lockPassword').value : '');
      });
    }
    var uInput = $('#lockUsername');
    var pInput = $('#lockPassword');
    [uInput, pInput].forEach(function (inp) {
      if (!inp) return;
      inp.addEventListener('input', function () {
        var err = $('#lockError');
        if (err) err.hidden = true;
      });
    });
    if (uInput) setTimeout(function () { uInput.focus(); }, 50);

    var logoutBtn = $('#btnLogout');
    if (logoutBtn) logoutBtn.addEventListener('click', doLogout);
  });

  /* exposed for admin-config.js */
  window.SqlMapAuth = {
    callApi: callApi,
    getSession: getSession,
    getPassword: function () { return currentPassword; },
    logout: doLogout
  };
})();
