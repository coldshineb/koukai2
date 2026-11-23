"""劇本 VM 命令 C0..FF: 解出 2e09:5055 跳躍表, 每條命令的處理段 (讀幾個 byte/word、呼叫哪些函式、PC 前進量),
並反組譯被呼叫的輔助函式 (2e09 段 31c04..3273a)。輸出 tools/work/re_scenario_cmds.txt 與 tools/work/scenario_cmds.json"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())

SEG = 0x2e090
TABLE = SEG + 0x5055
RD_B, RD_W = 0x327b8, 0x327cc
# 共用結尾: PC 前進量
TAILS = {0x333cf: 1, 0x333d3: 0, 0x3317e: 2, 0x331b2: 3, 0x331d2: 4, 0x33201: 6, 0x3327e: 5}


def trace(a, limit=80):
    """沿直線執行路徑追蹤 (條件跳躍兩邊都記但只沿 fall-through), 直到 jmp 到共用結尾"""
    reads, calls, tail, lines = [], [], None, []
    p = a
    for _ in range(limit):
        i = disasm(code, p, p + 8)[0]
        lines.append(_fmt(i))
        if i.mn == "call" and i.target is not None:
            t = i.target
            if t == RD_B: reads.append("b")
            elif t == RD_W: reads.append("w")
            else: calls.append(hex(t))
        elif i.mn == "call" and "far" in " ".join(i.ops):
            calls.append(" ".join(i.ops))
        if i.mn == "jmp" and i.target is not None:
            if i.target in TAILS:
                tail = i.target; break
            p = i.target; continue
        if i.mn in ("retf", "ret"):
            tail = "ret"; break
        p = i.addr + i.size
    return reads, calls, tail, lines


buf = io.StringIO()
cmds = {}
with contextlib.redirect_stdout(buf):
    for k in range(64):
        off = struct.unpack("<H", code[TABLE + 2 * k:TABLE + 2 * k + 2])[0]
        a = SEG + off
        op = 0xc0 + k
        if a == 0x33165:
            cmds[hex(op)] = {"handler": hex(a), "invalid": True}
            continue
        reads, calls, tail, lines = trace(a)
        adv = TAILS.get(tail)
        cmds[hex(op)] = {"handler": hex(a), "reads": reads, "calls": calls, "tail": hex(tail) if isinstance(tail, int) else tail, "advance": adv}
        print(f"\n===== op {op:02x} @ {a:05x}  reads={''.join(reads)} advance={adv} calls={calls}")
        print("\n".join(lines))
    helpers = sorted({int(c, 16) for v in cmds.values() for c in v.get("calls", []) if c.startswith("0x")})
    print("\n\n######## 輔助函式", [hex(h) for h in helpers])
    for h in helpers:
        print(f"\n===== helper {h:05x}")
        for i in disasm(code, h, h + 0x300):
            print(_fmt(i))
            if i.mn in ("retf", "ret"):
                break
json.dump(cmds, open(os.path.join(HERE, "..", "work", "scenario_cmds.json"), "w"), indent=1)
open(os.path.join(HERE, "..", "work", "re_scenario_cmds.txt"), "w", encoding="utf-8").write(buf.getvalue())
print("ok", len(buf.getvalue().splitlines()), "lines", sum(1 for v in cmds.values() if not v.get("invalid")), "valid ops")
