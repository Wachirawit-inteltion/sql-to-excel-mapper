/* ============================================================================
   auth-gate — simple client-side password lock for this page.

   NOTE ON SECURITY: this file runs entirely in the visitor's browser and the
   page is a static HTML file with no server. Anyone can view the page source
   or this file and see the password hash below. This is NOT real security —
   it only stops casual/accidental access, not a determined person. Do not
   rely on this to protect sensitive data.

   TO CHANGE THE PASSWORD:
   1. Open your browser console (F12) on any page and run:
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode('yourNewPassword'))
          .then(b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2,'0')).join(''))
      That prints a long hex string.
   2. Copy that string and paste it below as PASSWORD_HASH (replacing the value).

   Default password is: changeme
   ========================================================================== */
(function () {
  'use strict';

  var PASSWORD_HASH = 'f7466558afb9500c4d9fbd9452221441d5e1d139e72a3e9cb8f6a3a1aa85727a';
  var SESSION_KEY = 'sqlmap_auth_ok';

  function $(sel) { return document.querySelector(sel); }

  function sha256Hex(text) {
    var data = new TextEncoder().encode(text);
    return crypto.subtle.digest('SHA-256', data).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return b.toString(16).padStart(2, '0');
      }).join('');
    });
  }

  function unlock() {
    document.body.classList.remove('locked');
    var input = $('#lockPassword');
    if (input) input.value = '';
  }

  function showError(msg) {
    var err = $('#lockError');
    if (err) { err.textContent = msg; err.hidden = false; }
    var card = $('.lockcard');
    if (card) {
      card.classList.remove('shake');
      void card.offsetWidth; /* restart animation */
      card.classList.add('shake');
    }
  }

  function tryUnlock(pw) {
    if (!pw) { showError('กรุณากรอกรหัสผ่าน'); return; }
    if (!window.crypto || !window.crypto.subtle) {
      /* Fallback for very old browsers / non-https local file access issues */
      showError('เบราว์เซอร์นี้ไม่รองรับการตรวจสอบรหัสผ่านแบบปลอดภัย');
      return;
    }
    sha256Hex(pw).then(function (hash) {
      if (hash === PASSWORD_HASH) {
        try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (e) {}
        unlock();
      } else {
        showError('รหัสผ่านไม่ถูกต้อง ลองใหม่อีกครั้ง');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var already = false;
    try { already = sessionStorage.getItem(SESSION_KEY) === '1'; } catch (e) {}
    if (already) { unlock(); return; }

    var form = $('#lockForm');
    var input = $('#lockPassword');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        tryUnlock(input ? input.value : '');
      });
    }
    if (input) {
      setTimeout(function () { input.focus(); }, 50);
      input.addEventListener('input', function () {
        var err = $('#lockError');
        if (err) err.hidden = true;
      });
    }
  });
})();
