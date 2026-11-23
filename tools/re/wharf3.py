"""碼頭子功能內部: 出航檢查 27802、補給 27a83/27c16/27d00、船塢 27fd5 與 DS:b07e 子功能、20468。輸出 tools/work/re_wharf3.txt"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())
MT = json.load(open(os.path.join(TOOLS, "..", "web", "assets", "text", "menu.json"), encoding="utf-8"))


def func(a, n=0xc00):
    end = code.find(b"\x55\x8b\xec", a + 3, a + n)
    end = end if end > 0 else a + n
    cd(a, end)


buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    print("== MENU #8:", MT[8], "\n== MENU #57:", MT[57])
    dock = [farptr(0xb07e + 4 * i) for i in range(3)]
    sup = [farptr(0xb08a + 4 * i) for i in range(3)]
    print("== DS:b07e 船塢子功能", [hex(x) for x in dock], " DS:b08a 港100+子功能", [hex(x) for x in sup])
    for o in [0xb024, 0xb02d, 0xb036, 0xb055, 0xb05c, 0xb06f, 0xb066, 0xb068, 0xb06a]:
        print(f"   DS:{o:04x}", cbytes(o)[:40].hex(), dstr(o, 48))
    for name, a in [("27802 出航", 0x27802), ("27a83 裝上", 0x27a83), ("27c16 卸下", 0x27c16), ("27d00 補給表", 0x27d00),
                    ("27fd5 船塢列表", 0x27fd5), ("20468", 0x20468)] + [(f"船塢子功能 {i}", d) for i, d in enumerate(dock)]:
        print(f"\n========== {name} {a:05x}")
        func(a)
open(os.path.join(HERE, "..", "work", "re_wharf3.txt"), "w", encoding="utf-8").write(buf.getvalue())
print("ok", len(buf.getvalue().splitlines()), "lines")
