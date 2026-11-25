"""海上 (碼頭出航 27802 之後) 的反組譯總覽: 出航入口、海上時刻 / 每日 / 移動、世界地圖顯示。輸出 tools/work/re_sea.txt。
用法: python tools/re/sea.py   (RE_DEPTH 預設 1)"""
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
# 码头出航 27802 确认后: 0fea:e3e5 记录出港 (交易记录种类 1) → 0000:4fe3 → 0fea:9348 → 0fea:9401 → 0000:851f (进入海上)
ROOTS = [(0x0fea * 16 + 0x9348, "0fea:9348 出海準備"), (0x0fea * 16 + 0x9401, "0fea:9401 出海準備"), (0x851f, "0000:851f 進入海上"),
         (0x1fd90 + 0x13c1, "1fd9:13c1 海上時刻"), (0x1afe8, "1afe8 海上時刻"),
         (0x2e090 + 0x38ec, "2e09:38ec 海上時刻"), (0x6cfc, "6cfc 海上移動"), (0x2e090 + 0x2f3d, "2e09:2f3d 海上移動"),
         (0x195b6, "195b6 海上每日"), (0x8067, "8067 海上每日"), (0x2e090 + 0x55c2, "2e09:55c2 海上每日事件"),
         (0x1976e, "1976e 海上天候"), (0x19f48, "19f48"), (0x19a99, "19a99"),
         # 阶段 3 追加: 天候细节、被挡住时的中途点、发现、月末 (未移植)
         (0x19bd1, "19bd1 暴風雨"), (0x1988c, "1988c 海難"), (0x19909, "19909 觀測者"), (0x1999c, "1999c 天候開始"),
         (0x23a97, "23a97 中途點"), (0x23872, "23872 距離場"), (0x30b34, "30b34 發現訊息"), (0x30e9f, "30e9f 海上特殊地點"),
         (0x18ff5, "18ff5 月末 (未移植)")]
KNOWN.update({0x22d62: "1fd9:2fd2 區域解碼 (web/src/gfx/worldmap.js)", 0x1fac: "1fac 地圖視窗 (port.js drawMap)"})
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    for a, n in ROOTS:
        walk(a, DEPTH, n)
open(os.path.join(HERE, "..", "work", "re_sea.txt"), "w", encoding="utf-8").write(buf.getvalue())
import re as R2
tot = 0
for m in R2.finditer(r"========== (\w+)\s+(.*?)\n", buf.getvalue()):
    k = R2.search(r"(\d+) 條", m.group(2)); tot += int(k.group(1)) if k else 0
    print(m.group(1), m.group(2)[:70])
print("total", tot)
