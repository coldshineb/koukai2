"""折抵舊船剩餘貨物重新分配 (0fea:e788 / 0fea:fe57 / 0000:8ebc) 與 碼頭 補給港命名 (1fd9:85d9 = 285d9)。
輸出 tools/work/re_leftover.txt。函式自動追蹤子呼叫 (深度 DEPTH), 已移植/已知的函式只列名稱不展開。"""
import os, io, re, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())

DEPTH = 3
# 已知 / 已移植, 不展開 (線性位址)
KNOWN = {0x15a70: "personSelect 0fea:5bd0", 0x1b46e: "bMenu", 0x1b580: "bAfter", 0x1b55c: "bTable",
         0x14364: "listMenu", 0x30a30: "nameprompt 2e09:29a0", 0x30735: "keyboard 2e09:26a5", 0x356ee + 0: "message"}
SEG0_SKIP = {"4dc4", "5c9a", "5caa", "5bf8", "5bde", "8f03", "7f06", "796d", "909b", "7e35", "443c", "4b9c", "4bad",
             "592a", "7358", "50c4", "5c38", "5c58", "5c7a", "5c8a", "4d7c", "4d1a", "4d50", "4ecf", "4ee7", "74f7",
             "7849", "8894", "9076", "37bc", "38ba", "4c39", "442c", "5d36", "5d8b"}


def body(a, n=0x1400):
    """線性反組譯到「位址超過所有段內跳躍目標」的 ret/retf 為止"""
    out, far, mx = [], 0, a
    for i in disasm(code, a, a + n):
        out.append(i)
        if isinstance(i.target, int) and "far" not in i.mn + " ".join(i.ops) and not i.mn.startswith("call"):
            bs = next(s for s in SEGS if s * 16 <= i.addr) * 16
            mx = max(mx, bs + ((i.target - bs) & 0xffff))
        if i.mn in ("ret", "retf", "iret") and i.addr >= mx:
            break
    return out


def callees(ins):
    r = []
    for i in ins:
        if not i.mn.startswith("call"):
            continue
        t = " ".join(i.ops)
        if isinstance(i.target, tuple):
            seg, off = i.target
            if seg == 0 and format(off, "04x") in SEG0_SKIP:
                continue
            r.append(seg * 16 + off)
            continue
        m = re.search(r"far ([0-9a-f]{4}):([0-9a-f]{4})", t)
        if m:
            seg, off = int(m.group(1), 16), int(m.group(2), 16)
            if seg == 0 and m.group(2) in SEG0_SKIP:
                continue
            r.append(seg * 16 + off)
        elif isinstance(i.target, int):
            bs = next(s for s in SEGS if s * 16 <= i.addr) * 16
            r.append(bs + ((i.target - bs) & 0xffff))
    return r


done = set()


def walk(a, d, why):
    if a in done:
        return
    done.add(a)
    if a in KNOWN:
        print(f"\n========== {a:05x} {KNOWN[a]} (已知, 不展開)")
        return
    ins = body(a)
    print(f"\n========== {a:05x}  ({why})  {len(ins)} 條")
    for i in ins:
        print(_fmt(i))
    if d > 0:
        for c in callees(ins):
            walk(c, d - 1, f"由 {a:05x} 呼叫")


buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    walk(0xfea0 + 0xe788, DEPTH, "0fea:e788 剩餘貨物表標題")
    walk(0xfea0 + 0xfe57, DEPTH, "0fea:fe57 剩餘貨物分配")
    walk(0x8ebc, 1, "0000:8ebc")
    walk(0x285d9, DEPTH, "1fd9:85d9 補給港命名 (線性 285d9, 本專案慣例 1fd9 段 = 0x20000)")
    for o in range(0xa800, 0xa880, 1):
        pass
open(os.path.join(HERE, "..", "work", "re_leftover.txt"), "w", encoding="utf-8").write(buf.getvalue())
print("ok", len(buf.getvalue().splitlines()), "lines", len(done), "funcs")
print(sorted(f"{x:05x}" for x in done))
