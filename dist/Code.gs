/**
 * NTA 預約系統 — Google Apps Script 後端
 * 資料存在綁定的 Google 試算表：工作表「bookings」（預約）與「locks」（管理人鎖定的時段）。
 * 安裝與更新步驟請見 README.md／安裝說明.txt。
 */

// ★ 請改成你自己的管理密碼（這份程式碼只存在你的 Google 帳號裡，不會公開）
const ADMIN_KEY = 'change-me';

// ★ 通知信收件人（管理人員）。留空 = 寄給部署這份程式的 Google 帳號本人。多人用逗號分隔。
const NOTIFY_EMAIL = '';

// ★ 預約網站網址（通知信裡的連結會用到）
const SITE_URL = 'https://ylwanglab327.github.io/NTA-booking/';

const BILL_UNIT_MINUTES = 15;   // 簽退計費單位（分鐘），需與網站 CONFIG.billUnitMinutes 相同
const TZ = 'Asia/Taipei';

const BOOK_HEADERS = ['id', 'createdAt', 'status', 'kind', 'name', 'sid', 'dept', 'advisor', 'email', 'phone', 'slots', 'hours', 'cost', 'adminNote', 'payload',
  'checkoutAt', 'billStart', 'billMinutes', 'billRate', 'billAmount', 'settledBy'];
const LOCK_HEADERS = ['slot', 'reason', 'at'];
const KIND_LABEL = { consult: '預約諮詢', service: '委託代工', training: '機台訓練', exam: '機台考核', self: '自行操作' };
const STATUS_LABEL = { pending: '待確認', approved: '已核准', completed: '已結算', rejected: '已退回', cancelled: '已取消' };

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
      case 'lookup': return out({ booking: findForUser(p.id, p.email).b, now: new Date().toISOString() });
      case 'checkout': return out(userCheckout(p.id, p.email));
      case 'admin_list': auth(p); return out({ bookings: listBookings(), locks: listLocks() });
      case 'admin_status': auth(p); return out(setStatus(p.id, p.status, p.note));
      case 'admin_complete': auth(p); return out(adminComplete(p));
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

/* ---------- 試算表 ---------- */
function sheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(headers); sh.setFrozenRows(1); return sh; }
  // 舊版工作表自動補上新欄位
  const have = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(String);
  const missing = headers.filter(h => have.indexOf(h) < 0);
  if (missing.length) sh.getRange(1, have.filter(String).length + 1, 1, missing.length).setValues([missing]);
  return sh;
}
function headerIndex(sh) {
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String), m = {};
  h.forEach((k, i) => { if (k) m[k] = i + 1; });
  return m;
}
function rows(sh) {
  const v = sh.getDataRange().getValues(), h = v.shift();
  return v.map((r, i) => { const o = { _row: i + 2 }; h.forEach((k, j) => o[k] = r[j]); return o; });
}
function iso(v) { return v instanceof Date ? v.toISOString() : (v || ''); }
function toBooking(r) {
  let b = {}; try { b = JSON.parse(r.payload); } catch (e) { }
  b.id = r.id; b.status = r.status; b.adminNote = r.adminNote || '';
  b.createdAt = iso(r.createdAt);
  b.checkoutAt = iso(r.checkoutAt); b.billStart = iso(r.billStart);
  b.billMinutes = Number(r.billMinutes || 0); b.billRate = Number(r.billRate || 0); b.billAmount = Number(r.billAmount || 0);
  b.settledBy = r.settledBy || '';
  return b;
}
function listBookings() { return rows(sheet('bookings', BOOK_HEADERS)).map(toBooking).reverse(); }
function listLocks() {
  const m = {};
  rows(sheet('locks', LOCK_HEADERS)).forEach(r => { m[String(r.slot)] = { reason: r.reason || '', at: String(r.at || '') }; });
  return m;
}
function slotMap() {
  const m = {};
  listBookings().forEach(b => {
    if (['pending', 'approved', 'completed'].indexOf(b.status) >= 0)
      (b.slots || []).forEach(s => { m[s] = { state: b.status === 'pending' ? 'pending' : 'booked', id: b.id }; });
  });
  const locks = listLocks();
  Object.keys(locks).forEach(k => { m[k] = { state: 'locked', reason: locks[k].reason }; });
  return m;
}
function publicSlots() {
  // 對外只回傳時段狀態，不含申請人資料
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'), m = slotMap(), o = {};
  Object.keys(m).forEach(k => { if (k.split('|')[0] >= today) o[k] = { state: m[k].state, reason: m[k].reason || '' }; });
  return o;
}
function updateRow(sh, row, fields) {
  const idx = headerIndex(sh);
  Object.keys(fields).forEach(k => { if (idx[k]) sh.getRange(row, idx[k]).setValue(fields[k]); });
}
function findRow(id) {
  const sh = sheet('bookings', BOOK_HEADERS), r = rows(sh).filter(x => String(x.id) === String(id).trim().toUpperCase())[0];
  if (!r) throw new Error('找不到這筆預約');
  return { sh: sh, r: r, b: toBooking(r) };
}
function findForUser(id, email) {
  let f; try { f = findRow(id); } catch (e) { f = null; }
  if (!f || String((f.b.applicant || {}).email || '').toLowerCase() !== String(email || '').trim().toLowerCase())
    throw new Error('找不到這筆預約，請確認申請編號與 Email');
  return f;
}

