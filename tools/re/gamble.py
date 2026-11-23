"""酒館 賭博 1fd9:7701 (27491): 二十一點 2e8ed / 骰子 2fc60 (DS:af80)。輸出 tools/work/re_gamble.txt。
用法: python tools/re/gamble.py   (RE_DEPTH 預設 3)"""
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
KNOWN.update({0x15fb4: "openFile 0fea:6114", 0x35255: "fread? 2e09:71c5", 0x35429: "lsRead 2e09:7399", 0x1a2b2: "bAfter2"})
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    walk(0x2e8ed, DEPTH, "二十一點")
    walk(0x2fc60, DEPTH, "骰子")
open(os.path.join(HERE, "..", "work", "re_gamble.txt"), "w", encoding="utf-8").write(buf.getvalue())
t = buf.getvalue()
import re as R2
for m in R2.finditer(r"========== (\w+)\s+(.*?)\n", t):
    print(m.group(1), m.group(2)[:60])
