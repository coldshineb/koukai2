# re_walk.py — 自動追蹤子呼叫的反組譯 (由 tools/re/*.py 在 exec re_env.py / re_tools.py 之後載入)
#   walk(a, depth, why)   反組譯 a 的函式本體, 再遞迴展開它呼叫的函式 (深度 depth); 已展開過的只列一次
#   KNOWN[線性位址] = 名稱   已知 / 已移植, 不展開
#   SEG0_SKIP = {"4dc4", ...}  seg0 的工具函式 (不展開)
#   本專案慣例: 1fd9 段 = 線性 0x20000 起 (1fd9:85d9 = 285d9), 其他段 = seg×16 + off
import re as _re
KNOWN = {0x15a70: "personSelect 0fea:5bd0", 0x1b46e: "bMenu", 0x1b580: "bAfter", 0x1b55c: "bTable",
         0x14364: "listMenu", 0x14524: "customMenu", 0x1469c: "yesNo", 0x147ab: "wait 0fea:490b",
         0x30a30: "nameprompt 2e09:29a0", 0x30735: "keyboard 2e09:26a5", 0x3377e: "message 2e09:56ee",
         0x3372a: "message2 2e09:569a", 0x1592a: "numpad"}
SEG0_SKIP = {"4dc4", "5c9a", "5caa", "5bf8", "5bde", "8f03", "7f06", "796d", "909b", "7e35", "443c", "4b9c", "4bad",
             "592a", "7358", "50c4", "5c38", "5c58", "5c7a", "5c8a", "4d7c", "4d1a", "4d50", "4ecf", "4ee7", "74f7",
             "7849", "8894", "9076", "37bc", "38ba", "3722", "4c39", "442c", "5d36", "5d8b", "5db1", "4bea", "4194",
             "0906", "063e", "0636", "042f", "02a7", "5a1b", "59d7", "3fae", "5050", "4efa", "8050", "8ebc", "7dac",
             "7eac", "7f6e", "7e15", "7cdd", "5b5d", "4dab"}
_done = set()


def _lin(seg, off):
    return 0x20000 + off if seg == 0x1fd9 else seg * 16 + off


def _near(i):
    bs = next(s for s in SEGS if s * 16 <= i.addr)
    base = 0x20000 if bs == 0x1fd9 and i.addr >= 0x20000 else bs * 16
    return base + ((i.target - base) & 0xffff)


def body(a, n=0x2000):
    """線性反組譯到「位址超過所有段內跳躍目標」的 ret/retf 為止"""
    out, mx = [], a
    for i in disasm(code, a, a + n):
        out.append(i)
        if isinstance(i.target, int) and "far" not in i.mn + " ".join(i.ops) and not i.mn.startswith("call"):
            mx = max(mx, _near(i))
        if i.mn in ("ret", "retf", "iret") and i.addr >= mx:
            break
    return out


def callees(ins):
    r = []
    for i in ins:
        if not i.mn.startswith("call"):
            continue
        if isinstance(i.target, tuple):
            seg, off = i.target
            if seg == 0 and format(off, "04x") in SEG0_SKIP:
                continue
            r.append(_lin(seg, off))
        elif isinstance(i.target, int):
            r.append(_near(i))
    return r


def walk(a, d, why=""):
    if a in _done:
        return
    _done.add(a)
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


def walked():
    return sorted(_done)