/* ---------- 時間與計費 ---------- */
function slotStart(k) { const p = k.split('|'); return new Date(p[0] + 'T' + ('0' + p[1]).slice(-2) + ':00:00+08:00'); }
function bookingStart(b) {
  const s = (b.slots || []).slice().sort((x, y) => slotStart(x) - slotStart(y))[0];
  return s ? slotStart(s) : null;
}
function fmtSlot(k) { const p = k.split('|'), h = Number(p[1]); return p[0] + ' ' + ('0' + h).slice(-2) + ':00–' + ('0' + (h + 1)).slice(-2) + ':00'; }
function fmtTime(d) { return d ? Utilities.formatDate(new Date(d), TZ, 'yyyy-MM-dd HH:mm') : ''; }
function fmtDuration(min) { const h = Math.floor(min / 60), m = min % 60; return ((h ? h + ' 小時' : '') + (m ? ' ' + m + ' 分鐘' : '')).trim() || '0 分鐘'; }
function money(n) { return 'NT$ ' + Number(n || 0).toLocaleString('en-US'); }

function settle(b, o) {
  o = o || {};
  const rate = (o.rate != null && o.rate !== '') ? Number(o.rate) : Number(b.rate || 0);
  const end = o.end ? new Date(o.end) : new Date();
  if (b.unit === '套' || b.kind === 'consult')
    return { checkoutAt: end, billStart: '', billMinutes: 0, billRate: rate, billAmount: b.kind === 'consult' ? 0 : Number(b.cost || 0) };
  let mins, start = '';
  if (o.minutes != null && o.minutes !== '') mins = Number(o.minutes);
  else { const st = bookingStart(b); if (!st) throw new Error('這筆預約沒有時段，請輸入實際分鐘數'); start = st; mins = (end - st) / 60000; }
  if (!(mins > 0)) throw new Error('簽退時間必須晚於預約開始時間');
  const billMinutes = Math.ceil(mins / BILL_UNIT_MINUTES) * BILL_UNIT_MINUTES;
  return { checkoutAt: end, billStart: start, billMinutes: billMinutes, billRate: rate, billAmount: Math.round(rate * billMinutes / 60) };
}

/* ---------- 動作 ---------- */
function book(b) {
  if (!b || !b.applicant || !b.applicant.name || !b.applicant.email) throw new Error('申請資料不完整');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  let id, now;
  try {
    const m = slotMap(), clash = (b.slots || []).filter(s => m[s]);
    if (clash.length) throw new Error('CONFLICT:' + clash.join(','));
    const sh = sheet('bookings', BOOK_HEADERS);
    const prefix = 'NTA-' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd') + '-';
    const ids = rows(sh).map(r => String(r.id));
    let n = 1; while (ids.indexOf(prefix + ('00' + n).slice(-3)) >= 0) n++;
    id = prefix + ('00' + n).slice(-3); now = new Date();
    const a = b.applicant;
    const payload = Object.assign({}, b, { id: id, createdAt: now.toISOString(), status: 'pending' });
    const idx = headerIndex(sh), row = new Array(sh.getLastColumn()).fill('');
    const vals = { id: id, createdAt: now, status: 'pending', kind: b.kind, name: a.name, sid: a.sid, dept: a.dept, advisor: a.advisor, email: a.email, phone: a.phone,
      slots: (b.slots || []).join(', '), hours: b.hours, cost: b.cost, adminNote: '', payload: JSON.stringify(payload) };
    Object.keys(vals).forEach(k => { if (idx[k]) row[idx[k] - 1] = vals[k]; });
    sh.appendRow(row);
    b = payload;
  } finally { lock.releaseLock(); }
  notifyNewBooking(b);
  return { id: id, status: 'pending', createdAt: now.toISOString() };
}

