/**
 * NTA 預約系統 — Google Apps Script 後端
 * 資料存在綁定的 Google 試算表：工作表「bookings」（預約）與「locks」（管理人鎖定的時段）。
 * 安裝步驟請見 README.md。
 */

// ★ 請改成你自己的管理密碼（這份程式碼只存在你的 Google 帳號裡，不會公開）
const ADMIN_KEY = 'change-me';

const BOOK_HEADERS = ['id', 'createdAt', 'status', 'kind', 'name', 'sid', 'dept', 'advisor', 'email', 'phone', 'slots', 'hours', 'cost', 'adminNote', 'payload'];
const LOCK_HEADERS = ['slot', 'reason', 'at'];

function doPost(e) {
  let p = {};
  try { p = JSON.parse(e.postData.contents); } catch (err) { return out({ error: '格式錯誤' }); }
  return handle(p);
}
function doGet(e) { return handle(e.parameter || {}); }

function handle(p) {
  try {
    switch (p.action) {
      case 'ping': return out({ ok: true });
      case 'slots': return out({ slots: publicSlots() });
      case 'book': return out(book(p.booking));
      case 'admin_list': auth(p); return out({ bookings: listBookings(), locks: listLocks() });
      case 'admin_status': auth(p); return out(setStatus(p.id, p.status, p.note));
      case 'admin_lock': auth(p); return out(lockSlots(p.slots || [], p.reason || ''));
      case 'admin_unlock': auth(p); return out(unlockSlots(p.slots || []));
      default: return out({ error: '未知的動作：' + p.action });
    }
  } catch (err) {
    return out({ error: String(err && err.message || err) });
  }
}

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function auth(p) { if (!p.key || p.key !== ADMIN_KEY) throw new Error('管理密碼錯誤'); }

function sheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(headers); sh.setFrozenRows(1); }
  return sh;
}
function rows(sh) {
  const v = sh.getDataRange().getValues(), h = v.shift();
  return v.map((r, i) => { const o = { _row: i + 2 }; h.forEach((k, j) => o[k] = r[j]); return o; });
}

function listBookings() {
  return rows(sheet('bookings', BOOK_HEADERS)).map(r => {
    let b = {}; try { b = JSON.parse(r.payload); } catch (e) { }
    b.id = r.id; b.status = r.status; b.adminNote = r.adminNote || '';
    b.createdAt = r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt;
    return b;
  }).reverse();
}
function listLocks() {
  const m = {};
  rows(sheet('locks', LOCK_HEADERS)).forEach(r => { m[String(r.slot)] = { reason: r.reason || '', at: String(r.at || '') }; });
  return m;
}
function slotMap() {
  const m = {};
  listBookings().forEach(b => {
    if (b.status === 'pending' || b.status === 'approved')
      (b.slots || []).forEach(s => { m[s] = { state: b.status === 'approved' ? 'booked' : 'pending', id: b.id }; });
  });
  const locks = listLocks();
  Object.keys(locks).forEach(k => { m[k] = { state: 'locked', reason: locks[k].reason }; });
  return m;
}
function publicSlots() {
  // 對外只回傳時段狀態，不含申請人資料
  const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd'), m = slotMap(), o = {};
  Object.keys(m).forEach(k => { if (k.split('|')[0] >= today) o[k] = { state: m[k].state, reason: m[k].reason || '' }; });
  return o;
}

function book(b) {
  if (!b || !b.applicant || !b.applicant.name || !b.applicant.email) throw new Error('申請資料不完整');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const m = slotMap(), clash = (b.slots || []).filter(s => m[s]);
    if (clash.length) throw new Error('CONFLICT:' + clash.join(','));
    const sh = sheet('bookings', BOOK_HEADERS);
    const prefix = 'NTA-' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd') + '-';
    const ids = rows(sh).map(r => String(r.id));
    let n = 1; while (ids.indexOf(prefix + ('00' + n).slice(-3)) >= 0) n++;
    const id = prefix + ('00' + n).slice(-3), now = new Date();
    const a = b.applicant;
    const payload = Object.assign({}, b, { id: id, createdAt: now.toISOString(), status: 'pending' });
    sh.appendRow([id, now, 'pending', b.kind, a.name, a.sid, a.dept, a.advisor, a.email, a.phone,
      (b.slots || []).join(', '), b.hours, b.cost, '', JSON.stringify(payload)]);
    return { id: id, status: 'pending', createdAt: now.toISOString() };
  } finally { lock.releaseLock(); }
}

function setStatus(id, status, note) {
  if (['pending', 'approved', 'rejected', 'cancelled'].indexOf(status) < 0) throw new Error('狀態不正確');
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const sh = sheet('bookings', BOOK_HEADERS), r = rows(sh).filter(x => String(x.id) === String(id))[0];
    if (!r) throw new Error('找不到這筆預約');
    if (status === 'approved' || status === 'pending') {
      let b = {}; try { b = JSON.parse(r.payload); } catch (e) { }
      const m = slotMap(), clash = (b.slots || []).filter(s => m[s] && m[s].id !== id);
      if (clash.length) throw new Error('時段已被佔用：' + clash.join(', '));
    }
    sh.getRange(r._row, BOOK_HEADERS.indexOf('status') + 1).setValue(status);
    if (note != null) sh.getRange(r._row, BOOK_HEADERS.indexOf('adminNote') + 1).setValue(note);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

function lockSlots(slots, reason) {
  const sh = sheet('locks', LOCK_HEADERS), have = listLocks(), now = new Date().toISOString();
  slots.forEach(s => { if (!have[s]) sh.appendRow([s, reason, now]); });
  return { ok: true };
}
function unlockSlots(slots) {
  const sh = sheet('locks', LOCK_HEADERS), rs = rows(sh);
  rs.filter(r => slots.indexOf(String(r.slot)) >= 0).map(r => r._row).sort((a, b) => b - a).forEach(i => sh.deleteRow(i));
  return { ok: true };
}

/** 第一次安裝時可手動執行一次，建立工作表並授權 */
function setup() { sheet('bookings', BOOK_HEADERS); sheet('locks', LOCK_HEADERS); }
