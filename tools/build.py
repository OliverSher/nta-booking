#!/usr/bin/env python3
"""把 src/ 與 vendor/ 合併成單一 HTML 檔（不需子資料夾、不連外部網站）。

用法：
  python3 tools/build.py                     # 產生 index.html（GitHub Pages）與 dist/nta-booking.html（系上主機）
  python3 tools/build.py --api URL           # 指定 GitHub 版使用的 Apps Script 網址
"""
import argparse, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC, VENDOR = ROOT / "src", ROOT / "vendor"


def split_page(path):
    html = path.read_text(encoding="utf-8")
    body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
    scripts = list(re.finditer(r"<script>(.*?)</script>", body, re.S))
    js = scripts[-1].group(1)
    markup = body[: scripts[-1].start()] + body[scripts[-1].end():]
    return markup.strip(), js


def build(api_url):
    common = (SRC / "common.js").read_text(encoding="utf-8")
    common, n = re.subn(r'^  apiUrl: ".*?",', f'  apiUrl: "{api_url}",', common, count=1, flags=re.M)
    assert n == 1, "找不到 apiUrl 設定行"
    css = (SRC / "style.css").read_text(encoding="utf-8")
    u_markup, u_js = split_page(SRC / "user.html")
    a_markup, a_js = split_page(SRC / "admin.html")
    u_markup = u_markup.replace('href="admin.html"', 'href="#admin"')
    a_markup = a_markup.replace('href="index.html"', 'href="#"')
    libs = "\n".join((VENDOR / f).read_text(encoding="utf-8") for f in ["html2canvas.min.js", "jspdf.umd.min.js"])
    for chunk in (libs, u_js, a_js, common):
        assert "</script" not in chunk.lower()

    return f"""<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>NTA 機台預約系統</title>
<!--
  NTA 機台預約系統（單一檔案版）
  ・預約頁：直接開啟本檔案
  ・管理頁：網址後面加上 #admin
  ・設定（資料庫網址、費率、時段）：請修改下方第一段 <script> 裡的 CONFIG
-->
<script>
{common}
</script>
<style>
{css}
</style>
</head>
<body>
<div id="app"></div>

<template id="tplUser">
{u_markup}
</template>

<template id="tplAdmin">
{a_markup}
</template>

<script>
/* ===== PDF 元件（html2canvas 1.4.1、jsPDF 2.5.1，MIT 授權）===== */
{libs}
</script>

<script>
function initUser() {{
{u_js}
}}
function initAdmin() {{
{a_js}
}}
(function route() {{
  const admin = location.hash === "#admin";
  document.title = admin ? "NTA 預約管理" : "NTA 機台預約系統";
  document.getElementById("app").appendChild(document.getElementById(admin ? "tplAdmin" : "tplUser").content.cloneNode(true));
  (admin ? initAdmin : initUser)();
  window.addEventListener("hashchange", () => location.reload());
}})();
</script>
</body>
</html>
"""


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="https://script.google.com/macros/s/AKfycbxZuAXyiHFgvRcFwOBe8ZINKXKTqA9QoC7-D7hD0EGqVm8YQ7AM989QeGq_i6dt_hJs/exec")
    a = ap.parse_args()
    (ROOT / "index.html").write_text(build(a.api), encoding="utf-8")
    (ROOT / "dist").mkdir(exist_ok=True)
    (ROOT / "dist" / "nta-booking.html").write_text(build(""), encoding="utf-8")
    print("built index.html and dist/nta-booking.html")
