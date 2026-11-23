"""交易所 (1fd9 段建築 0, 處理函式表 DS:a612[0])。輸出 tools/work/re_market.txt。用法: python tools/re/market.py (RE_DEPTH 預設 2)"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_walk.py"), encoding="utf-8").read())
try:
    DEPTH
except NameError:
    DEPTH = int(os.environ.get("RE_DEPTH", "2"))
MT = json.load(open(os.path.join(TOOLS, "..", "web", "assets", "text", "menu.json"), encoding="utf-8"))
KNOWN.update({0x1592a: "numpad 592a"})
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    print("== MENU #6", MT[6])
    print("== DS:aed8", [hex(farptr(0xaed8 + 4 * i)) for i in range(4)])
    walk(farptr(0xa612), DEPTH, "交易所")
    for i, n in enumerate(["子功能 0", "子功能 1", "子功能 2", "子功能 3"]):
        walk(farptr(0xaed8 + 4 * i), DEPTH, n)
open(os.path.join(HERE, "..", "work", "re_market.txt"), "w", encoding="utf-8").write(buf.getvalue())
t = buf.getvalue()
import re as R2
for m in R2.finditer(r"========== (\w+)\s+(.*?)\n", t):
    print(m.group(1), m.group(2)[:60])
