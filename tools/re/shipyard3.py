"""造船廠/船塢用到的小函式: 0fea:2e29 / 2e6e / 2eec / b5f6 / b5aa、seg0:5deb / 5cee。輸出 tools/work/re_shipyard3.txt"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())


def until_ret(a, n=0x300):
    for i in disasm(code, a, a + n):
        print(_fmt(i))
        if i.mn in ("retf", "ret"):
            break


buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    for name, a in [("0fea:2e29", 0xfea0 + 0x2e29), ("0fea:2e6e", 0xfea0 + 0x2e6e), ("0fea:2eec", 0xfea0 + 0x2eec),
                    ("0fea:b5f6", 0xfea0 + 0xb5f6), ("0fea:b5aa", 0xfea0 + 0xb5aa), ("seg0:5deb", 0x5deb), ("seg0:5cee", 0x5cee)]:
        print(f"\n========== {name} {a:05x}")
        until_ret(a)
open(os.path.join(HERE, "..", "work", "re_shipyard3.txt"), "w", encoding="utf-8").write(buf.getvalue())
print("ok", len(buf.getvalue().splitlines()), "lines")
