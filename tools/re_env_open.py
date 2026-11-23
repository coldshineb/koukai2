# re_env_open.py — OPEN.EXE (片頭) 的逆向分析環境 (exec 本檔即可; 與 re_env.py 相同用法, 但載入 OPEN.EXE)
#   code = 映像 (載入位址 0 起), DS = DGROUP 線性位址, fix = 重定位位置集合
import os, re, struct, json
from collections import Counter
W = WORKSPACE_DIR
SEA2 = f"{W}/uw2_remake/tools/work/sea2"
exec(open(f"{W}/uw2_remake/tools/dis86.py", encoding="utf-8").read())
ex = open(f"{SEA2}/OPEN.EXE", "rb").read()
code = ex[struct.unpack("<H", ex[8:10])[0] * 16:]
_nrel = struct.unpack("<H", ex[6:8])[0]; _relo = struct.unpack("<H", ex[0x18:0x1a])[0]
fix = set()
for _i in range(_nrel):
    _o, _s = struct.unpack("<HH", ex[_relo + _i * 4:_relo + _i * 4 + 4]); fix.add(_s * 16 + _o)
ENTRY = struct.unpack("<H", ex[0x16:0x18])[0] * 16 + struct.unpack("<H", ex[0x14:0x16])[0]
SS0 = struct.unpack("<H", ex[0x0e:0x10])[0]
try:
    DS
except NameError:
    DS = None
def dump(a, b, buf=None):
    for i in disasm(buf if buf is not None else code, a, b): print(i)
def dsbytes(o, n): return code[DS + o:DS + o + n]
def w16(o): return struct.unpack("<H", code[DS + o:DS + o + 2])[0]
def cstr(o):
    e = code.index(b"\0", DS + o); return code[DS + o:e]
