"""片頭 OPEN.EXE 的反組譯: main (0000:85aa) 及其呼叫的函式。輸出 tools/work/re_open.txt。
用法: python tools/re/opening.py   (RE_DEPTH 預設 2)"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env_open.py"), encoding="utf-8").read())
try:
    DEPTH
except NameError:
    DEPTH = int(os.environ.get("RE_DEPTH", "2"))
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    walk(MAIN, DEPTH, "main")
    for k in range(12):
        o, sg = struct.unpack("<HH", code[DS + 0xb9a + 4 * k:DS + 0xb9e + 4 * k])
        walk(sg * 16 + o, DEPTH, f"場景 {k} (DS:0b9a[{k}])")
open(os.path.join(HERE, "..", "work", "re_open.txt"), "w", encoding="utf-8").write(buf.getvalue())
import re as R2
for m in R2.finditer(r"========== (\w+)\s+(.*?)\n", buf.getvalue()):
    print(m.group(1), m.group(2)[:60])
