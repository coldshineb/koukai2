"""海戰 第三批分析: 攻擊 (砲擊 e8cc / 接舷 e95e)、電腦行動 a3ce、一騎打 12998 — 能辨認「jmp word [cs:bx+表]」跳躍表的反組譯。
fn(a): 從 a 反組譯到 ret (跳過跳躍表的資料, 印出各項目標並接著從表後反組譯); tree(roots): 遞迴展開 (略過 re_walk 的 KNOWN / SEG0_SKIP 與 SKIP)。
用法: python tools/re/battle3.py [根位址 ...]   (預設 e8cc e95e) → tools/work/re_battle3.txt
(exec 時可在 globals 放 ROOTS / SKIP / OUT / NAMES 覆寫)"""
import os, io, re, sys, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_walk.py"), encoding="utf-8").read())
try:
    ROOTS
except NameError:
    ROOTS = [int(a, 16) for a in sys.argv[1:]] or [0xe8cc, 0xe95e]
try:
    SKIP
except NameError:
    SKIP = set()
try:
    OUT
except NameError:
    OUT = "re_battle3.txt"
try:
    NAMES
except NameError:
    NAMES = {}
JT = re.compile(r"jmp word \[cs:bx\+([0-9a-f]+)h\]")


def segbase(a):
    return next(s for s in sorted(SEGS, reverse=True) if s * 16 <= a) * 16


def fn(a, limit=0x3000):
    """回傳 (指令文字列, 呼叫目標)"""
    out, tg, pc, mx, end = [], [], a, a, a + limit
    while pc < end:
        stop = False
        for i in disasm(code, pc, end):
            out.append(_fmt(i))
            if i.mn.startswith("call"):
                if isinstance(i.target, tuple):
                    seg, off = i.target
                    if not (seg == 0 and format(off, "04x") in SEG0_SKIP):
                        tg.append(_lin(seg, off))
                elif isinstance(i.target, int):
                    tg.append(_near(i))
            elif isinstance(i.target, int) and "far" not in i.mn + " ".join(i.ops):
                mx = max(mx, _near(i))
            m = JT.search(_fmt(i))
            if m:
                bs = segbase(i.addr); t = bs + int(m.group(1), 16)
                ents, q = [], t
                while True:
                    if ents and q >= min(ents):
                        break
                    v = bs + (code[q] | (code[q + 1] << 8)); ents.append(v); q += 2
                out.append(f"      ; 跳躍表 {t:05x} ({len(ents)} 項): " + " ".join(f"{k}:{v:05x}" for k, v in enumerate(ents)))
                mx = max(mx, max(ents))
                pc = q; stop = True
                break
            if i.mn in ("ret", "retf", "iret") and i.addr >= mx:
                return out, tg
            if i.mn == "jmp" and isinstance(i.target, int) and i.addr >= mx and _near(i) < i.addr:
                pass
        if not stop:
            break
    return out, tg


_seen = set()


try:
    DEPTH
except NameError:
    DEPTH = 10


def tree(a, why="", d=None):
    d = DEPTH if d is None else d
    if a in _seen or a in SKIP or d < 0:
        return
    _seen.add(a)
    if a in KNOWN:
        print(f"\n========== {a:05x} {KNOWN[a]} (已知, 不展開)"); return
    ins, tg = fn(a)
    n = len([l for l in ins if re.match(r"^[0-9a-f]{5} ", l)])
    print(f"\n========== {a:05x}  {NAMES.get(a, '')} ({why})  {n} 條")
    print("\n".join(ins))
    for c in tg:
        tree(c, f"由 {a:05x} 呼叫", d - 1 if c < 0x2e090 else -1 if d < 1 else 0)


if __name__ == "__main__" or True:
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        for r in ROOTS:
            tree(r, "根")
    open(os.path.join(HERE, "..", "work", OUT), "w", encoding="utf-8").write(buf.getvalue())
    for m in re.finditer(r"========== (\w+)\s+(.*?)\n", buf.getvalue()):
        print(m.group(1), m.group(2)[:60])
