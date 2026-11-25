# re_env.py — 逆向分析用 Python 环境 (在沙盒中 exec 本档即可)
import os, re, struct, json
import numpy as np
from collections import Counter
W = WORKSPACE_DIR
SEA2 = f"{W}/uw2_remake/tools/work/sea2"
exec(open(f"{W}/uw2_remake/tools/dis86.py").read())
ex = open(f"{SEA2}/MAIN.EXE", "rb").read()
code = ex[struct.unpack("<H", ex[8:10])[0] * 16:]
DS = 0x38150
_nrel = struct.unpack("<H", ex[6:8])[0]; _relo = struct.unpack("<H", ex[0x18:0x1a])[0]
fix = set()
for _i in range(_nrel):
    _o, _s = struct.unpack("<HH", ex[_relo + _i * 4:_relo + _i * 4 + 4]); fix.add(_s * 16 + _o)
def dump(a, b, buf=None):
    for i in disasm(buf if buf is not None else code, a, b): print(i)
def find_imm(v):
    p = struct.pack("<H", v); return [m.start() for m in re.finditer(re.escape(p), code[:DS])]
def callers(target):
    res = []
    for m in re.finditer(rb"\x9a", code[:DS]):
        p = m.start()
        if p + 3 in fix:
            o, s = struct.unpack("<HH", code[p + 1:p + 5])
            if s * 16 + o == target: res.append(p)
    for m in re.finditer(rb"\x0e\xe8", code[:DS]):
        p = m.start() + 1; d = struct.unpack("<h", code[p + 1:p + 3])[0]
        if p + 3 + d == target: res.append(p)
    return sorted(set(res))
def prev_ins(p, n=8):
    for back in range(48, 0, -1):
        ins = disasm(code, p - back, p + 5)
        if any(i.addr == p for i in ins): return [i for i in ins if i.addr < p][-n:]
    return []
def func_start(x):
    k = x
    while k > 0:
        k = code.rfind(b"\x55\x8b\xec", 0, k)
        if k < 0: return None
        if code[k - 1] in (0xcb, 0xc3, 0x00, 0x90) or code[k - 3] == 0xca: return k
    return None
def dsbytes(o, n): return code[DS + o:DS + o + n]
