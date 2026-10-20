/* =====================================================================
   NTA 預約系統 — 共用設定與功能（申請頁 index.html、管理頁 admin.html 共用）
   ===================================================================== */

/* ========= 設定區：部署時只要改這裡 ========= */
const CONFIG = {
  // 部署 Google Apps Script 後，把 Web App 網址貼在這裡（見 README）。
  // 留空 = 示範模式：資料只存在目前這個瀏覽器，別人看不到。
  apiUrl: "",

  unit: "國立清華大學 NTA 機台管理單位",          // 報表抬頭
  instrument: "奈米粒子追蹤分析儀 (NTA)",
  rates: {                                       // NT$/hr（範例費率，請依實際公告修改）
    consult: 0,       // 預約諮詢
    service: 1200,    // 委託代工
    training: 800,    // 機台訓練（每次 1 小時）
    exam: 800,        // 機台考核
    self: 600         // 自行操作
  },
  hours: [9, 10, 11, 13, 14, 15, 16],            // 可預約起始時段（避開午休 12:00）
  maxSelfHours: 4,                               // 自行操作單次最多時數
  weeksAhead: 8,                                 // 開放預約幾週內的時段
  departments: ["動力機械工程學系", "奈米工程與微系統研究所", "化學工程學系", "材料科學工程學系", "醫學科學系", "生命科學系", "分析與環境科學研究所", "校外單位", "其他（請於備註說明）"]
};
/* ========================================== */

const DEMO = !CONFIG.apiUrl;
const DEMO_ADMIN_KEY = "demo";

const RATE_LABEL = { consult: "預約諮詢", service: "委託代工", training: "機台訓練", exam: "機台考核", self: "自行操作" };
const STATUS_LABEL = { pending: "待確認", approved: "已核准", rejected: "已退回", cancelled: "已取消" };
const WD = ["一", "二", "三", "四", "五"];

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = n => "NT$ " + Number(n || 0).toLocaleString("zh-TW");
const H = h => ({ h });   // 標記「已處理好的 HTML」

/* ----- 日期 ----- */
function mondayOf(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; }
function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function weekDays(offset) { const m = mondayOf(new Date()); m.setDate(m.getDate() + 7 * offset); return [0, 1, 2, 3, 4].map(i => { const d = new Date(m); d.setDate(m.getDate() + i); return d; }); }
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
    for (const b of db.bookings) if (b.status === "pending" || b.status === "approved")
      for (const s of b.slots || []) m[s] = { state: b.status === "approved" ? "booked" : "pending", id: b.id };
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
    if (action.startsWith("admin_") && d.key !== DEMO_ADMIN_KEY) throw new Error("管理密碼錯誤");
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
    const r = await fetch(CONFIG.apiUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action, ...data }) });
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
    if (past) { cls += " past"; if (!admin) dis = true; }
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
  if ((b.slots || []).length) rows.push(["預約時段", H(b.slots.slice().sort().map(fmtSlot).join("<br>"))]);
  rows.push(["計價方式", `${money(b.rate)} / hr`], ["計費時數／預估費用", H(`${b.hours} hr　／　<b>${money(b.cost)}</b>`)]);
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
  const head = (label) => `<h1 class="ptitle">${esc(CONFIG.instrument)} 預約申請單</h1><div class="copy">【 ${label} 】</div>
    <div class="meta"><span>申請編號：${esc(id)}</span><span>申請日期：${date}</span><span>${esc(CONFIG.unit)}</span></div>`;
  const foot = (n, label) => `<div class="pfoot"><span>${esc(CONFIG.unit)}</span><span>${esc(id)}　·　${label}　·　第 ${n} 頁／共 3 頁</span></div>`;
  const copy = (n, label, extra) => `<div class="a4"><div class="fit">${head(label)}
      <h4>一、申請人基本資料</h4>${applicantTable(b.applicant || {})}
      <h4>二、預約確認資料</h4>${ptable(detailRows(b))}
      <h4>三、簽章</h4>${SIGS}${extra || ""}</div>${foot(n, label)}</div>`;
  const office = `<div class="office"><b>管理單位填寫</b><div class="row" style="margin-top:6px">
      <span>收件日期：＿＿＿＿＿＿＿＿</span><span>審核結果：□ 核准　□ 退回</span>
      <span>實收金額：NT$ ＿＿＿＿＿＿</span><span>經手人：＿＿＿＿＿＿＿＿</span></div></div>`;
  const selfOp = b.mode === "self", a = b.applicant || {};
  const affidavit = `<div class="a4${selfOp ? "" : " na"}"><div class="fit">
      <h1 class="ptitle keep">機台使用切結書</h1>
      <div class="copy keep">【 自行操作人員填寫 】</div>
      <div class="meta keep"><span>申請編號：${esc(id)}</span><span>申請日期：${date}</span><span>${esc(CONFIG.unit)}</span></div>
      ${selfOp ? "" : `<div class="na-banner keep">本次申請為「委託代工」，免填本切結書</div>`}
      <table class="pt" style="margin-top:6px"><tr><th>立切結書人</th><td>${esc(a.name)}</td><th>學號／員編</th><td>${esc(a.sid)}</td></tr>
        <tr><th>所屬系所</th><td>${esc(a.dept)}</td><th>指導教授</th><td>${esc(a.advisor)}</td></tr>
        <tr><th>使用項目</th><td colspan="3">${esc(RATE_LABEL[b.kind])}${(b.slots || []).length ? "　共 " + b.slots.length + " 小時（" + esc(b.slots.slice().sort()[0].split("|")[0]) + " 起）" : ""}</td></tr></table>
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

/* 下載 PDF（3 頁 A4） */
async function downloadPdf(b) {
  if (!window.html2canvas || !window.jspdf) throw new Error("PDF 元件載入失敗，請檢查網路後重新整理");
  const host = document.createElement("div");
  host.id = "pdfhost";
  host.style.cssText = "position:absolute;left:0;top:0;width:794px;visibility:hidden;pointer-events:none;z-index:-1";
  host.innerHTML = reportPagesHtml(b);
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
    pdf.save(`NTA預約申請單_${b.id || "草稿"}_${(b.applicant || {}).name || ""}.pdf`);
  } finally { host.remove(); }
}
