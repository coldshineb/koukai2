"""碼頭子功能 (DS:b096 三項) 與入口用到的 2858b / 286ac / 0fea:b578。輸出 tools/work/re_wharf2.txt"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())
MT = json.load(open(os.path.join(TOOLS, "..", "web", "assets", "text", "menu.json"), encoding="utf-8"))


def func(a, n=0xc00):
    """反組譯到最後一個 retf (函式內可能有多個 retf: 讀到下一個 push bp/mov bp,sp 為止)"""
    end = code.find(b"\x55\x8b\xec", a + 3, a + n)
    end = end if end > 0 else a + n
    cd(a, end)
    return end


buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    print("== MENU #9:", MT[9])
    subs = [farptr(0xb096 + 4 * i) for i in range(3)]
    print("== DS:b096", [hex(s) for s in subs])
    for name, a in [("0fea:b578", 0xfea0 + 0xb578), ("2858b 船員加薪", 0x2858b), ("286ac 港 100..129", 0x286ac)] + [(f"子功能 {i}", s) for i, s in enumerate(subs)]:
        print(f"\n========== {name} {a:05x}")
        func(a)
open(os.path.join(HERE, "..", "work", "re_wharf2.txt"), "w", encoding="utf-8").write(buf.getvalue())
print("ok", len(buf.getvalue().splitlines()), "lines")
