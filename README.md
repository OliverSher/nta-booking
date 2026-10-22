# NTA 機台預約系統

NTA（奈米粒子追蹤分析儀）機台的線上預約系統。

- **預約頁** `index.html`：申請人資料 → 委託代工／自行操作 → 預約內容（諮詢、下單、訓練、考核、預約使用，含 $/hr 計價）→ 送出，然後下載申請單 PDF
- **管理頁** `index.html#admin`：審核預約（核准／退回／取消）、鎖定或解除時段、重新下載申請單
- **申請單 PDF**：固定 3 頁 A4，分別是申請人聯、管理人聯、機台使用切結書。內容再多也會自動縮放成一頁

## 單一檔案版（系上主機上架用）
`dist/` 資料夾就是交給網站管理員的完整套件：`nta-booking.html`（單一檔案，不連外部資源）、`Code.gs`、`安裝說明.txt`。
管理頁是同一個檔案加上 `#admin`。

## 檔案結構
```
src/user.html       預約頁原始碼
src/admin.html      管理頁原始碼
src/common.js       共用設定（CONFIG）、API、週曆、申請單與 PDF
src/style.css       樣式
vendor/             html2canvas、jsPDF（內嵌進單一檔案）
tools/build.py      合併成單一檔案：產生 index.html（GitHub Pages）與 dist/nta-booking.html
apps-script/Code.gs Google Apps Script 後端（資料存在 Google 試算表）
```
修改 `src/` 後執行 `python3 tools/build.py` 重新產生。

## 設定
費率、系所清單、可預約時段等都在 `src/common.js`（或單一檔案最前面）的 `CONFIG`。

## 示範模式 vs 正式模式
`CONFIG.apiUrl` 留空時是**示範模式**：資料只存在各自的瀏覽器，管理頁密碼是 `demo`。
要讓所有人共用預約資料，請照下面步驟接上 Google 試算表。

## 接上 Google 試算表（約 5 分鐘）
1. 到 Google 雲端硬碟新增一份 Google 試算表，例如命名為「NTA 預約資料」
2. 在試算表選單點 **擴充功能 → Apps Script**
3. 刪掉預設內容，貼上 `apps-script/Code.gs` 的全部內容
4. 把第一行附近的 `ADMIN_KEY = 'change-me'` 改成你自己的管理密碼，按儲存
5. 上方函式選單選 `setup`，按 **執行**，並依提示授權（會出現「Google 尚未驗證這個應用程式」，點「進階 → 前往」即可，因為這是你自己的程式）
6. 右上角 **部署 → 新增部署作業**，類型選 **網頁應用程式**：
   - 執行身分：**我**
   - 具有存取權的使用者：**所有人**
7. 按部署，複製產生的 **網頁應用程式網址**（`https://script.google.com/macros/s/.../exec`）
8. 把網址貼到 `nta-booking.html`（或 `src/common.js`）的 `apiUrl: ""` 裡

> 之後若修改 Code.gs，要到 **部署 → 管理部署作業 → 編輯 → 版本選「新版本」** 再部署，網址不會變。

## 運作方式
- 申請人送出後，時段先顯示為「待確認」，其他人無法再選
- 管理人核准後變成「已預約」（鎖定）；退回或取消則釋放時段
- 管理人可以直接在週曆上點空白時段鎖定（保養、維修等），或點「整天鎖定」
- 對外的時段查詢只會回傳時段狀態，不會公開申請人資料
