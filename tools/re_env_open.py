# re_env_open.py — OPEN.EXE (片头) 的逆向分析环境 (exec 本档即可; 与 re_env.py 相同用法, 但加载 OPEN.EXE)
#   code = 映像 (加载地址 0 起), DS = DGROUP 线性地址, fix = 重定位位置集合
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
DS = 0xa0b0                       # DGROUP = 0a0b (入口 2d2b: mov di, 0a0bh → ss = ds)
MAIN = 0x85aa                     # main (入口 2dd8: call 85aa)
def body(a, limit=4000):
    """遞迴下降: 函式 a 可到達的指令 (依位址排序)"""
    seen, todo, out = set(), [a], {}
    while todo and len(out) < limit:
        x = todo.pop()
        while x not in seen and 0 <= x < len(code):
            seen.add(x)
            ins = disasm(code, x, x + 8)
            if not ins: break
            i = ins[0]; out[i.addr] = i
            m = i.mn
            if m in ("ret", "retf", "iret") or (m == "jmp" and "far" in " ".join(i.ops)): break
            if m.startswith("j") and i.target is not None:
                todo.append(i.target & 0xffff)                 # 映像 < 64K, 全部在 0 段: 近跳跃以 64K 回绕
                if m in ("jmp",): break
            if m == "jmp" and i.target is None: break
            x = i.addr + i.size if hasattr(i, "size") else ins[1].addr if len(ins) > 1 else x + 1
    return [out[k] for k in sorted(out)]
def callees(a):
    r = []
    for i in body(a):
        if i.mn == "call" and i.target is not None and "word" not in " ".join(i.ops): r.append(i.target & 0xffff)
        if i.mn == "call" and "far" in " ".join(i.ops):
            m = re.search(r"([0-9a-f]{4}):([0-9a-f]{4})", " ".join(i.ops))
            if m: r.append(int(m.group(1), 16) * 16 + int(m.group(2), 16))
    return list(dict.fromkeys(r))
def fmt(i):
    ops = [o.replace(format(i.target, "x"), format(i.target & 0xffff, "x")) if i.target is not None and i.target > 0xffff else o for o in i.ops]
    t = f"{i.addr:05x} {i.mn} {', '.join(ops)}"
    for m in re.finditer(r"\[(?:[a-z]{2}:)?0?([0-9a-f]{3,4})h\]|\b0?([0-9a-f]{4})h\b", t[6:]):
        v = int(m.group(1) or m.group(2), 16)
        if DS + v < len(code):
            b = code[DS + v:DS + v + 40]
            if 0 in b and b.index(0) >= 3 and all(32 <= c < 127 for c in b[:b.index(0)]): t += f'  ; "{b[:b.index(0)].decode()}"'
    return t
_walked = set()
def walk(a, depth, why="", known={}):
    if a in _walked: return
    _walked.add(a)
    B = body(a)
    print(f"\n========== {a:05x}  ({why})  {len(B)} 條")
    for i in B: print(fmt(i))
    if depth > 0:
        for c in callees(a):
            if c in known: print(f"\n========== {c:05x} {known[c]} (已知, 不展開)"); _walked.add(c); continue
            walk(c, depth - 1, f"由 {a:05x} 呼叫", known)
def dump(a, b, buf=None):
    for i in disasm(buf if buf is not None else code, a, b): print(i)
def dsbytes(o, n): return code[DS + o:DS + o + n]
def w16(o): return struct.unpack("<H", code[DS + o:DS + o + 2])[0]
def cstr(o):
    e = code.index(b"\0", DS + o); return code[DS + o:e]
