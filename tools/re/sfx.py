"""FM 效果音: MAIN.EXE 的呼叫處 (9768/97a4 音色 AH=05、9804/9836 發音 AH=06、9888 放鍵 AH=07) 與音色資料,
以及 FMDRV.COM 效果音聲部 (4/5) 用到的函式。輸出 tools/work/re_sfx.txt。
用法: python tools/re/sfx.py"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    print("== MAIN.EXE 呼叫處 (音色 → 發音)")
    for p in callers(0x9768) + callers(0x97a4):
        pi = prev_ins(p, 3); nx = disasm(code, p + 5, p + 16)
        print(f"{p:05x} 函式 {func_start(p) or 0:05x} | " + " | ".join(str(i) for i in pi) + " || " + " | ".join(str(i) for i in nx[:3]))
    print("== 放鍵 9888 呼叫處")
    for p in callers(0x9888): print(f"{p:05x} 函式 {func_start(p) or 0:05x}")
    print("== 音色資料 (0x16 bytes)")
    for o in range(0x0bc0, 0x0c86, 0x16): print(f"DS:{o:04x}", dsbytes(o, 0x16).hex(" "))
    print("== FMDRV.COM")
    raw = open(os.path.join(HERE, "..", "work", "sea2", "FMDRV.COM"), "rb").read()
    fb = b"\0" * 0x100 + raw + b"\0" * 16
    T = [struct.unpack("<H", fb[0x245 + 2 * i:0x247 + 2 * i])[0] for i in range(10)]
    print("AH 00..09 分派 DS:0245:", [hex(x) for x in T])
    for a, b, why in [(0x0317, 0x032b, "聲部選擇 (AL 0/1 → 4/5)"), (0x0398, 0x03ff, "AH=05/06/07"), (0x0638, 0x06f0, "OPL 寫入 / 放鍵 / 靜音"),
                      (0x06f0, 0x0800, "音色寫入 073e 一帶"), (0x09c7, 0x0b92, "音色載入 09ff / 調變參數"), (0x0bd2, 0x0cb5, "發音 0bd2")]:
        print(f"\n---- {a:04x}..{b:04x} {why}")
        for i in disasm(fb, a, b): print(i)
open(os.path.join(HERE, "..", "work", "re_sfx.txt"), "w", encoding="utf-8").write(buf.getvalue())
print(len(buf.getvalue()))
