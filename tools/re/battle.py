"""海戰 / 一騎打 / 交涉: 交涉本體 20127、海戰 10f7e (0fea:1181 戰鬥 → 10f7e)、一騎打。輸出 tools/work/re_battle.txt。
用法: python tools/re/battle.py   (RE_DEPTH 預設 1; exec 時可在 globals 放 ROOTS / DEPTH / OUT 覆寫)"""
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
    ROOTS = [(0x20127, "20127 交涉本體"), (0x10f7e, "10f7e 海戰")]
try:
    OUT
except NameError:
    OUT = "re_battle.txt"
KNOWN.update({0x1c839: "1c839 人物資料 (commands.js personInfo)", 0x1bf79: "0fea:c0d9 靠港 (sea.js dock)"})
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    for a, n in ROOTS:
        walk(a, DEPTH, n)
open(os.path.join(HERE, "..", "work", OUT), "w", encoding="utf-8").write(buf.getvalue())
import re as R2
for m in R2.finditer(r"========== (\w+)\s+(.*?)\n", buf.getvalue()):
    print(m.group(1), m.group(2)[:70])
