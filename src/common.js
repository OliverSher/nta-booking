/* =====================================================================
   NTA 預約系統 — 共用設定與功能（申請頁 index.html、管理頁 admin.html 共用）
   ===================================================================== */

/* ========= 設定區：部署時只要改這裡 ========= */
const CONFIG = {
  // 部署 Google Apps Script 後，把 Web App 網址貼在這裡（見 README）。
  // 留空 = 示範模式：資料只存在目前這個瀏覽器，別人看不到。
  apiUrl: "https://script.google.com/macros/s/AKfycbxZuAXyiHFgvRcFwOBe8ZINKXKTqA9QoC7-D7hD0EGqVm8YQ7AM989QeGq_i6dt_hJs/exec",

  unit: "國立清華大學 NTA 機台管理單位",          // 報表抬頭
  instrument: "奈米粒子追蹤分析儀 (NTA)",
  // 收費身分（申請人於第一步選擇，管理人員核對）
  rateGroups: [
    { id: "coe",      label: "清大工學院" },
    { id: "nthu",     label: "清大（工學院以外）" },
    { id: "academic", label: "學界（校外學術單位）" },
    { id: "industry", label: "業界" }
  ],
  // 收費標準（NT$），依 2026 年 NTA（Nanosight）使用收費表
  rates: {
    self:     { sponsor: 300,  coe: 400,  nthu: 500,  academic: 750,  industry: 1000 },  // 自行操作，元/hr
    service:  { sponsor: 750,  coe: 750,  nthu: 750,  academic: 1000, industry: 1750 },  // 代工量測，元/hr
    training: { sponsor: 3000, coe: 3000, nthu: 3000, academic: 3000, industry: 5000 }   // 訓練課程（訓練＋考核），元/套
  },
  // 先期贊助（配合款）教授：會列在「收費身分」下拉選單，選擇後適用 rates 裡的 sponsor 價格
  sponsorAdvisors: ["陳玉彬", "李明蒼", "黃振煌", "黃郁棻", "林幸瑩", "魯才德", "蔡德豪", "陳之碩", "王玉麟"],
  billUnitMinutes: 15,                           // 簽退計費單位（分鐘），不足一單位以一單位計
  selfCheckoutDays: 7,                           // 預約開始後幾天內可自行簽退（超過由管理人員代為簽退）
  paymentNote: "請於收到繳費單後依機台管理單位指示完成繳費；校內計畫經費請辦理經費轉帳。",  // 繳費單上的繳費說明
  hours: [9, 10, 11, 13, 14, 15, 16],            // 可預約起始時段（避開午休 12:00）
  maxSelfHours: 4,                               // 自行操作單次最多時數
  weeksAhead: 8,                                 // 開放預約幾週內的時段
  startWeekOffset: 0,                            // 0 = 本週起可預約；1 = 下週起；-1 = 上週起（可補登上週的使用）
  allowPastSlots: true,                          // true = 已經過去的時段也可以預約（補登用）
  departments: ["動力機械工程學系", "奈米工程與微系統研究所", "化學工程學系", "材料科學工程學系", "醫學科學系", "生命科學系", "分析與環境科學研究所", "校外單位", "其他（請於備註說明）"]
};
/* ========================================== */

const DEMO = !CONFIG.apiUrl;
const DEMO_ADMIN_KEY = "demo";

const RATE_LABEL = { consult: "預約諮詢", service: "委託代工", training: "機台訓練", exam: "機台考核", self: "自行操作" };
const groupLabel = id => id === "sponsor" ? "先期贊助" : ((CONFIG.rateGroups.find(g => g.id === id) || {}).label || "—");

