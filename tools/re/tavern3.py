"""酒館: 酒吧女郎 (1fd9:75a7 = 27337, MENU #14 子功能 DS:af62) 與 賭博 (1fd9:7701 = 27491, 子功能 DS:af80)。
輸出 tools/work/re_tavern3.txt (函式樹, 深度 DEPTH) 與函式清單摘要。"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_walk.py"), encoding="utf-8").read())
MT = json.load(open(os.path.join(TOOLS, "..", "web", "assets", "text", "menu.json"), encoding="utf-8"))
DEPTH = int(os.environ.get("RE_DEPTH", "3"))

buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    print("== MENU #14", MT[14])
    print("== DS:af62", [hex(farptr(0xaf62 + 4 * i)) for i in range(4)])
    print("== DS:af80", [hex(farptr(0xaf80 + 4 * i)) for i in range(3)])
    print("== DS:09e4", dstr(w16(0x09e4)) if w16(0x09e4) < 0xc000 else hex(w16(0x09e4)), dstr(0x09e4))
    walk(0x27337, DEPTH, "1fd9:75a7 酒吧女郎")
    walk(0x27491, DEPTH, "1fd9:7701 賭博")
open(os.path.join(HERE, "..", "work", "re_tavern3.txt"), "w", encoding="utf-8").write(buf.getvalue())
t = buf.getvalue()
print("ok", len(t.splitlines()), "lines", len(walked()), "funcs")
import re as R2
for m in R2.finditer(r"========== (\w+)\s+(.*?)\n", t):
    j = t.find("\n==========", m.end())
    print(m.group(1), m.group(2)[:50], ((j if j > 0 else len(t)) - m.end()))
