"""出海與航海 階段 5 後半: 委任 (目的地清單 0fea:321a、自動航行 316b3 / 313b1、指定目的地 3119b、地圖格游標 15e14)、
偵察 1feae、情報 航海圖 1dace、隨身物 地圖 1dd76 / 測量 298a5、清單種類 3 / 0x0c / 0x85 的列格式。輸出 tools/work/re_sea5.txt。
用法: python tools/re/sea5.py   (RE_DEPTH 預設 1; exec 時可在 globals 放 ROOTS / DEPTH / OUT 覆寫)"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_walk.py"), encoding="utf-8").read())
try:
    DEPTH
except NameError:
    DEPTH = int(os.environ.get("RE_DEPTH", "1"))
try:
    ROOTS
except NameError:
    ROOTS = [(0x312b3, "2e09:3223 委任"), (0x130ba, "0fea:321a 已發現港口清單"), (0x316b3, "316b3 航向 (委任分支)"),
             (0x313b1, "313b1 自動航行"), (0x3119b, "2e09:310b 指定目的地"), (0x15e14, "0fea:5f74 地圖格游標"),
             (0x1feae, "1feae 偵察"), (0x1dace, "0fea:dc2e 航海圖"), (0x1dd76, "0fea:ded6 地圖類隨身物"),
             (0x298a5, "298a5 測量用具")]
try:
    OUT
except NameError:
    OUT = "re_sea5.txt"
KNOWN.update({0x22d62: "1fd9:2fd2 區域解碼 (web/src/gfx/worldmap.js)", 0x1fac: "1fac 地圖視窗 (port.js drawMap)",
              0x1bf79: "0fea:c0d9 靠港 (sea.js dock)", 0x23a97: "23a97 中途點 (sea.js pathStep)", 0x23872: "23872 距離場 (sea.js pathField)",
              0x3197c: "2e09:38ec 主角移動 (sea.js heroMove)", 0x1c839: "1c839 人物資料 (commands.js personInfo)"})
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    for a, n in ROOTS:
        walk(a, DEPTH, n)
open(os.path.join(HERE, "..", "work", OUT), "w", encoding="utf-8").write(buf.getvalue())
import re as R2
for m in R2.finditer(r"========== (\w+)\s+(.*?)\n", buf.getvalue()):
    print(m.group(1), m.group(2)[:70])
