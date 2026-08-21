/* ============================================================================
   admin-config — the "ตั้งค่าสมาชิก" (Config) tab, admin-only.

   Uses the password the admin already typed at login (kept in memory by
   auth.js for this page load only — never written to sessionStorage,
   localStorage, or disk) to authorize every add/remove/change call. The
   actual admin check always happens server-side in the Apps Script API —
   hiding this tab from normal users in the UI is just a convenience, not
   the security boundary.
   ========================================================================== */
(function () {
  'use strict';

  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function auth() { return window.SqlMapAuth; }

  function openModal() {
    var m = $('#configModal');
    if (!m) return;
    m.hidden = false;
    loadUsers();
  }

  function closeModal() {
    var m = $('#configModal');
    if (m) m.hidden = true;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderUsers(list, currentUsername) {
    var wrap = $('#userListWrap');
    if (!wrap) return;
    if (!list || !list.length) {
      wrap.innerHTML = '<p class="muted small">ไม่มีสมาชิก</p>';
      return;
    }
    var rows = list.map(function (u) {
      var isSelf = String(u.username).toLowerCase() === String(currentUsername || '').toLowerCase();
      return '' +
        '<tr>' +
        '<td>' + escapeHtml(u.displayName) + '<div class="muted small">' + escapeHtml(u.username) + '</div></td>' +
        '<td><span class="tag role-' + escapeHtml(u.role) + '">' + escapeHtml(u.role) + '</span></td>' +
        '<td class="userActions">' +
        '<button class="ghost small" data-pw="' + escapeHtml(u.username) + '">เปลี่ยนรหัสผ่าน</button>' +
        (isSelf ? '' : '<button class="icon danger" data-del="' + escapeHtml(u.username) + '" title="ลบสมาชิก">✕</button>') +
        '</td>' +
        '</tr>';
    }).join('');
    wrap.innerHTML =
      '<table><thead><tr><th>สมาชิก</th><th>สิทธิ์</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';

    $all('[data-del]').forEach(function (btn) {
      btn.addEventListener('click', function () { removeUser(btn.getAttribute('data-del')); });
    });
    $all('[data-pw]').forEach(function (btn) {
      btn.addEventListener('click', function () { promptChangePassword(btn.getAttribute('data-pw')); });
    });
  }

  function loadUsers() {
    var session = auth().getSession();
    var wrap = $('#userListWrap');
    if (wrap) wrap.innerHTML = '<p class="muted small">กำลังโหลด...</p>';
    auth().callApi('listUsers', { adminUser: session.username, adminPass: auth().getPassword() }).then(function (r) {
      if (r && r.ok) {
        renderUsers(r.users, session.username);
      } else if (wrap) {
        var msg = (r && r.error === 'forbidden')
          ? 'ยืนยันตัวตนไม่สำเร็จ — ลอง logout แล้ว login ใหม่อีกครั้ง'
          : 'โหลดรายชื่อไม่สำเร็จ (' + escapeHtml((r && r.error) || 'unknown') + ')';
        wrap.innerHTML = '<p class="muted small">' + msg + '</p>';
      }
    });
  }

  function removeUser(username) {
    if (!confirm('ลบสมาชิก "' + username + '" ใช่หรือไม่?')) return;
    var session = auth().getSession();
    auth().callApi('removeUser', { adminUser: session.username, adminPass: auth().getPassword(), username: username }).then(function (r) {
      if (r && r.ok) loadUsers();
      else alert('ลบไม่สำเร็จ: ' + ((r && r.error) || 'unknown'));
    });
  }

  function promptChangePassword(username) {
    var np = prompt('รหัสผ่านใหม่สำหรับ "' + username + '"');
    if (!np) return;
    var session = auth().getSession();
    auth().callApi('changePassword', {
      adminUser: session.username, adminPass: auth().getPassword(), username: username, newPassword: np
    }).then(function (r) {
      if (!r || !r.ok) alert('เปลี่ยนรหัสผ่านไม่สำเร็จ: ' + ((r && r.error) || 'unknown'));
      else alert('เปลี่ยนรหัสผ่านให้ "' + username + '" แล้ว');
    });
  }

  function addUser(e) {
    e.preventDefault();
    var session = auth().getSession();
    var username = $('#newUsername').value.trim();
    var displayName = $('#newDisplayName').value.trim();
    var password = $('#newPassword').value;
    var role = $('#newRole').value;
    var msg = $('#addUserMsg');
    if (msg) msg.hidden = true;
    if (!username || !password) return;
    auth().callApi('addUser', {
      adminUser: session.username, adminPass: auth().getPassword(),
      username: username, displayName: displayName, password: password, role: role
    }).then(function (r) {
      if (r && r.ok) {
        $('#addUserForm').reset();
        loadUsers();
      } else if (msg) {
        msg.textContent = 'เพิ่มสมาชิกไม่สำเร็จ: ' + ((r && r.error) || 'unknown');
        msg.hidden = false;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var openBtn = $('#btnConfig');
    if (openBtn) openBtn.addEventListener('click', openModal);

    var closeBtn = $('#btnConfigClose');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    var addForm = $('#addUserForm');
    if (addForm) addForm.addEventListener('submit', addUser);
  });
})();