function setStatus(id, status, note) {
  if (['pending', 'approved', 'rejected', 'cancelled'].indexOf(status) < 0) throw new Error('狀態不正確');
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  let f, prev;
  try {
    f = findRow(id); prev = f.b.status;
    if (status === 'approved' || status === 'pending') {
      const m = slotMap(), clash = (f.b.slots || []).filter(s => m[s] && m[s].id !== f.b.id);
      if (clash.length) throw new Error('時段已被佔用：' + clash.join(', '));
    }
    const fields = { status: status }; if (note != null) fields.adminNote = note;
    updateRow(f.sh, f.r._row, fields);
  } finally { lock.releaseLock(); }
  f.b.status = status; if (note != null) f.b.adminNote = note;
  if (status !== 'pending' && !(status === 'approved' && prev === 'completed')) notifyStatus(f.b);
  return { ok: true };
}

function userCheckout(id, email) {
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  let f;
  try {
    f = findForUser(id, email);
    const b = f.b;
    if (b.status === 'completed') throw new Error('這筆預約已經簽退結算過了');
    if (b.status !== 'approved') throw new Error('預約尚未核准，無法簽退');
    if (b.kind !== 'self') throw new Error('此類預約由管理人員結算，不需簽退');
    const st = bookingStart(b), now = new Date();
    if (now < st) throw new Error('預約時段尚未開始，無法簽退');
    if (now - st > 24 * 3600e3) throw new Error('已超過可簽退時間，請聯絡機台管理人員補登');
    const s = settle(b, { end: now });
    updateRow(f.sh, f.r._row, Object.assign({ status: 'completed', settledBy: 'user' }, s));
    Object.assign(b, s, { status: 'completed', settledBy: 'user', checkoutAt: s.checkoutAt.toISOString(), billStart: s.billStart ? s.billStart.toISOString() : '' });
  } finally { lock.releaseLock(); }
  notifySettled(f.b);
  return { booking: f.b };
}

