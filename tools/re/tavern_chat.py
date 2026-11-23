"""酒館: 與航海者閒聊 (1fd9:68ff) 用到的清單列格式與小函式。輸出 tools/work/re_tavern_chat.txt"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())
MT = json.load(open(os.path.join(TOOLS, "..", "web", "assets", "text", "menu.json"), encoding="utf-8"))


def until_ret(a, n=0x200):
    for i in disasm(code, a, a + n):
        print(_fmt(i))
        if i.mn in ("retf", "ret"):
            break


buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    for f in [0x14a55, 0x4d76, 0x4dc4, 0x7dac]:
        print("\n==========", hex(f))
        until_ret(f)
    for k in (10, 11, 12, 14):
        print(f"\n== MENU #{k}:", MT[k])
    for o in (0x8b72, 0x8b79):
        print(f"\n== DS:{o:04x}", cbytes(o).hex(), dstr(o))
open(os.path.join(HERE, "..", "work", "re_tavern_chat.txt"), "w", encoding="utf-8").write(buf.getvalue())
print("ok", len(buf.getvalue().splitlines()), "lines")
