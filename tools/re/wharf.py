"""碼頭 (港口建築 3, 1fd9:8993) 的反組譯: 入口、子功能表、被呼叫的函式。輸出 tools/work/re_wharf.txt
用法 (在 uw2_remake 上一層): python uw2_remake/tools/re/wharf.py"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())

SEG = 0x1fd90
ENTRY = SEG + 0x8993
MT = json.load(open(os.path.join(TOOLS, "..", "web", "assets", "text", "menu.json"), encoding="utf-8"))


def until_ret(a, n=0x600):
    out = []
    for i in disasm(code, a, a + n):
        out.append(i)
        print(_fmt(i))
        if i.mn in ("retf", "ret"):
            break
    return out


def far_targets(ins):
    t = set()
    for i in ins:
        if i.mn == "call" and i.target is not None:
            t.add(i.target)
    return t


buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    print("========== 碼頭入口", hex(ENTRY))
    body = until_ret(ENTRY, 0x400)
    # 找 loadMenu (2e09:57aa) 前的 mov ax, n 與 子功能表 [bx+XXXX]
    for i in body:
        t = _fmt(i)
        if "[bx+" in t and i.mn == "mov" and "ax" in i.ops[0]:
            print("   子功能表候選:", t)
    callees = sorted(far_targets(body))
    print("\n== 呼叫", [hex(c) for c in callees])
    # 碼頭區段 1fd9:8993 附近的其他函式 (碼頭自己的子功能通常緊鄰)
    print("\n========== 1fd9:8400..8993 (緊鄰的子功能)")
    cd(SEG + 0x8400, ENTRY)
    for k in range(0, 61):
        if MT[k].count("{00}") >= 2 and any(w in MT[k] for w in ("出航", "補給", "出港")):
            print("\n== MENU", k, MT[k])
open(os.path.join(HERE, "..", "work", "re_wharf.txt"), "w", encoding="utf-8").write(buf.getvalue())
print("ok", len(buf.getvalue().splitlines()), "lines")