function adminComplete(p) {
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  let f;
  try {
    f = findRow(p.id);
    const s = settle(f.b, { end: p.end, minutes: p.minutes, rate: p.rate });
    const fields = Object.assign({ status: 'completed', settledBy: 'admin' }, s);
    if (p.note != null) fields.adminNote = p.note;
    updateRow(f.sh, f.r._row, fields);
    Object.assign(f.b, s, { status: 'completed', settledBy: 'admin', checkoutAt: s.checkoutAt.toISOString(), billStart: s.billStart ? s.billStart.toISOString() : '' });
    if (p.note != null) f.b.adminNote = p.note;
  } finally { lock.releaseLock(); }
  if (f.b.billAmount > 0) notifySettled(f.b);
  return { ok: true };
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

/* ---------- Email 通知 ---------- */
function adminEmail() { return NOTIFY_EMAIL || Session.getEffectiveUser().getEmail(); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function sendMail(to, subject, rowsArr, intro, outro) {
  if (!to) return;
  const table = '<table style="border-collapse:collapse;font-size:14px">' + rowsArr.filter(r => r[1] !== '' && r[1] != null).map(r =>
    '<tr><td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap;vertical-align:top">' + esc(r[0]) + '</td><td style="padding:4px 0">' + (r[2] ? r[1] : esc(r[1]).replace(/\n/g, '<br>')) + '</td></tr>').join('') + '</table>';
  const html = '<div style="font-family:Microsoft JhengHei,PingFang TC,sans-serif;font-size:14px;line-height:1.6;color:#222">' +
    '<p>' + intro + '</p>' + table + (outro ? '<p>' + outro + '</p>' : '') +
    '<p style="color:#888;font-size:12px;margin-top:24px">此信由 NTA 機台預約系統自動寄出。</p></div>';
  try { MailApp.sendEmail({ to: to, subject: subject, htmlBody: html, name: 'NTA 機台預約系統', replyTo: adminEmail() }); }
  catch (e) { console.error('寄信失敗：' + e); }
}
function summaryRows(b) {
  const a = b.applicant || {};
  return [['申請編號', b.id], ['申請人', a.name + '（' + (a.dept || '') + '）'], ['指導教授', a.advisor], ['服務類型', KIND_LABEL[b.kind] || b.kind],
    ['預約時段', (b.slots || []).slice().sort((x, y) => slotStart(x) - slotStart(y)).map(fmtSlot).join('\n')], ['報價金額', money(b.cost)]];
}
function notifyNewBooking(b) {
  const a = b.applicant || {};
  sendMail(adminEmail(), '【NTA 新預約】' + a.name + '｜' + (KIND_LABEL[b.kind] || b.kind) + '｜' + b.id,
    summaryRows(b).concat([['Email', a.email], ['電話', a.phone]]),
    '有一筆新的 NTA 預約申請，等待審核。',
    '<a href="' + SITE_URL + '#admin">前往管理頁審核</a>');
  sendMail(a.email, '【NTA 預約】已收到您的申請（' + b.id + '）', summaryRows(b),
    esc(a.name) + ' 您好，已收到您的 NTA 預約申請，目前狀態為「待確認」。管理人員核准後會再寄信通知您。',
    '請保留申請編號 <b>' + esc(b.id) + '</b>，簽退時需要使用。');
}
function notifyStatus(b) {
  const a = b.applicant || {}, st = STATUS_LABEL[b.status] || b.status;
  let intro = esc(a.name) + ' 您好，您的 NTA 預約狀態已更新為「' + st + '」。', outro = '';
  if (b.status === 'approved') {
    intro = esc(a.name) + ' 您好，您的 NTA 預約已核准。';
    if (b.kind === 'self') outro = '使用完畢後，請到 <a href="' + SITE_URL + '#checkout">簽退頁面</a> 輸入申請編號與 Email 完成簽退。費用從預約開始時間計算到簽退時間，每 ' + BILL_UNIT_MINUTES + ' 分鐘為一計費單位。';
  }
  sendMail(a.email, '【NTA 預約】' + st + '（' + b.id + '）', summaryRows(b).concat([['管理人員備註', b.adminNote]]), intro, outro);
}
function notifySettled(b) {
  const a = b.applicant || {};
  const r = [['申請編號', b.id], ['申請人', a.name], ['服務類型', KIND_LABEL[b.kind] || b.kind]];
  if (b.billStart) r.push(['計費起始', fmtTime(b.billStart)]);
  r.push([b.kind === 'self' ? '簽退時間' : '結算時間', fmtTime(b.checkoutAt)]);
  if (b.unit !== '套') r.push(['計費時間', fmtDuration(b.billMinutes)], ['單價', money(b.billRate) + ' / hr']);
  r.push(['應繳金額', '<b>' + money(b.billAmount) + '</b>', true]);
  sendMail(a.email, '【NTA 繳費通知】' + b.id + '｜' + money(b.billAmount), r,
    esc(a.name) + ' 您好，您的 NTA 使用已結算，費用如下。',
    '繳費單可在 <a href="' + SITE_URL + '#checkout">簽退頁面</a> 輸入申請編號與 Email 下載，請依機台管理單位指示完成繳費。');
  sendMail(adminEmail(), '【NTA 已結算】' + a.name + '｜' + b.id + '｜' + money(b.billAmount), r, '一筆 NTA 預約已完成結算' + (b.settledBy === 'user' ? '（使用者自行簽退）' : '') + '。', '');
}

/** 第一次安裝或更新後手動執行一次：建立／更新工作表欄位，並授權試算表與寄信權限 */
function setup() {
  sheet('bookings', BOOK_HEADERS); sheet('locks', LOCK_HEADERS);
  MailApp.getRemainingDailyQuota();
}
