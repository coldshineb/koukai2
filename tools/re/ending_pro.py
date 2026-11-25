"""ending_pro.py — 由 END.EXE 反組譯產生 web/src/game/ending_pro.js (劇本結局序幕, DS:0e00 far 函式表的 6 個函式)
這 6 個函式只有 push / mov / call (沒有分支), 逐句轉成對 Ending 方法的呼叫:
  3c7f → talkBottom、3c01 → talkTop (參數: 頭像, 格式, DS 字串…)、215b → printf、3cfd → closeAll、0f34 → prompt、
  1b09 → setCursor(ax, dx)、3fd6 → put(col, y, w, h, mode, seg, off)、75e6 → ptr、0e2c / 4bdc → 開 / 關 [025a]、2aa4 → drawGraph(bx, ax, dx)
用法: python tools/re/ending_pro.py   (在 uw2_remake 上一層執行環境變數 WORKSPACE_DIR 指向 uw2_remake 的上一層; 輸出 web/src/game/ending_pro.js)"""
import os, re
WORKSPACE_DIR = os.environ.get("WORKSPACE_DIR") or os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
exec(open(os.path.join(WORKSPACE_DIR, "uw2_remake", "tools", "re_env_end.py"), encoding="utf-8").read())

FUNCS = [0x1008, 0x113e, 0x1192, 0x1415, 0x12c7, 0x1509]
CALLS = {"3c7f": "talkBottom", "3c01": "talkTop", "215b": "printf", "3cfd": "closeAll", "0f34": "prompt", "1b09": "setCursor",
         "3fd6": "put", "75e6": "ptr", "4bdc": "close", "0e2c": "open", "2aa4": "drawGraph"}


def lines(a):
    out = []
    for i in body(a):
        t = fmt(i).split(";")[0].rstrip()
        ad, _, ins = t.partition(" ")
        if ins.strip() in ("nop", "push cs"): continue
        out.append((ad, ins.strip()))
    return out


def gen(a):
    reg, stack, out = {}, [], []

    def val(x):
        x = x.strip()
        m = re.match(r"^0?([0-9a-f]+)h$", x)
        if m: return ("imm", int(m.group(1), 16))
        if re.match(r"^[0-9]+$", x): return ("imm", int(x))
        m = re.match(r"^word \[0?([0-9a-f]+)h\]$", x) or re.match(r"^\[0?([0-9a-f]+)h\]$", x)
        if m: return ("mem", int(m.group(1), 16))
        if x in reg: return reg[x]
        raise Exception("val " + x)

    def js(v):
        if v[0] == "imm": return hex(v[1])
        if v[0] == "mem": return f"e.w({hex(v[1])})"
        if v[0] == "expr": return v[1]
        if v[0] == "ptr": return f"e.ptr(e.w({hex(v[1])}))"
        if v[0] == "file": return "file"

    for ad, ins in lines(a):
        op, _, args = ins.partition(" ")
        A = [x.strip() for x in args.split(",")] if args else []
        if op == "mov":
            dst, src = A
            if dst.startswith("word [") or dst.startswith("["):
                mm = int(re.search(r"([0-9a-f]+)h", dst).group(1), 16)
                if mm == 0x25a: continue                                   # [025a] = 文件 handle (由 open 处理)
                out.append(f"e.sw({hex(mm)}, {js(val(src))});")
            else: reg[dst] = val(src)
        elif op == "sub" and A[0] == A[1]: reg[A[0]] = ("imm", 0)
        elif op == "add" and A[0] == "sp":
            n = int(A[1].rstrip("h"), 16) // 2; stack = stack[:-n] if n else stack
        elif op == "add":
            v = val(A[0]); k = int(A[1].rstrip("h"), 16); reg[A[0]] = ("expr", f"({js(v)} + {hex(k)})")
        elif op == "lea":
            m = re.search(r"\[0?([0-9a-f]+)h\]", A[1]); reg[A[0]] = ("imm", int(m.group(1), 16))
        elif op == "push": stack.append(val(A[0]) if A[0] != "word [025ah]" else ("file", 0))
        elif op == "pop": stack.pop()
        elif op == "call":
            f = CALLS[A[0][-4:]]
            if f == "ptr": reg["ax"] = ("ptr", reg["ax"][1]); continue
            if f in ("talkTop", "talkBottom", "printf"):
                ar = list(reversed(stack))
                fa = ([js(ar[0])] + [f"e.str({js(x)})" for x in ar[1:]]) if f == "printf" else ([js(ar[0]), js(ar[1])] + [f"e.str({js(x)})" for x in ar[2:]])
                out.append(f"await e.{f}({', '.join(fa)});")
            elif f == "put":
                col, y, w, h, mode, off, seg = list(reversed(stack))[:7]
                out.append(f"e.put({js(col)}, {js(y)}, {js(w)}, {js(h)}, {js(mode)}, {js(seg)}, {js(off)});")
            elif f == "setCursor": out.append(f"e.setCursor({js(reg['ax'])}, {js(reg['dx'])});")
            elif f == "close": out.append("// 4bdc 關檔 [025a]")
            elif f == "open":
                bx = reg["bx"][1]
                if bx == 0x4da: out.append("e.openEvent(e.b(0x04e1) - 0x30);                              // 0e2c(\"B:EVENT*.DAT\") — '*' = 00000 最後寫入的字元")
                elif bx == 0x4be: out.append("e.file = e.data.endgrp;                                        // 0e2c(\"A:ENDGRP.DAT\")")
                else: raise Exception("open " + hex(bx))
            elif f == "drawGraph": out.append(f"e.drawGraph({js(reg['bx'])}, {js(reg['ax'])}, {js(reg['dx'])});")
            else: out.append(f"await e.{f}();")
        elif op == "retf": pass
        else: raise Exception(f"{a:05x} {ad} {ins}")
    return out


def main():
    code = ["// ending_pro.js — 結局序幕: 各主角劇本結局的對話 (END.EXE DS:0e00 far 函式表 01008 / 0113e / 01192 / 01415 / 012c7 / 01509)",
            "//   由 tools/re/ending_pro.py 自反組譯逐句產生 (函式本身只有 push / mov / call, 沒有分支); 文字在 ending.json 的 DS。",
            "//   e = Ending 實例: talkTop = 3c01 (上方視窗, 頭像, printf), talkBottom = 3c7f (下方視窗), closeAll = 3cfd, put = 3fd6, setCursor = 1b09, printf = 215b, prompt = 0f34。",
            "export const PROLOGUES = ["]
    for i, a in enumerate(FUNCS):
        code.append(f"  async e => {{                                                    // {i}: {a:05x}")
        code += ["    " + l for l in gen(a)]
        code.append("  },")
    code.append("];")
    out = os.path.join(WORKSPACE_DIR, "uw2_remake", "web", "src", "game", "ending_pro.js")
    open(out, "w", encoding="utf-8", newline="\n").write("\n".join(code) + "\n")
    print(out)


if __name__ == "__main__":
    main()
