"""港口指令按鈕 (情報 / 經營 / 命令 / 航海術; 1b8c8 畫面按鈕表 DS:a59e, 遠程函式表 DS:a622+di*4 = a642)。
輸出 tools/work/re_commands.txt。用法: python tools/re/commands.py (RE_DEPTH 預設 1; 也可在 exec 時以全域 DEPTH / EXTRA 指定)"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_walk.py"), encoding="utf-8").read())


# re_walk.py 的 _lin 把远程调用 1fd9:off 当成线性 0x20000+off, 实际是 0x1fd90+off (差 0x270; 例: 1fd9:227c = 2200c 才是函数开头)。
# 本脚本改用正确的 seg*16+off; 段内近调用也一律以所在段 *16 为基底回绕。
def _lin(seg, off):
    return seg * 16 + off


def _near(i):
    bs = next(s for s in SEGS if s * 16 <= i.addr)
    return bs * 16 + ((i.target - bs * 16) & 0xffff)


try:
    DEPTH
except NameError:
    DEPTH = int(os.environ.get("RE_DEPTH", "1"))
try:
    EXTRA
except NameError:
    EXTRA = []
try:
    OUT
except NameError:
    OUT = "re_commands.txt"
MT = json.load(open(os.path.join(TOOLS, "..", "web", "assets", "text", "menu.json"), encoding="utf-8"))
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    print("== DS:a59e 畫面按鈕表 12 x 9 bytes")
    for i in range(12):
        print(i, dsbytes(0xa59e + 9 * i, 9).hex(" "))
    # 1b8c8: 按钮 di=8..11 调用 DS:[a622 + di*4] = DS:a642..a64e (a622 是建筑表 a612 的第 4 项起, 加上 di*4 才是指令表)
    print("== DS:a642", [hex(farptr(0xa642 + 4 * i)) for i in range(4)])
    print("== 9396 / 937e (按鈕反白)")
    cd(0x9396, 0x93c0)
    if not EXTRA:
        for i, n in enumerate(["情報", "經營", "命令", "航海術"]):
            walk(farptr(0xa642 + 4 * i), DEPTH, n)
    for a in EXTRA:
        walk(a, DEPTH, "extra")
open(os.path.join(HERE, "..", "work", OUT), "w", encoding="utf-8").write(buf.getvalue())
print(buf.getvalue()[:200])
