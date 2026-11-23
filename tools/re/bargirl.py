"""酒館 酒吧女郎 4 個子功能: 航海見聞 26941 / 送她禮物 26a64 / 調查結果 26ece / 探聽情報 272c5 (DS:af62)。
輸出 tools/work/re_bargirl.txt。用法: python tools/re/bargirl.py   (RE_DEPTH 預設 2)"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_walk.py"), encoding="utf-8").read())
DEPTH = int(os.environ.get("RE_DEPTH", "2"))
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    for a, n in [(0x26941, "航海見聞"), (0x26a64, "送她禮物"), (0x26ece, "調查結果"), (0x272c5, "探聽情報")]:
        walk(a, DEPTH, n)
open(os.path.join(HERE, "..", "work", "re_bargirl.txt"), "w", encoding="utf-8").write(buf.getvalue())
t = buf.getvalue()
import re as R2
for m in R2.finditer(r"========== (\w+)\s+(.*?)\n", t):
    print(m.group(1), m.group(2)[:60])
