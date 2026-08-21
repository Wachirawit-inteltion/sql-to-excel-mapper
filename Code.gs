/* ============================================================================
   Code.gs — Google Apps Script backend for the SQL Mapping tool's login system.

   HOW TO USE (see SETUP_GUIDE.md for the full walkthrough):
   1. Create a new Google Sheet.
   2. Extensions > Apps Script, delete any starter code, paste this whole file in.
   3. Run the "setup" function once (top toolbar > select "setup" > Run).
      This creates the "Users" and "LoginLog" tabs and seeds one default
      admin account: username "admin", password "admin123".
   4. Deploy > New deployment > type "Web app".
        Execute as: Me
        Who has access: Anyone
   5. Copy the deployment URL (ends in /exec) into APPS_SCRIPT_URL in auth.js.
   6. Log in with admin / admin123, then change that password immediately
      from the "ตั้งค่าสมาชิก" (Config) tab.

   SECURITY NOTE: passwords are stored in plain text in the "Users" sheet,
   same as the previous single-password version of this tool — this is a
   lightweight gate for a small team, not a hardened auth system. Anyone
   with edit access to the underlying Google Sheet can read every password.
   Restrict sharing on the Sheet itself accordingly.
   ========================================================================== */

var USERS_SHEET = 'Users';
var LOG_SHEET = 'LoginLog';

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var users = ss.getSheetByName(USERS_SHEET);
  if (!users) {
    users = ss.insertSheet(USERS_SHEET);
    users.appendRow(['username', 'password', 'role', 'displayName']);
    users.appendRow(['admin', 'admin123', 'admin', 'Administrator']);
    users.setFrozenRows(1);
  }

  var log = ss.getSheetByName(LOG_SHEET);
  if (!log) {
    log = ss.insertSheet(LOG_SHEET);
    log.appendRow(['date', 'time', 'username', 'role', 'status']);
    log.setFrozenRows(1);
  }

  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 2) ss.deleteSheet(defaultSheet);
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, msg: 'SQL Mapping Auth API is running' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var result = { ok: false, error: 'unknown_action' };
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var usersSheet = ss.getSheetByName(USERS_SHEET);
    var logSheet = ss.getSheetByName(LOG_SHEET);

    if (!usersSheet || !logSheet) {
      result = { ok: false, error: 'not_setup' };
    } else if (action === 'login') {
      result = handleLogin(usersSheet, logSheet, body);
    } else if (action === 'listUsers') {
      result = handleListUsers(usersSheet, body);
    } else if (action === 'addUser') {
      result = handleAddUser(usersSheet, body);
    } else if (action === 'removeUser') {
      result = handleRemoveUser(usersSheet, body);
    } else if (action === 'changePassword') {
      result = handleChangePassword(usersSheet, body);
    } else if (action === 'verifyAdmin') {
      result = { ok: isAdmin(usersSheet, body.adminUser, body.adminPass) };
    }
  } catch (err) {
    result = { ok: false, error: 'server_error', detail: String(err) };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------------------------------------------------------- helpers ---- */

function findUserRow(usersSheet, username) {
  var data = usersSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === String(username || '').toLowerCase()) {
      return {
        row: i + 1,
        username: data[i][0],
        password: data[i][1],
        role: data[i][2],
        displayName: data[i][3] || data[i][0]
      };
    }
  }
  return null;
}

function isAdmin(usersSheet, username, password) {
  var u = findUserRow(usersSheet, username);
  return !!(u && String(u.password) === String(password) && u.role === 'admin');
}

function logEvent(logSheet, username, role, status) {
  var now = new Date();
  var tz = Session.getScriptTimeZone();
  var date = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var time = Utilities.formatDate(now, tz, 'HH:mm:ss');
  logSheet.appendRow([date, time, username || '', role || '', status]);
}

/* ---------------------------------------------------------- actions ---- */

function handleLogin(usersSheet, logSheet, body) {
  var u = findUserRow(usersSheet, body.username);
  if (u && String(u.password) === String(body.password)) {
    logEvent(logSheet, u.username, u.role, 'success');
    return { ok: true, username: u.username, role: u.role, displayName: u.displayName };
  }
  logEvent(logSheet, body.username, '', 'fail');
  return { ok: false, error: 'invalid_credentials' };
}

function handleListUsers(usersSheet, body) {
  if (!isAdmin(usersSheet, body.adminUser, body.adminPass)) return { ok: false, error: 'forbidden' };
  var data = usersSheet.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < data.length; i++) {
    list.push({ username: data[i][0], role: data[i][2], displayName: data[i][3] || data[i][0] });
  }
  return { ok: true, users: list };
}

function handleAddUser(usersSheet, body) {
  if (!isAdmin(usersSheet, body.adminUser, body.adminPass)) return { ok: false, error: 'forbidden' };
  if (!body.username || !body.password) return { ok: false, error: 'missing_fields' };
  if (findUserRow(usersSheet, body.username)) return { ok: false, error: 'exists' };
  var role = body.role === 'admin' ? 'admin' : 'normal';
  usersSheet.appendRow([body.username, body.password, role, body.displayName || body.username]);
  return { ok: true };
}

function handleRemoveUser(usersSheet, body) {
  if (!isAdmin(usersSheet, body.adminUser, body.adminPass)) return { ok: false, error: 'forbidden' };
  if (String(body.username).toLowerCase() === String(body.adminUser).toLowerCase()) {
    return { ok: false, error: 'cannot_remove_self' };
  }
  var u = findUserRow(usersSheet, body.username);
  if (!u) return { ok: false, error: 'not_found' };
  usersSheet.deleteRow(u.row);
  return { ok: true };
}

function handleChangePassword(usersSheet, body) {
  if (!isAdmin(usersSheet, body.adminUser, body.adminPass)) return { ok: false, error: 'forbidden' };
  var u = findUserRow(usersSheet, body.username);
  if (!u) return { ok: false, error: 'not_found' };
  if (!body.newPassword) return { ok: false, error: 'missing_fields' };
  usersSheet.getRange(u.row, 2).setValue(body.newPassword);
  return { ok: true };
}
