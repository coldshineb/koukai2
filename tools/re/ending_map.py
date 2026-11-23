"""結局 END.EXE 與片頭 OPEN.EXE 的函式對照: 從兩邊 main 完整展開 (不限深度), 以「遮掉近呼叫/跳躍位移與重定位」後的位元組比對函式本體。
輸出 tools/work/re_end_map.txt (每個 END.EXE 函式 = 相同 (OPEN 位址) / 新函式), tools/work/re_end_new.txt (新函式的完整反組譯)。
用法: python tools/re/ending_map.py"""
import os, io, re, struct
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
OUT = os.path.join(HERE, "..", "work")


def load_env(name):
    g = {"WORKSPACE_DIR": WORKSPACE_DIR, "__name__": "env"}
    exec(open(os.path.join(HERE, "..", name), encoding="utf-8").read(), g)
    return g


def funcs(g):
    code = g["code"]; body0 = g["body"]
    def body(a):
        out, todo, seen = {}, [a], set()
        while todo:
            x = todo.pop()
            if x in seen: continue
            seen.add(x)
            for i in body0(x, 6000):
                out[i.addr] = i
                m = re.search(r"\[cs:bx\+0?([0-9a-f]+)h\]", " ".join(i.ops))
                if i.mn == "jmp" and m:
                    T = int(m.group(1), 16)
                    for k in range(32):
                        v = struct.unpack("<H", code[T + 2 * k:T + 2 * k + 2])[0]
                        if abs(v - i.addr) > 0x800: break
                        todo.append(v)
        return [out[k] for k in sorted(out)]
    F, todo = {}, [g["MAIN"]]
    while todo:
        a = todo.pop()
        if a in F: continue
        B = body(a); F[a] = B
        for i in B:
            ops = " ".join(i.ops)
            if i.mn == "call" and "word" not in ops:
                m = re.search(r"([0-9a-f]{4}):([0-9a-f]{4})", ops)
                if m: todo.append(int(m.group(1), 16) * 16 + int(m.group(2), 16))
                elif i.target is not None: todo.append(i.target & 0xffff)
    return F


def size(code, i, nxt):
    return getattr(i, "size", None) or (nxt - i.addr if nxt is not None and 0 < nxt - i.addr < 8 else 1)


def sig(g, B):
    code, fix = g["code"], g["fix"]
    out = bytearray()
    for k, i in enumerate(B):
        nxt = B[k + 1].addr if k + 1 < len(B) else None
        n = size(code, i, nxt)
        b = bytearray(code[i.addr:i.addr + n])
        ops = " ".join(i.ops)
        if (i.mn == "call" or i.mn.startswith("j") or i.mn.startswith("loop")) and (i.target is not None or "far" in ops) and "word" not in ops:
            b = bytearray([b[0]]) + bytearray(len(b) - 1)
        for j in range(n):
            if any(i.addr + j - d in fix for d in (0, 1)): b[j] = 0
        out += b
    return bytes(out)


def norm(g, B):
    """結構比對用: 指令文字中 >= 0x100 的十六進位數 (位址 / 資料偏移) 換成 #, 小常數保留"""
    out = []
    for i in B:
        t = i.mn + " " + ", ".join(i.ops)
        t = re.sub(r"\b0?[0-9a-f]{3,5}h\b", "#", t)
        t = re.sub(r"\b[0-9a-f]{4}:[0-9a-f]{4}\b", "#", t)
        if i.target is not None: t = re.sub(r"\b[0-9a-f]{3,5}\b", "#", t)
        out.append(t)
    return "\n".join(out)


def main():
    E = load_env("re_env_end.py"); O = load_env("re_env_open.py")
    FE, FO = funcs(E), funcs(O)
    so, no = {}, {}
    for a, B in FO.items():
        if B: so.setdefault(sig(O, B), a); no.setdefault(norm(O, B), a)
    rep, new, same, nn = [], io.StringIO(), 0, 0
    for a in sorted(FE):
        B = FE[a]
        if not B: continue
        s = sig(E, B)
        if s in so:
            same += 1; rep.append(f"{a:05x} = OPEN {so[s]:05x}  ({len(B)})")
        elif norm(E, B) in no:
            same += 1; rep.append(f"{a:05x} ~ OPEN {no[norm(E, B)]:05x}  ({len(B)}) 結構相同, 資料位址不同")
        else:
            nn += len(B); rep.append(f"{a:05x} NEW ({len(B)})")
            print(f"\n========== {a:05x}  {len(B)}", file=new)
            for i in B: print(E["fmt"](i), file=new)
    head = f"END.EXE functions {len(FE)}, same as OPEN.EXE {same}, new instructions {nn} (OPEN.EXE functions {len(FO)})\n"
    open(os.path.join(OUT, "re_end_map.txt"), "w", encoding="utf-8").write(head + "\n".join(rep) + "\n")
    open(os.path.join(OUT, "re_end_new.txt"), "w", encoding="utf-8").write(new.getvalue())
    print(head)


if __name__ == "__main__":
    main()
