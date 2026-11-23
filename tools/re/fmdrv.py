"""FMDRV.COM (FM 音源驅動, INT 66h) 的反組譯。COM 檔載入於 CS:0100, 這裡在緩衝前補 0x100 個 0 讓位址 = IP。
輸出 tools/work/re_fmdrv.txt (整檔線性反組譯 + 十六進位), 並印出 INT 66h 入口附近。
用法: python tools/re/fmdrv.py"""
import os, struct
HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.join(HERE, "..")
exec(open(os.path.join(TOOLS, "dis86.py"), encoding="utf-8").read())
raw = open(os.path.join(TOOLS, "work", "sea2", "FMDRV.COM"), "rb").read()
buf = b"\0" * 0x100 + raw + b"\0" * 16
END = 0x100 + len(raw)
try:
    RANGES
except NameError:
    RANGES = [(0x100, END)]
out = []
for a, b in RANGES:
    for i in disasm(buf, a, b):
        out.append(str(i))
open(os.path.join(TOOLS, "work", "re_fmdrv.txt"), "w", encoding="utf-8").write("\n".join(out) + "\n")
hexl = []
for a in range(0x100, END, 16):
    ch = buf[a:a + 16]
    hexl.append(f"{a:04x}: {ch.hex(' ')}  {''.join(chr(c) if 32 <= c < 127 else '.' for c in ch)}")
open(os.path.join(TOOLS, "work", "re_fmdrv_hex.txt"), "w", encoding="utf-8").write("\n".join(hexl) + "\n")
print(len(raw), "bytes;", len(out), "lines")
