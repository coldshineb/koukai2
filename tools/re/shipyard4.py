"""造船廠: 造新船 / 買舊船 / 改造 剩下的函式。輸出 tools/work/re_shipyard4.txt
  改造 MENU #23 子功能 (DS:b3d2) 與 2c11d..2c664 之間的函式、清單種類 14 / 15 列格式 (DS:a1d8)、
  船名輸入 2e09:29a0 / 26a5、0fea:e788 / fe57 (以舊船折抵時剩下的貨物)、DS:b268 / b2c0 表。"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())
MT = json.load(open(os.path.join(TOOLS, "..", "web", "assets", "text", "menu.json"), encoding="utf-8"))


def until_ret(a, n=0x400):
    for i in disasm(code, a, a + n):
        print(_fmt(i))
        if i.mn in ("retf", "ret"):
            break


buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    print("== MENU #23", MT[23])
    subs = [farptr(0xb3d2 + 4 * i) for i in range(4)]
    print("== DS:b3d2", [hex(x) for x in subs])
    print("\n========== 2c11d..2c664 (改造子功能與輔助)")
    cd(0x2c11d, 0x2c664)
    for k in (14, 15):
        a = farptr(0xa1d8 + 4 * k)
        print(f"\n========== 清單種類 {k} 列格式 {a:05x}")
        until_ret(a)
    for name, a in [("2e09:29a0", 0x2e090 + 0x29a0), ("2e09:26a5", 0x2e090 + 0x26a5), ("0fea:e788", 0xfea0 + 0xe788), ("0fea:fe57", 0xfea0 + 0xfe57)]:
        print(f"\n========== {name} {a:05x}")
        until_ret(a, 0x600)
    print("\n== DS:b268 造船表 (每級 8 個船型)")
    for lv in range(11):
        print(lv, list(dsbytes(0xb268 + 8 * lv, 8)))
    print("\n== DS:b2c0 船型說明訊息", [hex(w16(0xb2c0 + 2 * i)) for i in range(25)])
    for o in [0xa17e, 0xa1a0, 0xa1b0, 0xa1c4, 0xa1cc]:
        print(f"DS:{o:04x}", cbytes(o).hex(), dstr(o))
open(os.path.join(HERE, "..", "work", "re_shipyard4.txt"), "w", encoding="utf-8").write(buf.getvalue())
print("ok", len(buf.getvalue().splitlines()), "lines")
