"""酒館剩下 4 項 (飲酒敘話 / 與航海者閒聊 / 酒吧女郎 / 賭博) 的反組譯。輸出 tools/work/re_tavern2.txt
用法 (在 uw2_remake 上一層): python uw2_remake/tools/re/tavern2.py"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())


def funcs_between(a, b):
    """a..b 之間以 push bp / mov bp,sp 開頭的位置"""
    out, p = [], a
    while True:
        k = code.find(b"\x55\x8b\xec", p, b)
        if k < 0:
            break
        out.append(k)
        p = k + 3
    return out


RANGES = [("25a1a..25f16 (僱用後/飲酒相關)", 0x25a1a, 0x25f16), ("25f16 飲酒敘話", 0x25f16, 0x264a0),
          ("264a0 航海者情報 / 26708 僱用", 0x264a0, 0x268ff), ("268ff 與航海者閒聊", 0x268ff, 0x26c00),
          ("27337 酒吧女郎", 0x27337, 0x27491), ("27491 賭博", 0x27491, 0x27592)]

buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    print("== 子功能表 DS:af8c ==", [hex(farptr(0xaf8c + 4 * i)) for i in range(6)])
    for name, a, b in RANGES:
        print("\n==========", name, [hex(x) for x in funcs_between(a, b)])
        dumpc(a, b)
open(os.path.join(HERE, "..", "work", "re_tavern2.txt"), "w", encoding="utf-8").write(buf.getvalue())
print("ok", len(buf.getvalue().splitlines()), "lines")
