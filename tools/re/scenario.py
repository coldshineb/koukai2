"""劇本事件: 進入建築時的事件檢查 (2e09:5481 / 53f0 / 55c2 / 5546) 與 SNR*.DAT / EVENT*.DAT / SNR*.MES 檔頭。
輸出 tools/work/re_scenario.txt
用法 (在 uw2_remake 上一層): python uw2_remake/tools/re/scenario.py"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())

SEG2E = 0x2e090


def until_ret(a, n=0x400, stop_at_first=True):
    for i in disasm(code, a, a + n):
        print(_fmt(i))
        if stop_at_first and i.mn in ("retf", "ret"):
            break


def hexdump(b, n=0x100, base=0):
    for o in range(0, min(n, len(b)), 16):
        row = b[o:o + 16]
        print(f"{base + o:06x}: {row.hex(' ')}")


def name_hits(sub):
    """MAIN.EXE 中出現檔名字串的位置 (DS 偏移)"""
    out, p = [], 0
    while True:
        k = code.find(sub, p)
        if k < 0:
            break
        out.append(k - DS)
        p = k + 1
    return out


buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    for name, off in [("2e09:5481 事件檢查 (進入建築前)", 0x5481), ("2e09:53f0", 0x53f0),
                      ("2e09:55c2 事件檢查 (進入建築後)", 0x55c2), ("2e09:5546", 0x5546)]:
        print("\n==========", name, hex(SEG2E + off))
        until_ret(SEG2E + off)
    print("\n== 檔名字串 (DS 偏移)")
    for s in [b"SNR", b"EVENT", b".MES", b".DAT"]:
        hits = name_hits(s)
        print(s, [hex(h) for h in hits[:40]])
        for h in hits[:12]:
            if h >= 0:
                print("   ", hex(h), dstr(h - 4, 24), "|", cbytes(h - 4)[:24])
    for f in ["SNR0.DAT", "SNR0.MES", "EVENT0.DAT", "EVENT1.DAT"]:
        b = open(f"{SEA2}/{f}", "rb").read()
        print(f"\n== {f} ({len(b)} bytes)")
        hexdump(b, 0x180)
        w = struct.unpack(f"<{min(32, len(b) // 2)}H", b[:min(64, len(b) // 2 * 2)])
        print("first u16:", [hex(x) for x in w])
open(os.path.join(HERE, "..", "work", "re_scenario.txt"), "w", encoding="utf-8").write(buf.getvalue())
print("ok", len(buf.getvalue().splitlines()), "lines")
