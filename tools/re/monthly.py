"""時間流逝後的處理: 月末 18ff5、年末 16126、艦隊 AI 1ac19 / 1afe8 (海上他艦隊) / 6aae (區域內他艦隊)。輸出 tools/work/re_monthly.txt。
用法: python tools/re/monthly.py   (RE_DEPTH 預設 1; exec 時可在 globals 放 ROOTS / DEPTH / OUT 覆寫)"""
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
    ROOTS = [(0x18ff5, "18ff5 月末"), (0x16126, "16126 年末"), (0x1ac19, "1ac19 艦隊 AI (每時刻一支)"),
             (0x1afe8, "1afe8 海上他艦隊"), (0x6aae, "6aae 區域內他艦隊")]
try:
    OUT
except NameError:
    OUT = "re_monthly.txt"
KNOWN.update({0x22d62: "1fd9:2fd2 區域解碼 (web/src/gfx/worldmap.js)", 0x1fac: "1fac 地圖視窗 (port.js drawMap)",
              0x1bf79: "0fea:c0d9 靠港 (sea.js dock)", 0x23a97: "23a97 中途點 (sea.js pathStep)", 0x23872: "23872 距離場 (sea.js pathField)",
              0x3197c: "2e09:38ec 主角移動 (sea.js heroMove)", 0x1c839: "1c839 人物資料 (commands.js personInfo)",
              0x313b1: "313b1 自動航行 (sea.js autoSteer)", 0x241c2: "241c2 路線 (sea.js route)", 0x232a6: "232a6 路線搜尋 (sea.js routeSearch)",
              0x1acbf: "1acbf 艦隊速度 (sea.js fleetSpeed)", 0x3135c: "3135c 陸地 (sea.js landAt)", 0x19648: "19648 各港每日 (clock.js portsDaily)"})
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    for a, n in ROOTS:
        walk(a, DEPTH, n)
open(os.path.join(HERE, "..", "work", OUT), "w", encoding="utf-8").write(buf.getvalue())
import re as R2
for m in R2.finditer(r"========== (\w+)\s+(.*?)\n", buf.getvalue()):
    print(m.group(1), m.group(2)[:70])
