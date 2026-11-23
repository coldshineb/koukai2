"""按線性位址反組譯指定函式 (自動展開子呼叫)。
用法: python tools/re/dis_at.py 34761 34783 [RE_DEPTH=1]   輸出 tools/work/re_dis_at.txt 並印出
(也可在 exec 時以全域 ADDRS = [0x34761, ...] 指定)"""
import os, io, sys, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_walk.py"), encoding="utf-8").read())
try:
    ADDRS
except NameError:
    ADDRS = [int(a, 16) for a in sys.argv[1:]]
try:
    DEPTH
except NameError:
    DEPTH = int(os.environ.get("RE_DEPTH", "1"))
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    for a in ADDRS:
        walk(a, DEPTH, "dis_at")
open(os.path.join(HERE, "..", "work", "re_dis_at.txt"), "w", encoding="utf-8").write(buf.getvalue())
print(buf.getvalue())
