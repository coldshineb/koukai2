"""劇本 VM 其餘輔助: 發言視窗 (31c04/31c6d/31c8a/31cb3, 表 DS:b814)、記錄位址表 (31f0b 的跳躍表)、
被呼叫的外部函式、DS 檔名字串、事件檢查的呼叫者。輸出 tools/work/re_scenario_helpers.txt"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())
SEG = 0x2e090


def until_ret(a, n=0x300):
    for i in disasm(code, a, a + n):
        print(_fmt(i))
        if i.mn in ("retf", "ret"):
            break


def far(seg, off):
    return seg * 16 + off


buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    for a in [0x31c04, 0x31c6d, 0x31c8a, 0x31cb3, 0x33aaf, 0x5c28, 0x5d36, far(0xfea, 0x2ca9), far(0xfea, 0x44c4), far(0xfea, 0x77af),
              0x9670, 0x96eb, 0x5b5d, far(0xfea, 0x6114), 0x35d44]:
        print(f"\n===== {a:05x}")
        until_ret(a)
    print("\n== 31f0b 跳躍表 (cs:3ea1)")
    tab = SEG + 0x3ea1
    for k in range(20):
        off = struct.unpack("<H", code[tab + 2 * k:tab + 2 * k + 2])[0]
        print(k, hex(SEG + off))
    print("\n== DS:b814 發言視窗表 (4 × 0x18)")
    for k in range(4):
        b = dsbytes(0xb814 + 0x18 * k, 0x18)
        print(k, b.hex(" "), [struct.unpack("<h", b[i:i + 2])[0] for i in range(0, 0x18, 2)])
    print("\n== 檔名")
    for o in [0x0a74, 0x0a82, 0x0a90, 0x0ab8, 0x0b14, 0x09e4]:
        print(hex(o), cbytes(o))
    print("\n== 呼叫者")
    for name, t in [("5481", SEG + 0x5481), ("53f0", SEG + 0x53f0), ("55c2", SEG + 0x55c2), ("5546", SEG + 0x5546)]:
        cs_ = callers(t)
        print(name, [hex(c) for c in cs_])
        for c in cs_:
            print("   --", hex(c))
            for i in prev_ins(c, 8):
                print("     ", _fmt(i))
            for i in disasm(code, c, c + 24)[:5]:
                print("     ", _fmt(i))
open(os.path.join(HERE, "..", "work", "re_scenario_helpers.txt"), "w", encoding="utf-8").write(buf.getvalue())
print("ok", len(buf.getvalue().splitlines()), "lines")
