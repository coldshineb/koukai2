"""片頭 OPEN.EXE 場景的「呼叫序列」整理 (輔助閱讀, 不取代逐句翻譯)。
把 push / mov 常數 / 9072 取緩衝段 等樣板折疊成 call 的引數, 其餘指令 (跳躍、比較、迴圈變數運算) 原樣列出。
輸出 tools/work/re_open_calls.txt。用法: python tools/re/opening_calls.py"""
import os, io, contextlib, re as R2
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env_open.py"), encoding="utf-8").read())
NAMES = {0x9072: "seg", 0x8be3: "loadEntry", 0x504e: "graphOfs", 0x4905: "dec4", 0x492d: "dec3", 0x03ce: "put4", 0x055e: "put3",
         0x4980: "playSong", 0x50a2: "fadeIn2a6_2d6", 0x4fd5: "waitEsc", 0x50cd: "fadeOutSlow", 0x50e4: "fadeOut", 0x0810: "cls",
         0x4836: "timerZero", 0x4846: "timerAdd", 0x485d: "wait", 0x4f0d: "waitSkip", 0x4d0d: "palStep", 0x4bc8: "palCycleStep",
         0x2aec: "put3stride", 0x2b5e: "scrollCopy", 0x2c15: "planeFill", 0x2d0e: "border", 0x00aa: "lseek", 0x005b: "read",
         0x4f6d: "fadeSkip", 0x4de2: "palSet306", 0x4dd9: "palSetF6", 0x4dbc: "palFade1", 0x0837: "planeSel"}
BUF = {0x4c: "B4c", 0x4e: "B4e", 0x50: "B50", 0x52: "B52", 0x54: "B54", 0x56: "B56", 0x48: "FH"}
REGS = ("ax", "bx", "cx", "dx", "si", "di")
def val(op, R):
    op = op.strip()
    m = R2.fullmatch(r"(?:word )?\[0?([0-9a-f]+)h\]", op)
    if m:
        v = int(m.group(1), 16); return BUF.get(v, f"[{v:04x}]")
    m = R2.fullmatch(r"0?([0-9a-f]+)h", op)
    if m: return f"0x{int(m.group(1), 16):x}"
    if op in R: return R[op]
    if R2.fullmatch(r"[0-9]+", op): return op
    return op
def lift(a):
    out = []
    R = {r: r for r in REGS}; st = []
    for i in body(a):
        mn, ops = i.mn, [o.strip() for o in i.ops]
        if mn == "nop": continue
        if mn == "push" and ops == ["cs"]: continue
        if mn == "push":
            st.append(val(ops[0].replace("word ", ""), R)); continue
        if mn == "sub" and len(ops) == 2 and ops[0] == ops[1] and ops[0] in R: R[ops[0]] = "0"; continue
        if mn == "mov" and ops[0] in R:
            R[ops[0]] = val(ops[1], R); continue
        if mn == "lea" and ops[0] in R:
            m = R2.fullmatch(r"\[0?([0-9a-f]+)h\]", ops[1]); R[ops[0]] = f"&{int(m.group(1),16):04x}" if m else ops[1]; continue
        if mn == "call" and i.target is not None:
            tg = i.target & 0xffff; nm = NAMES.get(tg, f"f{tg:04x}")
            if tg == 0x9072:
                R["ax"] = f"seg({R['ax']})"; continue
            args = list(reversed(st)); st = []
            regs = ",".join(f"{r}={R[r]}" for r in ("ax", "dx", "bx") if R[r] not in (r,))
            out.append(f"{i.addr:05x}   {nm}({regs}{' | ' if regs and args else ''}{', '.join(args)})")
            R = {r: r for r in REGS}; R["si"] = "si"; R["di"] = "di"
            R["ax"] = f"ret_{nm}"
            continue
        if mn == "add" and ops[0] == "sp": continue
        if mn == "pop" and ops[0] == "bx" and not st: continue
        if mn == "pop" and st: st.pop(); continue
        out.append(f"{i.addr:05x} {mn} {', '.join(ops)}")
        for r in REGS:
            if ops and ops[0] == r: R[r] = r
    return out
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    try:
        TARGETS
    except NameError:
        TARGETS = [struct.unpack("<HH", code[DS + 0xb9a + 4 * k:DS + 0xb9e + 4 * k]) for k in range(12)]
        TARGETS = [sg * 16 + o for o, sg in TARGETS]
    for k, a in enumerate(TARGETS):
        print(f"\n########## {a:05x}")
        for l in lift(a): print(l)
open(os.path.join(HERE, "..", "work", "re_open_calls.txt"), "w", encoding="utf-8").write(buf.getvalue())
print(len(buf.getvalue()))
