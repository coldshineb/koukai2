"""上陸探索 34d54 / 發現物 34ccc / 海上特殊地點事件 30e9f (DS:b796 的 10 個事件函式) 的反組譯。輸出 tools/work/re_landing.txt。
用法: python tools/re/landing.py   (RE_DEPTH 預設 3)"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_walk.py"), encoding="utf-8").read())
try:
    DEPTH
except NameError:
    DEPTH = int(os.environ.get("RE_DEPTH", "3"))
EV = [struct.unpack("<HH", dsbytes(0xb796 + 4 * k, 4)) for k in range(10)]
EV = [sg * 16 + o for o, sg in EV]
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    print("海上特殊地點 DS:1012 (x, y):", [struct.unpack("<HH", dsbytes(0x1012 + 4 * k, 4)) for k in range(10)])
    print("事件編號 DS:103a:", list(dsbytes(0x103a, 10)), " 事件函式 DS:b796:", [hex(a) for a in EV])
    walk(0x34d54, DEPTH, "上陸 34d54")
    walk(0x34ccc, DEPTH, "發現物 34ccc")
    walk(0x30e9f, DEPTH, "海上特殊地點事件 30e9f")
    for k, a in enumerate(EV):
        walk(a, DEPTH, f"海上事件 {k} (DS:b796[{k}])")
open(os.path.join(HERE, "..", "work", "re_landing.txt"), "w", encoding="utf-8").write(buf.getvalue())
import re as R2
for m in R2.finditer(r"========== (\w+)\s+(.*?)\n", buf.getvalue()):
    print(m.group(1), m.group(2)[:60])
