"""酒館: 飲酒敘話 (1fd9:5f16) 及傳聞所用子函式、DS 常數表。輸出 tools/work/re_tavern_drink.txt"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())

FUNCS = [0x253b4, 0x5cba, 0x5cce, 0x5cde, 0x5bde, 0x7e15, 0x7df5, 0x7f34, 0x7ed8, 0x9076, 0x37ee, 0x37bc, 0x3722, 0x2e090 + 0x681c, 0xfea0 + 0x3048, 0xfea0 + 0x32ca]


def until_ret(a, n=0x200):
    for i in disasm(code, a, a + n):
        print(_fmt(i))
        if i.mn in ("retf", "ret"):
            break


buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    for f in FUNCS:
        print("\n==========", hex(f))
        until_ret(f)
    print("\n== DS:07be 酒價 (14 bytes)", list(dsbytes(0x07be, 14)))
    for name, base, n in [("0728 特產?", 0x0728, 40), ("08de 國名", 0x08de, 12), ("081c", 0x081c, 12), ("08f6", 0x08f6, 12), ("af46 閒聊子功能", 0xaf46, 0), ("af62 女郎子功能", 0xaf62, 0), ("af80 賭博子功能", 0xaf80, 0)]:
        if n:
            print(f"\n== DS:{name}", [(i, hex(w16(base + 2 * i)), dstr(w16(base + 2 * i))) for i in range(n)])
        else:
            print(f"\n== DS:{name}", [hex(farptr(base + 4 * i)) for i in range(7)])
open(os.path.join(HERE, "..", "work", "re_tavern_drink.txt"), "w", encoding="utf-8").write(buf.getvalue())
print("ok", len(buf.getvalue().splitlines()), "lines")
