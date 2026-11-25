"""片頭 OPEN.EXE: 場景用到的函式庫 (深度展開, 不重複 re_open.txt 已列者)。輸出 tools/work/re_open_lib.txt。
另外輸出 tools/work/re_open_calls.txt: 每個場景的「呼叫序列」(追蹤常數暫存器與堆疊, 列出每次 call 的引數), 方便逐句翻譯。
用法: python tools/re/opening_lib.py"""
import os, io, contextlib, re as R2
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env_open.py"), encoding="utf-8").read())
SCENES = []
for k in range(12):
    o, sg = struct.unpack("<HH", code[DS + 0xb9a + 4 * k:DS + 0xb9e + 4 * k]); SCENES.append(sg * 16 + o)
try:
    EXTRA
except NameError:
    EXTRA = []
# 已在 re_open.txt 列出的函数
done = set(int(m.group(1), 16) for m in R2.finditer(r"========== (\w+) ", open(os.path.join(HERE, "..", "work", "re_open.txt"), encoding="utf-8").read()))
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    todo = []
    for a in sorted(done):
        for c in callees(a):
            if c not in done: todo.append(c)
    todo += EXTRA
    seen = set(done)
    while todo:
        a = todo.pop(0)
        if a in seen: continue
        seen.add(a)
        B = body(a)
        print(f"\n========== {a:05x}  {len(B)} 條")
        for i in B: print(fmt(i))
        for c in callees(a):
            if c not in seen: todo.append(c)
open(os.path.join(HERE, "..", "work", "re_open_lib.txt"), "w", encoding="utf-8").write(buf.getvalue())
print(len(seen) - len(done), "個函式")