/* 先期贊助：指導教授姓名比對名單（忽略空白與「教授／老師」等稱謂） */
function sponsorMatch(advisor) {
  const n = String(advisor || "").replace(/\s|教授|老師|博士/g, "");
  return n ? (CONFIG.sponsorAdvisors.find(x => n.includes(x)) || "") : "";
}
/* 收費身分值：一般身分為 "coe" 等；先期贊助為 "sponsor:教授姓名" */
const sponsorOf = g => String(g || "").startsWith("sponsor:") ? String(g).slice(8) : "";
function billingGroup(a) { return sponsorOf((a || {}).rateGroup) ? "sponsor" : (a || {}).rateGroup; }
function billingLabel(a) {
  const m = sponsorOf((a || {}).rateGroup);
  return m ? `先期贊助（${m} 教授）` : groupLabel((a || {}).rateGroup);
}
function rateGroupOptions(sel) {
  const o = (v, l) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(l)}</option>`;
  return `<option value="">請選擇</option>
    <optgroup label="先期贊助教授之學生">${CONFIG.sponsorAdvisors.map(n => o("sponsor:" + n, `先期贊助－${n} 教授`)).join("")}</optgroup>
    <optgroup label="一般收費">${CONFIG.rateGroups.map(g => o(g.id, g.label)).join("")}</optgroup>`;
}

/* 計價：回傳 {rate, unit, qty, cost, note}
   ・訓練課程按「套」收費（含 3 次訓練＋考核），於預約第 1 次訓練時計費；第 2、3 次訓練與考核不另收費 */
function priceFor(kind, group, { hours = 0, round = "1" } = {}) {
  const R = CONFIG.rates;
  if (kind === "consult") return { rate: 0, unit: "hr", qty: 0, cost: 0, note: "諮詢不收費" };
  if (kind === "service") { const r = R.service[group] || 0; return { rate: r, unit: "hr", qty: hours, cost: r * hours, note: "代工量測" }; }
  if (kind === "self") { const r = R.self[group] || 0; return { rate: r, unit: "hr", qty: hours, cost: r * hours, note: "自行操作" }; }
  const r = R.training[group] || 0;
  if (kind === "training" && String(round) === "1") return { rate: r, unit: "套", qty: 1, cost: r, note: "訓練課程（3 次訓練＋考核）" };
  return { rate: r, unit: "套", qty: 0, cost: 0, note: "已含於訓練課程費用" };
}
function priceTableHtml(highlight) {
  const R = CONFIG.rates, c = n => n.toLocaleString("zh-TW");
  const groups = [{ id: "sponsor", label: "先期贊助教授之學生" }, ...CONFIG.rateGroups];
  return `<div class="rec-scroll"><table class="rec pricetable"><tr><th>收費身分</th><th>自行操作<br>元/hr</th><th>代工量測<br>元/hr</th><th>訓練課程（訓練＋考核）<br>元/套</th></tr>
    ${groups.map(g => `<tr${g.id === highlight ? ' class="hl"' : ""}><td>${esc(g.label)}</td><td class="mono">${c(R.self[g.id])}</td><td class="mono">${c(R.service[g.id])}</td><td class="mono">${c(R.training[g.id])}</td></tr>`).join("")}</table></div>
    <p class="hint" style="margin:6px 0 0">先期贊助教授：${CONFIG.sponsorAdvisors.map(esc).join("、")}。指導教授在名單上的同學，收費身分請選「先期贊助－教授姓名」。</p>`;
}
const STATUS_LABEL = { pending: "待確認", approved: "已核准", completed: "已結算", rejected: "已退回", cancelled: "已取消" };
const WD = ["一", "二", "三", "四", "五"];

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = n => "NT$ " + Number(n || 0).toLocaleString("zh-TW");
const H = h => ({ h });   // 標記「已處理好的 HTML」

/* ----- 日期 ----- */
function mondayOf(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; }
function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function weekDays(offset) { const m = mondayOf(new Date()); m.setDate(m.getDate() + 7 * offset); return [0, 1, 2, 3, 4].map(i => { const d = new Date(m); d.setDate(m.getDate() + i); return d; }); }
function slotStartDate(k) { const [d, h] = k.split("|"); return new Date(`${d}T${String(h).padStart(2, "0")}:00:00+08:00`); }
const slotCmp = (a, b) => slotStartDate(a) - slotStartDate(b);
function bookingStart(b) { const s = (b.slots || []).slice().sort(slotCmp)[0]; return s ? slotStartDate(s) : null; }
function fmtDuration(min) { min = Math.round(min); const h = Math.floor(min / 60), m = min % 60; return [h ? h + " 小時" : "", m ? m + " 分鐘" : ""].filter(Boolean).join(" ") || "0 分鐘"; }
/* 結算：自行操作＝預約開始→簽退；代工＝管理人員輸入的分鐘數；訓練＝按套 */
function settle(b, { end, minutes, rate } = {}) {
  const U = CONFIG.billUnitMinutes, r = rate != null && rate !== "" ? Number(rate) : Number(b.rate || 0);
  const endAt = end ? new Date(end) : new Date();
  if (b.unit === "套" || b.kind === "consult") return { checkoutAt: endAt.toISOString(), billStart: "", billMinutes: 0, billRate: r, billAmount: b.kind === "consult" ? 0 : Number(b.cost || 0) };
  let mins, start = "";
  if (minutes != null && minutes !== "") mins = Number(minutes);
  else { const st = bookingStart(b); if (!st) throw new Error("這筆預約沒有時段，請輸入實際分鐘數"); start = st.toISOString(); mins = (endAt - st) / 60000; }
  if (!(mins > 0)) throw new Error("簽退時間必須晚於預約開始時間");
  const billMinutes = Math.ceil(mins / U) * U;
  return { checkoutAt: endAt.toISOString(), billStart: start, billMinutes, billRate: r, billAmount: Math.round(r * billMinutes / 60) };
}
/* 自行簽退：申請人選擇使用結束時間（15 分鐘一格，不能晚於現在） */
function endOptions(b, now = new Date()) {
  const st = bookingStart(b), U = CONFIG.billUnitMinutes * 60000, out = [];
  if (!st) return out;
  const max = Math.min(st.getTime() + Math.ceil((now - st) / U) * U, st.getTime() + 24 * 3600e3);
  for (let t = st.getTime() + U; t <= max; t += U) out.push(new Date(t));
  return out;
}
function checkUserEnd(b, end, now = new Date()) {
  const st = bookingStart(b), U = CONFIG.billUnitMinutes * 60000, e = new Date(end);
  if (!end || isNaN(e)) throw new Error("請選擇使用結束時間");
  if (now < st) throw new Error("預約時段尚未開始，無法簽退");
  if (now - st > CONFIG.selfCheckoutDays * 86400e3) throw new Error(`預約開始已超過 ${CONFIG.selfCheckoutDays} 天，請聯絡機台管理人員代為簽退`);
  if (e <= st) throw new Error("結束時間必須晚於預約開始時間");
  if ((e - st) % U) throw new Error(`結束時間請以 ${CONFIG.billUnitMinutes} 分鐘為單位`);
  if (e - now > U) throw new Error("結束時間不能晚於現在");
  return e;
}
function fmtSlot(k) { const [d, h] = k.split("|"); return `${d} ${String(h).padStart(2, "0")}:00–${String(+h + 1).padStart(2, "0")}:00`; }
function slotIsPast(k) { const [d, h] = k.split("|"); const t = new Date(d + "T00:00:00"); t.setHours(+h); return t < new Date(); }
function fmtDateTime(iso) { if (!iso) return ""; const d = new Date(iso); return isNaN(d) ? String(iso) : ymd(d) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }

/* =====================================================================
   API：有 apiUrl 就呼叫 Google Apps Script；沒有就用瀏覽器內的示範資料庫
   ===================================================================== */
const LocalDB = {
  KEY: "nta_demo_db_v1", _mem: null,
  load() { try { const s = localStorage.getItem(this.KEY); if (s) return JSON.parse(s); } catch (e) { } return this._mem || { bookings: [], locks: {} }; },
  save(db) { this._mem = db; try { localStorage.setItem(this.KEY, JSON.stringify(db)); } catch (e) { } },
  slotMap(db) {
    const m = {};
    for (const b of db.bookings) if (["pending", "approved", "completed"].includes(b.status))
      for (const s of b.slots || []) m[s] = { state: b.status === "pending" ? "pending" : "booked", id: b.id };
    for (const [k, v] of Object.entries(db.locks)) m[k] = { state: "locked", reason: v.reason || "" };
    return m;
  },
  newId(ids) {
    const p = "NTA-" + ymd(new Date()).replace(/-/g, "") + "-"; let n = 1;
    while (ids.includes(p + String(n).padStart(3, "0"))) n++;
    return p + String(n).padStart(3, "0");
  },
  async handle(action, d) {
    const db = this.load();
    if (action === "slots") { const m = this.slotMap(db); for (const k in m) delete m[k].id; return { slots: m }; }
    if (action === "book") {
      const m = this.slotMap(db), c = (d.booking.slots || []).filter(s => m[s]);
      if (c.length) throw new Error("CONFLICT:" + c.join(","));
      const b = { ...d.booking, id: this.newId(db.bookings.map(x => x.id)), createdAt: new Date().toISOString(), status: "pending", adminNote: "" };
      db.bookings.push(b); this.save(db); return { id: b.id, status: b.status, createdAt: b.createdAt };
    }
    const find = () => {
      const b = db.bookings.find(x => x.id === String(d.id || "").trim().toUpperCase());
      if (!b || String((b.applicant || {}).email || "").toLowerCase() !== String(d.email || "").trim().toLowerCase()) throw new Error("找不到這筆預約，請確認申請編號與 Email");
      return b;
    };
    if (action === "lookup") return { booking: find(), now: new Date().toISOString() };
    if (action === "lookup_email") {
      const em = String(d.email || "").trim().toLowerCase();
      if (!em) throw new Error("請輸入 Email");
      return { bookings: db.bookings.filter(b => String((b.applicant || {}).email || "").toLowerCase() === em).slice().reverse().slice(0, 30), now: new Date().toISOString() };
    }
    if (action === "checkout") {
      const b = find();
      if (b.status === "completed") throw new Error("這筆預約已經簽退結算過了");
      if (b.status !== "approved") throw new Error("預約尚未核准，無法簽退");
      if (b.kind !== "self") throw new Error("此類預約由管理人員結算，不需簽退");
      const e = checkUserEnd(b, d.end);
      Object.assign(b, settle(b, { end: e.toISOString() }), { status: "completed", settledBy: "user", submittedAt: new Date().toISOString() }); this.save(db);
      return { booking: b };
    }
    if (action.startsWith("admin_") && d.key !== DEMO_ADMIN_KEY) throw new Error("管理密碼錯誤");
    if (action === "admin_complete") {
      const b = db.bookings.find(x => x.id === d.id); if (!b) throw new Error("找不到這筆預約");
      Object.assign(b, settle(b, { end: d.end, minutes: d.minutes, rate: d.rate }), { status: "completed", settledBy: "admin" });
      if (d.note != null) b.adminNote = d.note; this.save(db); return { ok: true };
    }
    if (action === "admin_list") return { bookings: db.bookings.slice().reverse(), locks: db.locks };
    if (action === "admin_status") {
      const b = db.bookings.find(x => x.id === d.id); if (!b) throw new Error("找不到這筆預約");
      b.status = d.status; if (d.note != null) b.adminNote = d.note; this.save(db); return { ok: true };
    }
    if (action === "admin_lock") { for (const s of d.slots) db.locks[s] = { reason: d.reason || "", at: new Date().toISOString() }; this.save(db); return { ok: true }; }
    if (action === "admin_unlock") { for (const s of d.slots) delete db.locks[s]; this.save(db); return { ok: true }; }
    throw new Error("未知的動作：" + action);
  }
};

const Api = {
  async call(action, data = {}) {
    if (DEMO) return LocalDB.handle(action, JSON.parse(JSON.stringify(data)));
    // text/plain 可避免瀏覽器的 CORS 預檢，Apps Script 才收得到
    let r;
    try { r = await fetch(CONFIG.apiUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action, ...data }) }); }
    catch (e) { throw new Error("連不上資料庫。請確認網路連線；若是在檔案預覽視窗中開啟，請改用正式網址開啟網站。"); }
    if (!r.ok) throw new Error("伺服器回應錯誤（" + r.status + "）");
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j;
  }
};
function conflictSlots(err) { const m = String(err.message || "").match(/^CONFLICT:(.*)$/); return m ? m[1].split(",") : null; }

/* =====================================================================
   週曆
   map: { "YYYY-MM-DD|H": {state:"pending"|"booked"|"locked", id?, reason?} }
   ===================================================================== */
function calendarHtml({ offset, minOffset, maxOffset, map = {}, selected = [], admin = false, focusId = "" }) {
  const days = weekDays(offset);
  const head = `<tr><th class="time"></th>${days.map((d, i) => `<th>週${WD[i]}<br><span class="mono">${d.getMonth() + 1}/${d.getDate()}</span>${admin ? `<br><button class="daybtn" data-day="${ymd(d)}">整天鎖定</button>` : ""}</th>`).join("")}</tr>`;
  const rows = CONFIG.hours.map(h => `<tr><th class="time">${String(h).padStart(2, "0")}:00</th>${days.map(d => {
    const key = ymd(d) + "|" + h, info = map[key], on = selected.includes(key), past = slotIsPast(key);
    let cls = "slot", label = "", dis = false, title = fmtSlot(key);
    if (info) {
      cls += " " + info.state;
      label = { pending: "待確認", booked: "已預約", locked: "暫停開放" }[info.state];
      if (admin && info.state === "locked" && info.reason) label = info.reason;
      if (info.reason) title += "｜" + info.reason;
      if (!admin) dis = true;
      if (admin && info.id && info.id === focusId) cls += " focus";
    } else if (on) { cls += " sel"; label = "✓"; }
    if (past) { cls += " past"; if (!admin && !CONFIG.allowPastSlots) dis = true; }
    return `<td><button class="${cls}" data-slot="${key}" title="${esc(title)}"${dis ? " disabled" : ""}>${esc(label)}</button></td>`;
  }).join("")}</tr>`).join("");
  return `<div class="weeknav"><button class="b ghost" data-act="wprev"${offset <= minOffset ? " disabled" : ""}>‹ 上一週</button>
    <span class="mono">${ymd(days[0])} – ${ymd(days[4])}</span><button class="b ghost" data-act="wnext"${offset >= maxOffset ? " disabled" : ""}>下一週 ›</button></div>
  <div class="cal-scroll"><table class="cal">${head}${rows}</table></div>
  <div class="legend"><span><i></i>可預約</span>${admin ? "" : `<span><i style="background:var(--accent);border-color:var(--accent)"></i>已選取</span>`}<span><i style="background:var(--warn-soft);border-color:transparent"></i>待確認</span><span><i style="background:var(--busy);border-color:transparent"></i>已預約</span><span><i style="background:repeating-linear-gradient(135deg,var(--busy) 0 4px,var(--surface) 4px 7px)"></i>暫停開放</span></div>`;
}

/* =====================================================================
   預約申請單：固定三頁 A4（申請人聯／管理人聯／切結書），內容過多時自動縮放成一頁
   booking 物件格式：{id, createdAt, status, mode, kind, applicant:{...}, slots:[], hours, rate, cost, details:{...}}
   ===================================================================== */
function detailRows(b) {
  const d = b.details || {}, k = b.kind;
  const rows = [["服務類型", (b.mode === "service" ? "委託代工" : "自行操作") + "　—　" + RATE_LABEL[k]]];
  if (k === "consult") rows.push(["諮詢主題", d.topic], ["實驗方案說明", d.detail], ["方便諮詢時間", d.prefer || "—"]);
  if (k === "service") rows.push(["諮詢單號", d.ref], ["樣品件數／種類", `${d.count} 件　${d.type}`], ["預期粒徑／分散液", `${d.size || "—"} nm　${d.solvent || "—"}`], ["每件量測次數", d.repeat || "—"], ["希望完成日期", d.date || "—"], ["實驗內容／特殊需求", d.note || "—"]);
  if (k === "training") rows.push(["訓練次別", `第 ${d.round} 次（共 3 次）`]);
  if (k === "exam") rows.push(["訓練紀錄", H(`<table class="pt inner"><tr><th>#</th><th>受訓人</th><th>訓練人</th><th>受訓日期</th><th>時數</th></tr>${(d.records || []).map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.trainee)}</td><td>${esc(r.trainer)}</td><td>${esc(r.date)}</td><td>${esc(r.hours)}</td></tr>`).join("")}</table>`)]);
  if (k === "self") rows.push(["量測目的／樣品", `${d.purpose}（${d.samples || "—"} 件）`]);
  if ((b.slots || []).length) rows.push(["預約時段", H(b.slots.slice().sort(slotCmp).map(fmtSlot).join("<br>"))]);
  const unit = b.unit || "hr", note = b.priceNote ? `（${esc(b.priceNote)}）` : "";
  rows.push(["收費身分", billingLabel(b.applicant)],
    ["計價方式", H(`${money(b.rate)} / ${unit}${note}`)],
    ["預估數量／報價金額", H(`${b.hours} ${unit}　／　<b>${money(b.cost)}</b>`)]);
  if (k === "self") rows.push(["計費說明", `實際費用依「預約開始時間」至「簽退時間」計算，每 ${CONFIG.billUnitMinutes} 分鐘為一計費單位，不足一單位以一單位計，以繳費單為準。`]);
  if (k === "service") rows.push(["計費說明", `實際費用依實際量測時間計算，每 ${CONFIG.billUnitMinutes} 分鐘為一計費單位，以繳費單為準。`]);
  return rows;
}
function ptable(rows) { return `<table class="pt">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v && v.h !== undefined ? v.h : esc(v).replace(/\n/g, "<br>")}</td></tr>`).join("")}</table>`; }
function applicantTable(a) {
  const c = v => esc(v || "—");
  return `<table class="pt"><tr><th>申請人姓名</th><td>${c(a.name)}</td><th>學號／員編</th><td>${c(a.sid)}</td></tr>
  <tr><th>所屬系所</th><td>${c(a.dept)}</td><th>指導教授</th><td>${c(a.advisor)}</td></tr>
  <tr><th>Email</th><td>${c(a.email)}</td><th>聯絡電話</th><td>${c(a.phone)}</td></tr>
  <tr><th>經費來源</th><td colspan="3">${c(a.account)}</td></tr>
  ${a.note ? `<tr><th>備註</th><td colspan="3">${esc(a.note).replace(/\n/g, "<br>")}</td></tr>` : ""}</table>`;
}
const SIGS = `<div class="sigs">${["申請人簽名", "指導教授簽名", "機台管理人員簽名"].map(s => `<div class="sig"><span>${s}</span><span class="d">日期：　　　年　　月　　日</span></div>`).join("")}</div>`;

function reportPages(b) {
  const id = b.id || "（送出後產生）", date = b.createdAt ? ymd(new Date(b.createdAt)) : ymd(new Date());
  const head = (label) => `<h1 class="ptitle">${esc(CONFIG.instrument)} 預約報價單</h1><div class="copy">【 ${label} 】</div>
    <div class="meta"><span>申請編號：${esc(id)}</span><span>申請日期：${date}</span><span>${esc(CONFIG.unit)}</span></div>`;
  const foot = (n, label) => `<div class="pfoot"><span>${esc(CONFIG.unit)}</span><span>${esc(id)}　·　${label}　·　第 ${n} 頁／共 3 頁</span></div>`;
  const copy = (n, label, extra) => `<div class="a4"><div class="fit">${head(label)}
      <h4>一、申請人基本資料</h4>${applicantTable(b.applicant || {})}
      <h4>二、預約確認資料</h4>${ptable(detailRows(b))}
      <h4>三、簽章</h4>${SIGS}${extra || ""}</div>${foot(n, label)}</div>`;
  const office = `<div class="office"><b>管理單位填寫</b><div class="row" style="margin-top:6px">
      <span>收件日期：＿＿＿＿＿＿＿＿</span><span>審核結果：□ 核准　□ 退回</span>
      <span>經手人：＿＿＿＿＿＿＿＿</span><span>備註：＿＿＿＿＿＿＿＿＿＿</span></div></div>`;
  const selfOp = b.mode === "self", a = b.applicant || {};
  const affidavit = `<div class="a4${selfOp ? "" : " na"}"><div class="fit">
      <h1 class="ptitle keep">機台使用切結書</h1>
      <div class="copy keep">【 自行操作人員填寫 】</div>
      <div class="meta keep"><span>申請編號：${esc(id)}</span><span>申請日期：${date}</span><span>${esc(CONFIG.unit)}</span></div>
      ${selfOp ? "" : `<div class="na-banner keep">本次申請為「委託代工」，免填本切結書</div>`}
      <table class="pt" style="margin-top:6px"><tr><th>立切結書人</th><td>${esc(a.name)}</td><th>學號／員編</th><td>${esc(a.sid)}</td></tr>
        <tr><th>所屬系所</th><td>${esc(a.dept)}</td><th>指導教授</th><td>${esc(a.advisor)}</td></tr>
        <tr><th>使用項目</th><td colspan="3">${esc(RATE_LABEL[b.kind])}${(b.slots || []).length ? "　共 " + b.slots.length + " 小時（" + esc(b.slots.slice().sort(slotCmp)[0].split("|")[0]) + " 起）" : ""}</td></tr></table>
      <p style="margin-top:14px">立切結書人（以下稱申請人）向${esc(CONFIG.unit)}申請自行操作${esc(CONFIG.instrument)}，茲聲明並同意遵守下列事項：</p>
      <ol class="terms">
        <li>申請人已接受機台操作訓練並通過考核，將依標準作業程序（SOP）及管理人員指示操作，不擅自變更儀器設定、拆卸零組件，或使用未經核准之樣品與溶劑。</li>
        <li>使用前應確認機台狀態並登記使用紀錄；使用後應依規定清潔樣品槽與管路，並恢復機台至待機狀態。</li>
        <li>使用期間如發生異常狀況，應立即停止操作並通知機台管理人員，不得自行排除故障。</li>
        <li>於自行操作期間，因操作不當、違反使用規範或其他可歸責於申請人之事由，致設備損壞或故障者，申請人應負照價賠償及維修費用之責任，指導教授負督導之責。</li>
        <li>違反上述規定者，管理單位得暫停或取消其機台使用資格。</li>
      </ol>
      <p>申請人已詳閱並充分瞭解上述條款，願遵守之，特立此書為憑。</p>
      <p>此致　${esc(CONFIG.unit)}</p>
      <h4>簽章</h4>${SIGS}
      <p style="text-align:center;margin-top:22px;letter-spacing:.3em">中　華　民　國　　　　年　　　　月　　　　日</p>
    </div>${foot(3, "切結書")}</div>`;
  return [copy(1, "申請人聯"), copy(2, "管理人聯", office), affidavit];
}

/* 繳費單：簽退／結算後產生，兩頁（申請人聯／管理單位聯） */
function billPages(b) {
  const id = b.id || "", a = b.applicant || {}, unit = b.unit || "hr";
  const usage = [["服務類型", (b.mode === "service" ? "委託代工" : "自行操作") + "　—　" + RATE_LABEL[b.kind]]];
  if ((b.slots || []).length) usage.push(["預約時段", H(b.slots.slice().sort(slotCmp).map(fmtSlot).join("<br>"))]);
  if (b.billStart) usage.push(["計費起始（預約開始）", fmtDateTime(b.billStart)]);
  if (b.kind === "self") usage.push(["使用結束時間", fmtDateTime(b.checkoutAt) + (b.settledBy === "admin" ? "（管理人員登錄）" : "（申請人填寫）")]);
  if (b.kind === "self" && b.submittedAt) usage.push(["簽退送出時間", fmtDateTime(b.submittedAt)]);
  else usage.push(["結算日期", fmtDateTime(b.checkoutAt)]);
  usage.push(["收費身分", billingLabel(a)]);
  if (unit === "套") usage.push(["計費方式", `${money(b.billRate)} / 套（${esc(b.priceNote || "訓練課程")}）`]);
  else usage.push(["計費時間", `${fmtDuration(b.billMinutes)}（${b.billMinutes / CONFIG.billUnitMinutes} 單位 × ${CONFIG.billUnitMinutes} 分鐘）`],
    ["單價", `${money(b.billRate)} / hr`]);
  usage.push(["應繳金額", H(`<b style="font-size:16px">${money(b.billAmount)}</b>`)]);
  if (b.adminNote) usage.push(["備註", b.adminNote]);
  const page = (n, label, extra) => `<div class="a4"><div class="fit">
      <h1 class="ptitle">${esc(CONFIG.instrument)} 使用繳費單</h1><div class="copy">【 ${label} 】</div>
      <div class="meta"><span>申請編號：${esc(id)}</span><span>開立日期：${ymd(new Date(b.checkoutAt || Date.now()))}</span><span>${esc(CONFIG.unit)}</span></div>
      <h4>一、申請人基本資料</h4>${applicantTable(a)}
      <h4>二、使用紀錄與費用</h4>${ptable(usage)}
      <h4>三、繳費說明</h4><p style="margin:0 0 6px">${esc(CONFIG.paymentNote)}</p>
      <h4>四、簽章</h4>${SIGS}${extra || ""}</div>
      <div class="pfoot"><span>${esc(CONFIG.unit)}</span><span>${esc(id)}　·　繳費單 ${label}　·　第 ${n} 頁／共 2 頁</span></div></div>`;
  const office = `<div class="office"><b>管理單位填寫</b><div class="row" style="margin-top:6px">
      <span>收款日期：＿＿＿＿＿＿＿＿</span><span>收據編號：＿＿＿＿＿＿＿＿</span>
      <span>實收金額：NT$ ＿＿＿＿＿＿</span><span>經手人：＿＿＿＿＿＿＿＿</span></div></div>`;
  return [page(1, "申請人聯"), page(2, "管理單位聯", office)];
}
const reportPagesHtml = b => reportPages(b).join("");

/* 內容太長時把 .fit 等比縮小，確保每張都是一頁 */
function fitPages(root) {
  root.querySelectorAll(".a4").forEach(p => {
    const fit = p.querySelector(".fit"), cs = getComputedStyle(p);
    const avail = p.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    fit.style.transform = ""; fit.style.width = "";
    let s = 1;
    for (let i = 0; i < 4; i++) {
      const h = fit.scrollHeight * s;
      if (h <= avail + 0.5) break;
      s = s * avail / h;
      fit.style.width = (100 / s) + "%"; fit.style.transform = `scale(${s})`;
    }
  });
}

/* 預覽：把三張 A4 縮放到容器寬度 */
function mountPreview(container, b) {
  container.innerHTML = `<div class="pages">${reportPages(b).map(p => `<div class="pagebox">${p}</div>`).join("")}</div>`;
  const pages = container.querySelector(".pages");
  const resize = () => { const s = Math.min(1, (container.clientWidth - 2) / 794); pages.style.setProperty("--s", s); };
  resize(); fitPages(pages);
  if (container._ro) container._ro.disconnect();
  container._ro = new ResizeObserver(resize); container._ro.observe(container);
  if (document.fonts) document.fonts.ready.then(() => fitPages(pages));
}

/* 下載 PDF：type = "quote"（報價單 3 頁）或 "bill"（繳費單 2 頁） */
async function downloadPdf(b, type = "quote") {
  if (!window.html2canvas || !window.jspdf) throw new Error("PDF 元件載入失敗，請檢查網路後重新整理");
  const host = document.createElement("div");
  host.id = "pdfhost";
  host.style.cssText = "position:absolute;left:0;top:0;width:794px;visibility:hidden;pointer-events:none;z-index:-1";
  host.innerHTML = (type === "bill" ? billPages(b) : reportPages(b)).join("");
  document.body.appendChild(host);
  try {
    if (document.fonts) await document.fonts.ready;
    fitPages(host);
    const pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4", compress: true });
    const pages = host.querySelectorAll(".a4");
    for (let i = 0; i < pages.length; i++) {
      const canvas = await html2canvas(pages[i], {
        scale: 2, backgroundColor: "#ffffff", scrollX: 0, scrollY: -window.scrollY, windowWidth: document.documentElement.clientWidth,
        onclone: doc => { const h = doc.getElementById("pdfhost"); if (h) h.style.visibility = "visible"; }
      });
      if (i) pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 210, 297);
    }
    pdf.save(`NTA${type === "bill" ? "繳費單" : "報價單"}_${b.id || "草稿"}_${(b.applicant || {}).name || ""}.pdf`);
  } finally { host.remove(); }
}
