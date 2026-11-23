"""碼頭用到的輔助: 0fea:2f43 (船員名單)、277c0 (視窗)、seg0:2260 (出航前畫面效果)、DS 格式字串。輸出 tools/work/re_wharf4.txt"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())


def func(a, n=0x400):
    end = code.find(b"\x55\x8b\xec", a + 3, a + n)
    end = end if end > 0 else a + n
    cd(a, end)


buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    for name, a in [("0fea:2f43 = 12de3", 0x12de3), ("277c0", 0x277c0), ("seg0:2260", 0x2260)]:
        print(f"\n========== {name}")
        func(a)
    for o in [0xafab, 0xafd4, 0xaff6, 0xb008, 0xb00f]:
        print(f"DS:{o:04x}", cbytes(o).hex(), "|", dstr(o, 64))
open(os.path.join(HERE, "..", "work", "re_wharf4.txt"), "w", encoding="utf-8").write(buf.getvalue())
print("ok", len(buf.getvalue().splitlines()), "lines")
