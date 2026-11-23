"""結局 END.EXE 的反組譯: main (0000:01a8) 及其呼叫的函式。輸出 tools/work/re_end.txt。
用法: python tools/re/ending.py   (RE_DEPTH 預設 3)"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env_end.py"), encoding="utf-8").read())

# 跳躍表 jmp word [cs:bx+T]: 依表內相鄰的位址 (距跳躍指令 0x800 以內) 取出各分支並加入展開 (例: main 0273 依核對值選結局、0a38 各結局)
import re as _re
_body0 = body
def body(a, limit=4000):
    out, todo, seen = {}, [a], set()
    while todo:
        x = todo.pop()
        if x in seen: continue
        seen.add(x)
        for i in _body0(x, limit):
            out[i.addr] = i
            m = _re.search(r"\[cs:bx\+0?([0-9a-f]+)h\]", " ".join(i.ops))
            if i.mn == "jmp" and m:
                T = int(m.group(1), 16)
                for k in range(32):
                    v = struct.unpack("<H", code[T + 2 * k:T + 2 * k + 2])[0]
                    if abs(v - i.addr) > 0x800: break
                    todo.append(v)
    return [out[k] for k in sorted(out)]
try:
    DEPTH
except NameError:
    DEPTH = int(os.environ.get("RE_DEPTH", "3"))
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    walk(MAIN, DEPTH, "main")
open(os.path.join(HERE, "..", "work", "re_end.txt"), "w", encoding="utf-8").write(buf.getvalue())
import re as R2
for m in R2.finditer(r"========== (\w+)\s+(.*?)\n", buf.getvalue()):
    print(m.group(1), m.group(2)[:60])
